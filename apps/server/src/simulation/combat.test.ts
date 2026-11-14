import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findEnemyDefinition } from "@healer/content";
import { asEntityId, distance, type ActiveMapState, type EnemyState } from "@healer/shared";
import { GameWorld } from "./gameWorld.js";
import { getDefaultRespawnPoint } from "./createWorld.js";
import { computeWreckSalvage, RESPAWN_INVULNERABILITY_MS, WRECK_OWNER_PROTECTION_MS } from "./combat.js";
import { isPositionBlocked } from "./collision.js";
import { applyPersistedMapState, serializeMapState } from "./mapPersistence.js";
import { exitPositionOnMap } from "./worldGraph.js";

const start = new Date("2026-03-26T12:00:00Z").getTime();

// Clears a map's terrain and enemies so a test controls every body in the fight.
function openArena(map: ActiveMapState): void {
  for (const chunk of Object.values(map.chunks)) {
    chunk.cells = Array(chunk.cells.length).fill(0);
  }
  map.enemies = {};
  map.projectiles = {};
}

function placeEnemy(map: ActiveMapState, enemyTypeId: string, position: { x: number; y: number }, id = `test-${enemyTypeId}`): EnemyState {
  const definition = findEnemyDefinition(enemyTypeId);
  if (!definition) {
    throw new Error(`Unknown enemy ${enemyTypeId}`);
  }
  const enemy: EnemyState = {
    id: asEntityId(id),
    mapId: map.id,
    enemyTypeId,
    position: { ...position },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    health: definition.maxHealth,
    aiState: "idle"
  };
  map.enemies[enemy.id] = enemy;
  return enemy;
}

// Advances fake time and runs one simulation tick.
async function tickAt(world: GameWorld, msFromStart: number): Promise<void> {
  vi.setSystemTime(start + msFromStart);
  await world.tick();
}

// Moves the player's ship into the root foundry chamber, away from the spawn point.
function parkAwayFromSpawn(map: ActiveMapState, playerId: string): { x: number; y: number } {
  const foundry = Object.values(map.foundries)[0];
  const position = { x: foundry.position.x, y: foundry.position.y - 200 };
  map.players[playerId].position = { ...position };
  return position;
}

describe("combat consequences", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies each enemy's own contact damage at most once per attack cooldown", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    map.foundries = {};
    const player = map.players["player-1"];
    player.position = { x: 400, y: 400 };
    placeEnemy(map, "burrow-sentry", { x: 430, y: 400 });

    // One second of contact at 30 Hz: the old code removed 4 hull every tick (about 120 per second).
    for (let tick = 0; tick < 30; tick += 1) {
      await tickAt(world, Math.round((tick * 1000) / 30));
    }

    const sentry = findEnemyDefinition("burrow-sentry")!;
    const expectedHits = Math.floor(1000 / sentry.attackCooldownMs) + 1;
    expect(player.hull).toBe(100 - sentry.contactDamage * expectedHits);
  });

  it("destroys the ship at zero hull, leaves owner-protected salvage, and respawns in a fallback ship", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    await world.connectPlayer("player-2");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    const player = map.players["player-1"];
    const deathPosition = parkAwayFromSpawn(map, "player-1");
    map.foundries = {};
    map.players["player-2"].position = { x: 64, y: 64 };
    player.inventory = { rock: 40, ferrite: 25, "plasma-crystal": 5 };
    player.hull = 5;
    placeEnemy(map, "drone-scout", { x: deathPosition.x + 28, y: deathPosition.y });
    world.drainPendingMessages("player-1");

    await tickAt(world, 0);

    // Respawned at full hull in a fresh fallback ship at the root spawn point.
    const respawn = getDefaultRespawnPoint();
    expect(player.mapId).toBe(respawn.mapId);
    expect(distance(player.position, respawn.position)).toBeLessThan(64);
    expect(player.hull).toBe(player.maxHull);
    expect(player.hullId).toBe("sparrow-scout");
    expect(player.invulnerableUntil).toBe(start + RESPAWN_INVULNERABILITY_MS);

    // Half the cargo is kept; the other half plus hardware salvage sits in the wreck.
    expect(player.inventory).toEqual({ rock: 20, ferrite: 13, "plasma-crystal": 3 });
    const wreck = Object.values(map.drops).find((drop) => drop.ownerPlayerId === "player-1");
    expect(wreck).toBeDefined();
    expect(wreck?.position).toEqual(deathPosition);
    expect(wreck?.protectedUntil).toBe(start + WRECK_OWNER_PROTECTION_MS);
    expect(wreck?.resources.rock).toBeGreaterThanOrEqual(20);
    expect(wreck?.resources.ferrite).toBeGreaterThanOrEqual(12);

    // The lost ship leaves the stable and the fallback becomes the active ship, persisted.
    const save = await world.persistence.players.getPlayer(world.worldId, asPlayerIdString("player-1"));
    expect(save?.shipStable["ship-player-1"]).toBeUndefined();
    expect(save?.shipStable[save.activeShipId]).toMatchObject({ name: "Fallback Sparrow", hullId: "sparrow-scout", status: "active" });
    expect(save?.resourceCounts).toEqual(player.inventory);

    // The player is told what happened and gets fresh builder state.
    const messages = world.drainPendingMessages("player-1");
    expect(messages).toContainEqual(expect.objectContaining({ type: "actionFeedback", code: "ship_destroyed" }));
    expect(messages).toContainEqual(expect.objectContaining({ type: "builderState", activeShipId: save?.activeShipId }));

    // Another pilot cannot take the wreck while it is protected, but can after protection expires.
    const other = map.players["player-2"];
    other.position = { ...deathPosition };
    map.enemies = {};
    await tickAt(world, 1000);
    expect(map.drops[wreck!.id]).toBeDefined();
    await tickAt(world, WRECK_OWNER_PROTECTION_MS + 1);
    expect(map.drops[wreck!.id]).toBeUndefined();
    expect(other.inventory.rock).toBeGreaterThan(40);
  });

  it("lets the owner recover protected wreck salvage", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    const player = map.players["player-1"];
    const deathPosition = parkAwayFromSpawn(map, "player-1");
    map.foundries = {};
    player.hull = 1;
    placeEnemy(map, "drone-scout", { x: deathPosition.x + 28, y: deathPosition.y });
    await tickAt(world, 0);
    const keptRock = player.inventory.rock ?? 0;

    map.enemies = {};
    player.position = { ...deathPosition };
    await tickAt(world, 2000);

    expect(Object.values(map.drops).some((drop) => drop.ownerPlayerId === "player-1")).toBe(false);
    expect(player.inventory.rock).toBeGreaterThan(keptRock);
  });

  it("ignores damage during respawn invulnerability", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    map.foundries = {};
    const player = map.players["player-1"];
    player.position = { x: 400, y: 400 };
    player.invulnerableUntil = start + 500;
    placeEnemy(map, "drone-scout", { x: 428, y: 400 });

    await tickAt(world, 0);
    expect(player.hull).toBe(100);
    // The hit at t=0 was absorbed; the next one after the cooldown lands.
    await tickAt(world, 800);
    expect(player.hull).toBe(100 - findEnemyDefinition("drone-scout")!.contactDamage);
  });

  it("computes wreck salvage from cargo and the ship's build cost", () => {
    const salvage = computeWreckSalvage(
      { rock: 11, ferrite: 0 },
      { hullId: "warden-healer", modules: [{ moduleId: "pulse-cannon", hardpointId: "weapon-front", currentHealth: 24 }] }
    );
    expect(salvage.keptInventory).toEqual({ rock: 6, ferrite: 0 });
    // Cargo spill 5 rock, plus half of warden (40 rock, 80 ferrite, 20 plasma) and pulse cannon (10 ferrite).
    expect(salvage.spilled).toEqual({ rock: 25, ferrite: 45, "plasma-crystal": 10 });
  });
});

describe("ranged enemies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds range and fires hostile bolts that damage players but not enemies", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    map.foundries = {};
    const player = map.players["player-1"];
    player.position = { x: 400, y: 400 };
    const sentinel = placeEnemy(map, "sentinel", { x: 560, y: 400 });
    const bystander = placeEnemy(map, "drone-scout", { x: 480, y: 470 });
    const definition = findEnemyDefinition("sentinel")!;

    await tickAt(world, 0);
    const bolts = Object.values(map.projectiles);
    expect(bolts).toHaveLength(1);
    expect(bolts[0].faction).toBe("enemy");
    expect(world.getSnapshot("player-1").projectiles[0]?.hostile).toBe(true);

    // The sentinel sits inside its preferred band, so it holds position instead of ramming.
    expect(sentinel.velocity).toEqual({ x: 0, y: 0 });

    for (let ms = 33; ms <= 1000; ms += 33) {
      bystander.position = { x: 480, y: 470 };
      await tickAt(world, ms);
    }
    expect(player.hull).toBe(100 - definition.ranged!.damage);
    expect(bystander.health).toBe(findEnemyDefinition("drone-scout")!.maxHealth);
  });

  it("backs away from a player inside its preferred range", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    map.foundries = {};
    map.players["player-1"].position = { x: 400, y: 400 };
    const sentinel = placeEnemy(map, "sentinel", { x: 460, y: 400 });

    await tickAt(world, 0);
    expect(sentinel.position.x).toBeGreaterThan(460);
  });

  it("stops enemy bolts on rock without mining it", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const map = world.runtime.maps["map-root"];
    openArena(map);
    map.foundries = {};
    map.players["player-1"].position = { x: 16, y: 16 };
    map.projectiles["bolt"] = {
      id: asEntityId("bolt"),
      mapId: map.id,
      faction: "enemy",
      position: { x: 100, y: 48 },
      velocity: { x: -300, y: 0 },
      damage: 6,
      lifetimeMs: 1000
    };
    map.chunks["0,0"].cells[8 + 2] = 1;

    for (let ms = 0; ms <= 300; ms += 33) {
      await tickAt(world, ms);
    }
    expect(map.projectiles["bolt"]).toBeUndefined();
    expect(map.chunks["0,0"].cells[8 + 2]).toBe(1);
  });
});

describe("foundry fortifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("garrisons the root foundry with turrets clear of spawn, builder, and exits", async () => {
    const world = new GameWorld();
    await world.initialize();
    const map = world.runtime.maps["map-root"];
    const foundry = Object.values(map.foundries)[0];
    const turrets = Object.values(map.enemies).filter((enemy) => enemy.defendsFoundryId === foundry.id);

    expect(foundry.defenseSlots?.length).toBe(2);
    expect(turrets).toHaveLength(2);
    // Defenses do not use up the foundry's production cap.
    expect(turrets.every((turret) => !turret.sourceFoundryId)).toBe(true);

    const keepOut = [
      getDefaultRespawnPoint().position,
      ...Object.values(map.structures).map((structure) => structure.position),
      ...map.connections.flatMap((connection) => exitPositionOnMap(connection, map.id) ?? [])
    ];
    for (const turret of turrets) {
      expect(turret.enemyTypeId).toBe("defense-turret");
      expect(isPositionBlocked(map, turret.position, 14)).toBe(false);
      expect(distance(turret.position, foundry.position)).toBeLessThan(140);
      for (const point of keepOut) {
        expect(distance(turret.position, point)).toBeGreaterThanOrEqual(80);
      }
    }
  });

  it("rebuilds a lost defense only after the rebuild delay, and never after the foundry falls", async () => {
    const world = new GameWorld();
    await world.initialize();
    const map = world.runtime.maps["map-root"];
    const foundry = Object.values(map.foundries)[0];
    const rebuildMs = foundry.defenseRebuildMs!;
    const turretCount = () => Object.values(map.enemies).filter((enemy) => enemy.defendsFoundryId === foundry.id).length;

    // Kill a turret with player fire at t=10s.
    vi.setSystemTime(start + 10000);
    const turret = Object.values(map.enemies).find((enemy) => enemy.defendsFoundryId === foundry.id)!;
    turret.health = 1;
    map.projectiles["shot"] = {
      id: asEntityId("shot"),
      mapId: map.id,
      faction: "player",
      position: { ...turret.position },
      velocity: { x: 0, y: 0 },
      damage: 25,
      lifetimeMs: 500
    };
    await world.tick();
    expect(turretCount()).toBe(1);
    expect(Object.keys(map.drops)).toContain(`drop-${turret.id}`);

    // Not rebuilt mid-assault; rebuilt once the delay since the loss has passed.
    await tickAt(world, 10000 + rebuildMs - 1000);
    expect(turretCount()).toBe(1);
    await tickAt(world, 10000 + rebuildMs + 1);
    expect(turretCount()).toBe(2);

    // Once the foundry is destroyed, losses stay lost.
    foundry.active = false;
    foundry.buildState = "destroyed";
    for (const enemy of Object.values(map.enemies)) {
      if (enemy.defendsFoundryId === foundry.id) {
        delete map.enemies[enemy.id];
      }
    }
    await tickAt(world, 10000 + rebuildMs * 5);
    expect(turretCount()).toBe(0);
  });

  it("persists defense slots and the depth-scaled reward with the foundry", async () => {
    const world = new GameWorld();
    await world.initialize();
    const map = world.runtime.maps["map-root"];
    const foundry = Object.values(map.foundries)[0];
    const serialized = serializeMapState(map, { id: map.id, seed: map.seed, status: "active", connectionIds: [], lastActivatedAt: null, depth: 0 });

    const fresh = new GameWorld().runtime.maps["map-root"];
    const freshFoundry = Object.values(fresh.foundries)[0];
    freshFoundry.defenseSlots = [];
    applyPersistedMapState(fresh, serialized);
    expect(fresh.foundries[foundry.id].defenseSlots).toEqual(foundry.defenseSlots);
    expect(fresh.foundries[foundry.id].reward).toEqual({ ferrite: 30, "plasma-crystal": 10 });

    // An older save without the new fields keeps the generated template's values.
    const legacy = structuredClone(serialized);
    for (const entry of legacy.foundries) {
      delete entry.defenseSlots;
      delete entry.reward;
      delete entry.enemyMix;
    }
    const upgraded = new GameWorld().runtime.maps["map-root"];
    applyPersistedMapState(upgraded, legacy);
    expect(upgraded.foundries[foundry.id].defenseSlots).toEqual(foundry.defenseSlots);
    expect(upgraded.foundries[foundry.id].enemyMix).toEqual(["drone-scout", "drone-scout", "sentinel"]);
  });

  it("produces the foundry's enemy mix, including ranged sentinels", async () => {
    const world = new GameWorld();
    await world.initialize();
    const map = world.runtime.maps["map-root"];
    const foundry = Object.values(map.foundries)[0];
    for (let step = 1; step <= 4; step += 1) {
      await tickAt(world, step * (foundry.spawnCooldownMs + 1));
    }
    const produced = Object.values(map.enemies)
      .filter((enemy) => enemy.sourceFoundryId === foundry.id)
      .map((enemy) => enemy.enemyTypeId)
      .sort();
    expect(produced).toEqual(["drone-scout", "drone-scout", "sentinel"]);
  });
});

function asPlayerIdString(value: string) {
  return value as Parameters<GameWorld["persistence"]["players"]["getPlayer"]>[1];
}
