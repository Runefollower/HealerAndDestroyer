import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_ROTATION_STEP, TERRAIN_CELL_TYPES, asPlayerId, distance } from "@healer/shared";
import { GameWorld } from "./gameWorld.js";
import { getPlayerShipCollisionRadius, getStructureCollisionRadius, isPositionBlocked } from "./collision.js";
import { exitPositionOnMap } from "./worldGraph.js";

// Parks a connected player's ship on an exit of their current map so changeMap passes the range check.
function moveToExit(world: GameWorld, rawPlayerId: string, connectionId: string): void {
  const map = Object.values(world.runtime.maps).find((entry) => entry.players[rawPlayerId]);
  const connection = map?.connections.find((entry) => entry.id === connectionId);
  const position = map && connection ? exitPositionOnMap(connection, map.id) : null;
  if (!map || !position) {
    throw new Error(`Exit ${connectionId} is not on the player's map.`);
  }
  map.players[rawPlayerId].position = { ...position };
  map.players[rawPlayerId].velocity = { x: 0, y: 0 };
}

describe("GameWorld", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns a player into the persistent starter world", async () => {
    const world = new GameWorld();
    await world.initialize();
    const player = await world.connectPlayer("player-1");

    expect(player.spawnPoint.mapId).toBeDefined();
    expect(world.getSnapshot("player-1").players).toHaveLength(1);
  });

  it("rotates with A/D input and thrusts along the ship heading", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    player.rotation = Math.PI / 2;

    await world.handleMessage("player-1", {
      type: "moveInput",
      thrustForward: false,
      thrustReverse: false,
      rotateLeft: false,
      rotateRight: true,
      tick: 1
    });
    // Input is queued and applied on the next simulation tick.
    expect(player.rotation).toBeCloseTo(Math.PI / 2, 5);
    await world.tick();
    expect(player.rotation).toBeCloseTo(Math.PI / 2 + PLAYER_ROTATION_STEP, 5);

    const startX = player.position.x;
    const startY = player.position.y;
    await world.handleMessage("player-1", {
      type: "moveInput",
      thrustForward: true,
      thrustReverse: false,
      rotateLeft: false,
      rotateRight: false,
      tick: 2
    });
    await world.tick();

    expect(player.position.y).toBeGreaterThan(startY);
    expect(Math.abs(player.position.y - startY)).toBeGreaterThan(Math.abs(player.position.x - startX));
  });

  it("steps the ship once per queued input and catches up gradually after a burst", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const player = world.runtime.maps["map-root"].players["player-1"];
    player.rotation = 0;

    // Three inputs arriving in one burst are not applied all at once.
    for (const tick of [1, 2, 3]) {
      await world.handleMessage("player-1", { type: "moveInput", thrustForward: false, thrustReverse: false, rotateLeft: false, rotateRight: true, tick });
    }
    // A duplicate or out-of-order input is ignored.
    await world.handleMessage("player-1", { type: "moveInput", thrustForward: false, thrustReverse: false, rotateLeft: false, rotateRight: true, tick: 2 });

    // The backlog is above the catch-up threshold, so the first tick steps twice, then once.
    await world.tick();
    expect(player.rotation).toBeCloseTo(2 * PLAYER_ROTATION_STEP, 5);
    expect(world.getSnapshot("player-1").lastProcessedInputTick).toBe(2);
    await world.tick();
    expect(player.rotation).toBeCloseTo(3 * PLAYER_ROTATION_STEP, 5);
    expect(world.getSnapshot("player-1").lastProcessedInputTick).toBe(3);
  });

  it("holds a streaming ship through a short input gap and coasts after a long one", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const player = world.runtime.maps["map-root"].players["player-1"];
    player.position = { x: 128, y: 128 };
    player.rotation = 0;

    await world.handleMessage("player-1", { type: "moveInput", thrustForward: true, thrustReverse: false, rotateLeft: false, rotateRight: false, tick: 1 });
    await world.tick();
    const afterInput = player.position.x;
    expect(afterInput).toBeGreaterThan(128);

    // A short gap is jitter: the ship waits for the next input instead of taking steps the client won't replay.
    await world.tick();
    expect(player.position.x).toBe(afterInput);

    // A long gap means the client stopped sending, so the ship keeps drifting.
    for (let tick = 0; tick < 5; tick += 1) {
      await world.tick();
    }
    expect(player.position.x).toBeGreaterThan(afterInput);
  });

  it("allows a higher sustained player speed while keeping thrust input incremental", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    player.position = { x: 128, y: 128 };
    player.rotation = 0;

    for (let tick = 1; tick <= 60; tick += 1) {
      await world.handleMessage("player-1", {
        type: "moveInput",
        thrustForward: true,
        thrustReverse: false,
        rotateLeft: false,
        rotateRight: false,
        tick
      });
      await world.tick();
    }

    expect(player.velocity.x).toBeGreaterThan(55);
    expect(Math.abs(player.velocity.y)).toBeLessThan(0.001);
  });

  it("spawns weapon projectiles from the front hardpoint and fires along ship heading", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    player.position = { x: 120, y: 120 };
    player.rotation = Math.PI / 2;

    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "weapon-front",
      targetWorld: { x: -500, y: -500 },
      tick: 3
    });

    const projectile = Object.values(rootMap.projectiles)[0];
    if (!projectile) {
      throw new Error("Expected projectile to be spawned.");
    }

    expect(projectile.position.y).toBeGreaterThan(player.position.y + 10);
    expect(Math.abs(projectile.position.x - player.position.x)).toBeLessThan(1);
    expect(projectile.velocity.y).toBeGreaterThan(0);
    expect(Math.abs(projectile.velocity.x)).toBeLessThan(0.001);
  });

  it("spends energy per shot, refuses shots on an empty store, and recharges over time", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    player.position = { x: 120, y: 120 };
    expect(player.power).toBe(player.maxPower);
    expect(world.getSnapshot("player-1").selfMaxEnergy).toBe(player.maxPower);

    const fire = (tick: number) =>
      world.handleMessage("player-1", { type: "fireWeapon", weaponHardpointId: "weapon-front", tick });
    await fire(1);
    expect(Object.keys(rootMap.projectiles)).toHaveLength(1);
    expect(player.power).toBe(player.maxPower - 5);

    // An empty store blocks the shot even once the cooldown is over, without a feedback toast per press.
    player.power = 2;
    vi.advanceTimersByTime(400);
    await fire(2);
    expect(Object.keys(rootMap.projectiles)).toHaveLength(1);
    expect(world.drainPendingMessages("player-1").filter((message) => message.type === "actionFeedback")).toHaveLength(0);

    // The starter Sparrow has 12 spare power, so it recharges 8 + 12 * 0.5 = 14 energy per second.
    for (let index = 0; index < 30; index += 1) {
      await world.tick();
    }
    expect(player.power).toBeCloseTo(16, 5);
    await fire(3);
    expect(Object.keys(rootMap.projectiles).length).toBeGreaterThanOrEqual(1);
    expect(player.power).toBeCloseTo(11, 5);
  });

  it("fires each destroyer gun from its own hardpoint and flies the heavier hull more slowly", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    await world.connectPlayer("player-2");

    const rootMap = world.runtime.maps["map-root"];
    const scout = rootMap.players["player-1"];
    const destroyer = rootMap.players["player-2"];
    destroyer.hullId = "breaker-destroyer";
    destroyer.modules = [
      { moduleId: "rail-lance", hardpointId: "weapon-port", currentHealth: 30 },
      { moduleId: "rail-lance", hardpointId: "weapon-starboard", currentHealth: 30 },
      { moduleId: "heavy-drive", hardpointId: "engine-rear", currentHealth: 45 },
      { moduleId: "reactive-plating", hardpointId: "armor-ring", currentHealth: 36 }
    ];
    destroyer.power = 100;
    destroyer.rotation = 0;
    scout.rotation = 0;
    // Park both ships in open space, well apart, so collision does not eat the thrust under test.
    const openSpot = (exclude: string) => {
      for (let y = 64; y < 4000; y += 48) {
        for (let x = 64; x < 4000; x += 48) {
          if (!isPositionBlocked(rootMap, { x, y }, 48, { includePlayers: true, includeEnemies: true, excludeEntityId: exclude })) {
            return { x, y };
          }
        }
      }
      throw new Error("No open space found.");
    };
    destroyer.position = openSpot(destroyer.id);
    scout.position = openSpot(scout.id);

    for (const weaponHardpointId of ["weapon-port", "weapon-starboard"]) {
      await world.handleMessage("player-2", { type: "fireWeapon", weaponHardpointId, tick: 1 });
    }
    const shots = Object.values(rootMap.projectiles).filter((projectile) => projectile.ownerPlayerId === destroyer.playerId);
    expect(shots).toHaveLength(2);
    expect(shots.map((shot) => Math.sign(shot.position.y - destroyer.position.y)).sort()).toEqual([-1, 1]);
    expect(shots[0].damage).toBe(60);
    expect(destroyer.power).toBe(100 - 36);

    // Same thrust input for one step: the 151-mass destroyer gains less speed than the 70-mass scout.
    scout.velocity = { x: 0, y: 0 };
    destroyer.velocity = { x: 0, y: 0 };
    for (const playerId of ["player-1", "player-2"]) {
      await world.handleMessage(playerId, { type: "moveInput", thrustForward: true, thrustReverse: false, rotateLeft: false, rotateRight: false, tick: 1 });
    }
    await world.tick();
    const scoutSpeed = Math.hypot(scout.velocity.x, scout.velocity.y);
    const destroyerSpeed = Math.hypot(destroyer.velocity.x, destroyer.velocity.y);
    expect(destroyerSpeed).toBeGreaterThan(0);
    expect(destroyerSpeed).toBeLessThan(scoutSpeed);
  });

  it("rejects ship designs that draw more power than the reactor provides", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const builder = Object.values(rootMap.structures).find((structure) => structure.structureTypeId === "builder-site");
    if (!builder) {
      throw new Error("Expected builder structure.");
    }
    rootMap.players["player-1"].position = { ...builder.position };
    rootMap.players["player-1"].inventory = { rock: 200, stone: 200, ferrite: 200, "plasma-crystal": 50 };

    const response = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "submitShipDesign",
      mode: "refit",
      hullId: "sparrow-scout",
      shipId: "ship-player-1",
      modules: [
        { hardpointId: "engine-rear", moduleId: "heavy-drive" },
        { hardpointId: "weapon-front", moduleId: "rail-lance" },
        { hardpointId: "utility-belly", moduleId: "bore-drill" }
      ]
    });
    if (response[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }

    const activeShip = response[0].ships.find((ship) => ship.shipId === "ship-player-1");
    expect(activeShip?.ship.modules.map((module) => module.moduleId)).toEqual(["starter-thruster", "pulse-cannon", "mining-laser"]);
    expect(world.drainPendingMessages("player-1")).toContainEqual(expect.objectContaining({ type: "actionFeedback", code: "ship_design_power_overload" }));
  });

  it("destroys terrain on critical projectile impact and leaves debris", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    player.position = { x: 84, y: 16 };
    player.rotation = Math.PI;
    rootMap.chunks["0,0"].cells = Array(64).fill(0);
    rootMap.chunks["0,0"].cells[0] = TERRAIN_CELL_TYPES.commonRock;

    const startingCell = rootMap.chunks["0,0"].cells[0];
    expect(startingCell).toBeGreaterThan(0);

    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "weapon-front",
      tick: 4
    });

    expect(Object.keys(rootMap.projectiles)).toHaveLength(1);

    for (let index = 0; index < 6; index += 1) {
      await world.tick();
    }

    expect(Object.keys(rootMap.projectiles)).toHaveLength(0);
    expect(rootMap.chunks["0,0"].cells[0]).toBe(0);
    expect(Object.values(rootMap.drops)).toContainEqual(
      expect.objectContaining({
        resources: expect.objectContaining({ rock: expect.any(Number) })
      })
    );

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    expect(reloadedWorld.runtime.maps["map-root"].chunks["0,0"].cells[0]).toBe(0);
  });

  it("blocks ships from moving through solid terrain", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    player.position = { x: 48, y: 16 };
    player.velocity = { x: -720, y: 0 };

    await world.tick();

    expect(player.position.x).toBe(48);
    expect(player.velocity.x).toBe(0);
  });

  it("blocks ships from overlapping major structures", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    const builder = Object.values(rootMap.structures)[0];
    if (!builder) {
      throw new Error("Expected builder structure.");
    }

    player.position = { x: builder.position.x - 52, y: builder.position.y };
    player.velocity = { x: 480, y: 0 };

    await world.tick();

    expect(player.velocity.x).toBe(0);
    expect(distance(player.position, builder.position)).toBeGreaterThanOrEqual(
      getPlayerShipCollisionRadius(player) + getStructureCollisionRadius(builder.structureTypeId)
    );
  });

  it("requires a mining tool for terrain mining and persists chunk edits on reload", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const map = world.runtime.maps["map-root"];
    map.players["player-1"].position = { x: 48, y: 48 };
    const beforeCell = map.chunks["0,0"].cells[0];
    expect(beforeCell).toBeGreaterThan(0);

    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "weapon-front",
      targetWorld: { x: 16, y: 16 },
      tick: 1
    });
    for (let index = 0; index < 20; index += 1) {
      await world.tick();
    }
    expect(map.chunks["0,0"].cells[0]).toBe(beforeCell);

    await world.handleMessage("player-1", {
      type: "activateModule",
      moduleId: "mining-laser",
      targetWorld: { x: 16, y: 16 },
      tick: 2
    });
    expect(map.chunks["0,0"].cells[0]).toBe(0);

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    expect(reloadedWorld.runtime.maps["map-root"].chunks["0,0"].cells[0]).toBe(0);
  });

  it("keeps large structures and foundries visible when nearby in open space", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    const builder = Object.values(rootMap.structures)[0];
    const foundry = Object.values(rootMap.foundries)[0];
    if (!builder || !foundry) {
      throw new Error("Expected builder and foundry.");
    }

    rootMap.chunks["0,0"].cells = Array(64).fill(0);
    rootMap.chunks["1,0"].cells = Array(64).fill(0);
    player.position = { x: builder.position.x - 24, y: builder.position.y };

    let snapshot = world.getSnapshot("player-1");
    expect(snapshot.structures.find((structure) => structure.id === builder.id)).toBeDefined();

    player.position = { x: foundry.position.x - 24, y: foundry.position.y };
    snapshot = world.getSnapshot("player-1");
    expect(snapshot.foundries.find((entry) => entry.id === foundry.id)).toBeDefined();
  });

  it("hides enemies behind walls and prevents blocked enemies from chasing the player", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    const enemy = rootMap.enemies["enemy-root-1"];
    if (!enemy) {
      throw new Error("Expected root enemy.");
    }

    rootMap.chunks["0,0"].cells = Array(64).fill(0);
    rootMap.chunks["1,0"].cells = Array(64).fill(0);
    player.position = { x: 16, y: 16 };
    enemy.position = { x: 80, y: 16 };
    rootMap.chunks["0,0"].cells[1] = 1;

    const snapshot = world.getSnapshot("player-1");
    const chunk = snapshot.chunks.find((entry) => entry.chunkKey === "0,0");
    expect(snapshot.enemies).toHaveLength(0);
    expect(chunk?.visibility[1]).toBe(2);
    expect(chunk?.visibility[2]).toBe(0);

    await world.tick();

    expect(enemy.aiState).toBe("idle");
    expect(enemy.velocity).toEqual({ x: 0, y: 0 });
  });

  it("reveals a limited depth of occluding terrain without seeing open space behind it", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    rootMap.chunks["0,0"].cells = Array(64).fill(0);
    rootMap.chunks["1,0"].cells = Array(64).fill(0);
    player.position = { x: 16, y: 16 };

    rootMap.chunks["0,0"].cells[1] = 1;
    rootMap.chunks["0,0"].cells[2] = 1;
    rootMap.chunks["0,0"].cells[3] = 1;
    rootMap.chunks["0,0"].cells[4] = 1;

    const snapshot = world.getSnapshot("player-1");
    const chunk = snapshot.chunks.find((entry) => entry.chunkKey === "0,0");

    expect(chunk?.visibility[1]).toBe(2);
    expect(chunk?.visibility[2]).toBe(2);
    expect(chunk?.visibility[3]).toBe(2);
    expect(chunk?.visibility[4]).toBe(0);
    expect(chunk?.visibility[5]).toBe(0);
  });

  it("keeps remembered terrain stable while hidden and restores it after reconnect", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    rootMap.chunks["0,0"].cells = Array(64).fill(0);
    rootMap.chunks["1,0"].cells = Array(64).fill(0);
    player.position = { x: 16, y: 16 };
    rootMap.chunks["0,0"].cells[2] = 1;

    let snapshot = world.getSnapshot("player-1");
    let chunk = snapshot.chunks.find((entry) => entry.chunkKey === "0,0");
    expect(chunk?.cells[2]).toBe(1);
    expect(chunk?.visibility[2]).toBe(2);

    rootMap.chunks["0,0"].cells[1] = 1;
    rootMap.chunks["0,0"].cells[2] = 0;

    snapshot = world.getSnapshot("player-1");
    chunk = snapshot.chunks.find((entry) => entry.chunkKey === "0,0");
    expect(chunk?.cells[1]).toBe(1);
    expect(chunk?.visibility[1]).toBe(2);
    expect(chunk?.cells[2]).toBe(1);
    expect(chunk?.visibility[2]).toBe(1);

    await world.disconnectPlayer("player-1");

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    await reloadedWorld.connectPlayer("player-1");

    const reloadedSnapshot = reloadedWorld.getSnapshot("player-1");
    const reloadedChunk = reloadedSnapshot.chunks.find((entry) => entry.chunkKey === "0,0");
    expect(reloadedChunk?.cells[2]).toBe(1);
    expect(reloadedChunk?.visibility[2]).toBe(1);
  });

  it("queues throttled action feedback for locked routes and rejected module use", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    moveToExit(world, "player-1", "conn-root-depth-1");

    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });
    expect(world.drainPendingMessages("player-1")).toContainEqual(
      expect.objectContaining({
        type: "actionFeedback",
        code: "deeper_path_locked"
      })
    );

    moveToExit(world, "player-1", "conn-root-depth-1");

    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });
    expect(world.drainPendingMessages("player-1")).toEqual([]);

    const map = world.runtime.maps["map-root"];
    map.players["player-1"].position = { x: 48, y: 48 };
    await world.handleMessage("player-1", {
      type: "activateModule",
      moduleId: "utility-belly",
      targetWorld: { x: 480, y: 480 },
      tick: 3
    });
    expect(world.drainPendingMessages("player-1")).toContainEqual(
      expect.objectContaining({
        type: "actionFeedback",
        code: "mining_target_out_of_range"
      })
    );
  });

  it("uses freshly collected runtime resources for builder actions before disconnect", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const playerId = asPlayerId("player-1");
    const save = await world.persistence.players.getPlayer(world.worldId, playerId);
    if (!save) {
      throw new Error("Expected player save.");
    }
    save.resourceCounts = { rock: 0, ferrite: 0, "plasma-crystal": 0 };
    await world.persistence.players.savePlayer(save);

    const rootMap = world.runtime.maps["map-root"];
    const runtimePlayer = rootMap.players["player-1"];
    const builder = Object.values(rootMap.structures).find((structure) => structure.structureTypeId === "builder-site");
    if (!builder) {
      throw new Error("Expected builder structure.");
    }
    runtimePlayer.inventory = { rock: 0, ferrite: 0, "plasma-crystal": 0 };
    runtimePlayer.position = { ...builder.position };
    rootMap.drops["test-drop"] = {
      id: "test-drop" as never,
      mapId: rootMap.id,
      position: { ...builder.position },
      resources: { rock: 40, ferrite: 80, "plasma-crystal": 20 }
    };

    await world.tick();

    const refreshedSave = await world.persistence.players.getPlayer(world.worldId, playerId);
    expect(runtimePlayer.inventory).toEqual({ rock: 40, ferrite: 80, "plasma-crystal": 20 });
    expect(refreshedSave?.resourceCounts).toEqual({ rock: 40, ferrite: 80, "plasma-crystal": 20 });

    const buildResponse = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "startShipBuild",
      targetId: "warden-healer"
    });
    if (buildResponse[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }

    const buildingShip = buildResponse[0].ships.find((ship) => ship.ship.hullId === "warden-healer");
    expect(buildingShip?.ship.status).toBe("building");

    const spentSave = await world.persistence.players.getPlayer(world.worldId, playerId);
    expect(spentSave?.resourceCounts).toEqual({ rock: 0, ferrite: 0, "plasma-crystal": 0 });
    expect(rootMap.players["player-1"].inventory).toEqual({ rock: 0, ferrite: 0, "plasma-crystal": 0 });
  });

  it("tracks ship build timers, emits completion updates, and allows support activation on a completed support ship", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const playerId = asPlayerId("player-1");
    const save = await world.persistence.players.getPlayer(world.worldId, playerId);
    if (!save) {
      throw new Error("Expected player save.");
    }
    save.resourceCounts = { rock: 40, ferrite: 200, "plasma-crystal": 50 };
    await world.persistence.players.savePlayer(save);

    const rootMap = world.runtime.maps["map-root"];
    const builder = Object.values(rootMap.structures).find((structure) => structure.structureTypeId === "builder-site");
    if (!builder) {
      throw new Error("Expected builder structure.");
    }
    rootMap.players["player-1"].inventory = { rock: 40, ferrite: 200, "plasma-crystal": 50 };
    rootMap.players["player-1"].position = { ...builder.position };

    const buildResponse = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "startShipBuild",
      targetId: "warden-healer"
    });
    if (buildResponse[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }
    const buildingShip = buildResponse[0].ships.find((ship) => ship.ship.hullId === "warden-healer");
    expect(buildingShip?.ship.status).toBe("building");
    expect(buildingShip?.remainingBuildMs).toBeGreaterThan(0);

    await world.handleMessage("player-1", {
      type: "builderAction",
      action: "swapShip",
      targetId: String(buildingShip?.shipId)
    });
    expect((await world.persistence.players.getPlayer(world.worldId, playerId))?.activeShipId).not.toBe(buildingShip?.shipId);

    vi.setSystemTime(Date.now() + 46_000);
    await world.tick();

    const notifications = world.drainPendingMessages("player-1");
    expect(notifications).toContainEqual(
      expect.objectContaining({
        type: "shipBuildCompleted",
        shipId: buildingShip?.shipId,
        hullId: "warden-healer"
      })
    );

    const readyResponse = await world.handleMessage("player-1", { type: "interact" });
    if (readyResponse[0]?.type !== "builderState") {
      throw new Error("Expected builder state response after completion.");
    }
    const readyShip = readyResponse[0].ships.find((ship) => ship.ship.hullId === "warden-healer");
    expect(readyShip?.ship.status).toBe("ready");
    expect(readyShip?.remainingBuildMs).toBe(0);

    await world.handleMessage("player-1", {
      type: "builderAction",
      action: "swapShip",
      targetId: String(readyShip?.shipId)
    });
    await world.handleMessage("player-1", {
      type: "builderAction",
      action: "craftModule",
      targetId: "repair-beam"
    });
    await world.handleMessage("player-1", {
      type: "builderAction",
      action: "installModule",
      targetId: "repair-beam",
      shipId: String(readyShip?.shipId),
      hardpointId: "support-top"
    });

    rootMap.players["player-1"].hull = 80;
    const selfEntityId = world.getSnapshot("player-1").players.find((player) => player.playerId === asPlayerId("player-1"))?.id;
    await world.handleMessage("player-1", {
      type: "activateModule",
      moduleId: "repair-beam",
      targetEntityId: String(selfEntityId),
      tick: 3
    });

    expect(rootMap.players["player-1"].hull).toBeGreaterThan(80);
  });

  it("builds a new ship from a submitted hull and hardpoint design", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const playerId = asPlayerId("player-1");
    const save = await world.persistence.players.getPlayer(world.worldId, playerId);
    if (!save) {
      throw new Error("Expected player save.");
    }
    save.resourceCounts = { rock: 40, ferrite: 200, "plasma-crystal": 50 };
    await world.persistence.players.savePlayer(save);

    const rootMap = world.runtime.maps["map-root"];
    const builder = Object.values(rootMap.structures).find((structure) => structure.structureTypeId === "builder-site");
    if (!builder) {
      throw new Error("Expected builder structure.");
    }
    rootMap.players["player-1"].inventory = { rock: 40, ferrite: 200, "plasma-crystal": 50 };
    rootMap.players["player-1"].position = { ...builder.position };

    const buildResponse = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "submitShipDesign",
      mode: "new",
      hullId: "warden-healer",
      modules: [{ hardpointId: "support-top", moduleId: "repair-beam" }]
    });
    if (buildResponse[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }

    const designedShip = buildResponse[0].ships.find((ship) => ship.ship.hullId === "warden-healer");
    expect(designedShip?.ship.status).toBe("building");
    expect(designedShip?.ship.modules).toEqual([{ moduleId: "repair-beam", hardpointId: "support-top", currentHealth: 20 }]);
    expect(rootMap.players["player-1"].inventory).toEqual({ rock: 0, ferrite: 105, "plasma-crystal": 26 });
  });

  it("refits the active ship immediately and returns removed modules to storage", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const playerId = asPlayerId("player-1");
    const rootMap = world.runtime.maps["map-root"];
    const builder = Object.values(rootMap.structures).find((structure) => structure.structureTypeId === "builder-site");
    if (!builder) {
      throw new Error("Expected builder structure.");
    }
    rootMap.players["player-1"].position = { ...builder.position };

    const response = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "submitShipDesign",
      mode: "refit",
      hullId: "sparrow-scout",
      shipId: "ship-player-1",
      modules: [
        { hardpointId: "engine-rear", moduleId: "starter-thruster" },
        { hardpointId: "utility-belly", moduleId: "mining-laser" }
      ]
    });
    if (response[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }

    const activeShip = response[0].ships.find((ship) => ship.shipId === "ship-player-1");
    expect(activeShip?.ship.modules.map((module) => module.hardpointId)).toEqual(["engine-rear", "utility-belly"]);
    expect(rootMap.players["player-1"].modules.map((module) => module.hardpointId)).toEqual(["engine-rear", "utility-belly"]);

    const saved = await world.persistence.players.getPlayer(world.worldId, playerId);
    expect(saved?.craftedModules).toContainEqual({ moduleId: "pulse-cannon", quantity: 1 });
  });

  it("rejects submitted ship designs with incompatible hardpoint modules", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const builder = Object.values(rootMap.structures).find((structure) => structure.structureTypeId === "builder-site");
    if (!builder) {
      throw new Error("Expected builder structure.");
    }
    rootMap.players["player-1"].position = { ...builder.position };

    const response = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "submitShipDesign",
      mode: "refit",
      hullId: "sparrow-scout",
      shipId: "ship-player-1",
      modules: [{ hardpointId: "weapon-front", moduleId: "repair-beam" }]
    });
    if (response[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }

    const activeShip = response[0].ships.find((ship) => ship.shipId === "ship-player-1");
    expect(activeShip?.ship.modules).toEqual([
      { moduleId: "starter-thruster", hardpointId: "engine-rear", currentHealth: 30 },
      { moduleId: "pulse-cannon", hardpointId: "weapon-front", currentHealth: 24 },
      { moduleId: "mining-laser", hardpointId: "utility-belly", currentHealth: 20 }
    ]);
    expect(world.drainPendingMessages("player-1")).toContainEqual(
      expect.objectContaining({
        type: "actionFeedback",
        code: "ship_design_incompatible_module"
      })
    );
  });

  it("places map transitions on the nearest valid non-colliding position", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const foundry = Object.values(rootMap.foundries)[0];
    if (!foundry) {
      throw new Error("Expected root foundry.");
    }

    foundry.active = false;
    foundry.buildState = "destroyed";

    moveToExit(world, "player-1", "conn-root-depth-1");

    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });

    const depthMap = world.runtime.maps["map-depth-1"];
    const player = depthMap.players["player-1"];
    expect(player.mapId).toBe("map-depth-1");
    expect(player.position).not.toEqual({ x: 32, y: 192 });
    expect(
      isPositionBlocked(depthMap, player.position, getPlayerShipCollisionRadius(player), {
        excludeEntityId: player.id,
        includePlayers: true,
        includeEnemies: true
      })
    ).toBe(false);
  });

  it("plays the spatial slice through mining, cover, foundry unlock, map transition, and reconnect", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const player = rootMap.players["player-1"];
    const enemy = rootMap.enemies["enemy-root-1"];
    const foundry = Object.values(rootMap.foundries)[0];
    if (!enemy || !foundry) {
      throw new Error("Expected starter enemy and foundry.");
    }

    // Shape the root map into an open, deterministic acceptance space with one solid cover tile.
    for (const chunk of Object.values(rootMap.chunks)) {
      chunk.cells = Array(chunk.cells.length).fill(0);
    }
    player.position = { x: 48, y: 48 };
    player.velocity = { x: -720, y: 0 };
    rootMap.chunks["0,0"].cells[8] = TERRAIN_CELL_TYPES.commonRock;

    await world.tick();

    expect(player.position.x).toBe(48);
    expect(player.velocity.x).toBe(0);

    // Mine the blocking tile, confirm it becomes salvage, and update terrain memory from a snapshot.
    await world.handleMessage("player-1", {
      type: "activateModule",
      moduleId: "mining-laser",
      targetWorld: { x: 16, y: 48 },
      tick: 1
    });

    expect(rootMap.chunks["0,0"].cells[8]).toBe(0);
    expect(Object.values(rootMap.drops)).toContainEqual(
      expect.objectContaining({
        resources: expect.objectContaining({ rock: expect.any(Number) })
      })
    );

    let snapshot = world.getSnapshot("player-1");
    let rootChunk = snapshot.chunks.find((entry) => entry.chunkKey === "0,0");
    expect(rootChunk?.cells[8]).toBe(0);
    expect(rootChunk?.visibility[8]).toBe(2);

    // Put an enemy behind a new wall tile and verify line-of-sight hides it and keeps it idle.
    enemy.position = { x: 112, y: 48 };
    enemy.velocity = { x: 0, y: 0 };
    rootMap.chunks["0,0"].cells[10] = 1;

    snapshot = world.getSnapshot("player-1");
    rootChunk = snapshot.chunks.find((entry) => entry.chunkKey === "0,0");
    expect(snapshot.enemies.find((entry) => entry.id === enemy.id)).toBeUndefined();
    expect(rootChunk?.visibility[10]).toBe(2);
    expect(rootChunk?.visibility[11]).toBe(1);

    await world.tick();

    expect(enemy.aiState).toBe("idle");
    expect(enemy.velocity).toEqual({ x: 0, y: 0 });

    // Clear cover, destroy the foundry with forward weapon fire, and confirm the route unlocks.
    rootMap.chunks["0,0"].cells[10] = 0;
    foundry.health = 20;
    player.position = { x: foundry.position.x - 80, y: foundry.position.y };
    player.velocity = { x: 0, y: 0 };
    player.rotation = 0;

    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "weapon-front",
      tick: 2
    });
    for (let index = 0; index < 12; index += 1) {
      await world.tick();
    }

    expect(foundry.buildState).toBe("destroyed");
    expect(world.getSnapshot("player-1").deeperPathUnlocked).toBe(true);
    // The destruction is visible to the player as an explosion event for the client to play (§12).
    expect(world.getSnapshot("player-1").effects).toContainEqual(expect.objectContaining({ kind: "explosion", radius: 64 }));
    expect(world.drainPendingMessages("player-1")).toContainEqual(
      expect.objectContaining({
        type: "actionFeedback",
        code: "deeper_path_unlocked"
      })
    );

    // Transition into the deeper map and verify the destination resolves to a legal position.
    moveToExit(world, "player-1", "conn-root-depth-1");
    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });

    const depthMap = world.runtime.maps["map-depth-1"];
    const depthPlayer = depthMap.players["player-1"];
    expect(depthPlayer.mapId).toBe("map-depth-1");
    expect(
      isPositionBlocked(depthMap, depthPlayer.position, getPlayerShipCollisionRadius(depthPlayer), {
        excludeEntityId: depthPlayer.id,
        includePlayers: true,
        includeEnemies: true
      })
    ).toBe(false);

    // Disconnect/reload/reconnect through the same persistence bundle and verify spatial state survived.
    await world.disconnectPlayer("player-1");

    const savedPlayer = await world.persistence.players.getPlayer(world.worldId, asPlayerId("player-1"));
    expect(savedPlayer?.spawnPoint.mapId).toBe("map-depth-1");
    expect(savedPlayer?.terrainMemoryByMap["map-root"]?.chunks["0,0"]?.explored[8]).toBe(true);

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    await reloadedWorld.connectPlayer("player-1");

    expect(reloadedWorld.runtime.maps["map-root"].chunks["0,0"].cells[8]).toBe(0);
    expect(Object.values(reloadedWorld.runtime.maps["map-root"].foundries)[0]?.buildState).toBe("destroyed");
    expect(reloadedWorld.getSnapshot("player-1").mapId).toBe("map-depth-1");
    expect(reloadedWorld.getSnapshot("player-1").deeperPathUnlocked).toBe(true);
  });

  it("spawns foundry enemies, unlocks the deeper path after foundry destruction, and restores state after reconnect", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const initialEnemyCount = Object.keys(rootMap.enemies).length;
    expect(world.getSnapshot("player-1").deeperPathUnlocked).toBe(false);

    moveToExit(world, "player-1", "conn-root-depth-1");

    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });
    expect(world.getSnapshot("player-1").mapId).toBe("map-root");

    const foundry = Object.values(rootMap.foundries)[0];
    foundry.lastSpawnAt = Date.now() - foundry.spawnCooldownMs - 1;
    await world.tick();
    expect(Object.keys(rootMap.enemies).length).toBeGreaterThan(initialEnemyCount);
    expect(foundry.activeEnemyCount).toBeLessThanOrEqual(foundry.spawnCap);

    const visibleEnemySource = Object.values(rootMap.enemies)[0];
    if (!visibleEnemySource) {
      throw new Error("Expected spawned enemy.");
    }
    rootMap.players["player-1"].position = { x: visibleEnemySource.position.x, y: visibleEnemySource.position.y - 32 };
    await world.tick();

    const rotatedEnemy = world.getSnapshot("player-1").enemies.find((enemy) => enemy.id === visibleEnemySource.id);
    expect(rotatedEnemy?.rotation).toBeTypeOf("number");
    expect(Math.abs(rotatedEnemy?.rotation ?? 0)).toBeGreaterThan(0.01);

    foundry.health = 20;
    rootMap.players["player-1"].position = { x: foundry.position.x - 8, y: foundry.position.y };
    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "weapon-front",
      targetWorld: { x: foundry.position.x, y: foundry.position.y },
      tick: 10
    });
    for (let index = 0; index < 5; index += 1) {
      await world.tick();
    }

    expect(foundry.buildState).toBe("destroyed");
    expect(world.getSnapshot("player-1").deeperPathUnlocked).toBe(true);
    expect(world.drainPendingMessages("player-1")).toContainEqual(
      expect.objectContaining({
        type: "actionFeedback",
        code: "deeper_path_unlocked"
      })
    );

    await world.disconnectPlayer("player-1");

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    await reloadedWorld.connectPlayer("player-1");

    expect(Object.values(reloadedWorld.runtime.maps["map-root"].foundries)[0]?.buildState).toBe("destroyed");

    moveToExit(reloadedWorld, "player-1", "conn-root-depth-1");

    await reloadedWorld.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });
    expect(reloadedWorld.getSnapshot("player-1").mapId).toBe("map-depth-1");
  });

  it("generates a new map the first time a player goes through an undiscovered exit, and keeps it across reloads", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    // Clear the root gate and descend to the deeper prototype map.
    const rootFoundry = Object.values(world.runtime.maps["map-root"].foundries)[0];
    rootFoundry.active = false;
    rootFoundry.buildState = "destroyed";
    moveToExit(world, "player-1", "conn-root-depth-1");
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-root-depth-1" });
    expect(world.getSnapshot("player-1").mapId).toBe("map-depth-1");

    // The deeper map lists its undiscovered exit, and the return exit back to root.
    const depthSnapshot = world.getSnapshot("player-1");
    expect(depthSnapshot.exits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ connectionId: "conn-root-depth-1", direction: "ascend", discovered: true, locked: false }),
        expect.objectContaining({ connectionId: "conn-map-depth-1-down", direction: "descend", discovered: false, locked: false })
      ])
    );
    expect(depthSnapshot.nearbyExitId).toBe("conn-root-depth-1");

    // Travel is refused from across the map.
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-map-depth-1-down" });
    expect(world.drainPendingMessages("player-1")).toContainEqual(expect.objectContaining({ code: "map_exit_out_of_range" }));
    expect(world.runtime.maps["map-depth-2"]).toBeUndefined();

    moveToExit(world, "player-1", "conn-map-depth-1-down");
    expect(world.getSnapshot("player-1").nearbyExitId).toBe("conn-map-depth-1-down");
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-map-depth-1-down" });

    const generated = world.runtime.maps["map-depth-2"];
    expect(generated).toBeDefined();
    expect(world.getSnapshot("player-1").mapId).toBe("map-depth-2");
    expect(world.drainPendingMessages("player-1")).toContainEqual(expect.objectContaining({ code: "map_discovered" }));
    const arrived = generated.players["player-1"];
    expect(
      isPositionBlocked(generated, arrived.position, getPlayerShipCollisionRadius(arrived), {
        excludeEntityId: arrived.id,
        includePlayers: true,
        includeEnemies: true
      })
    ).toBe(false);

    // The world graph and the new map are persisted.
    const storedWorld = await world.persistence.worlds.getWorld(world.worldId);
    expect(storedWorld?.maps["map-depth-2"]).toMatchObject({ depth: 2, status: "discovered" });
    expect(storedWorld?.graph.connectionIndex["conn-map-depth-1-down"]).toMatchObject({ discovered: true, destinationMapId: "map-depth-2" });
    expect(storedWorld?.graph.connectionIndex["conn-map-depth-2-down"]?.discovered).toBe(false);

    // Going back up and down again reuses the same map instead of generating another one.
    moveToExit(world, "player-1", "conn-map-depth-1-down");
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-map-depth-1-down" });
    expect(world.getSnapshot("player-1").mapId).toBe("map-depth-1");
    moveToExit(world, "player-1", "conn-map-depth-1-down");
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-map-depth-1-down" });
    expect(world.runtime.maps["map-depth-2"]).toBe(generated);
    expect(Object.keys(world.runtime.maps)).toHaveLength(3);

    // Mine a cell, disconnect, and reload: the generated map comes back with the edit and the player on it.
    const chunk = generated.chunks["0,0"];
    chunk.cells[0] = 0;
    chunk.dirty = true;
    await world.disconnectPlayer("player-1");

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    await reloadedWorld.connectPlayer("player-1");
    expect(reloadedWorld.getSnapshot("player-1").mapId).toBe("map-depth-2");
    expect(reloadedWorld.runtime.maps["map-depth-2"].chunks["0,0"].cells[0]).toBe(0);
    expect(reloadedWorld.getSnapshot("player-1").exits.map((exit) => exit.connectionId).sort()).toEqual(
      ["conn-map-depth-1-down", "conn-map-depth-2-down"].sort()
    );
  });

  it("locks a discovered map's deeper exit while its foundry is active", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");
    const rootFoundry = Object.values(world.runtime.maps["map-root"].foundries)[0];
    rootFoundry.active = false;
    rootFoundry.buildState = "destroyed";

    // Force the next map to be a foundry arena so it is guaranteed a foundry.
    const exit = world.runtime.maps["map-depth-1"].connections.find((entry) => entry.id === "conn-map-depth-1-down");
    if (!exit) {
      throw new Error("Expected the deeper exit.");
    }
    exit.destinationArchetypeId = "foundry-arena";

    for (const connectionId of ["conn-root-depth-1", "conn-map-depth-1-down"]) {
      moveToExit(world, "player-1", connectionId);
      await world.handleMessage("player-1", { type: "changeMap", connectionId });
    }
    const arena = world.runtime.maps["map-depth-2"];
    const arenaFoundry = Object.values(arena.foundries)[0];
    expect(arenaFoundry?.active).toBe(true);
    expect(world.getSnapshot("player-1").deeperPathUnlocked).toBe(false);
    expect(world.getSnapshot("player-1").exits).toContainEqual(
      expect.objectContaining({ connectionId: "conn-map-depth-2-down", direction: "descend", locked: true })
    );

    world.drainPendingMessages("player-1");
    moveToExit(world, "player-1", "conn-map-depth-2-down");
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-map-depth-2-down" });
    expect(world.drainPendingMessages("player-1")).toContainEqual(expect.objectContaining({ code: "deeper_path_locked" }));
    expect(world.runtime.maps["map-depth-3"]).toBeUndefined();

    arenaFoundry.active = false;
    arenaFoundry.buildState = "destroyed";
    await world.handleMessage("player-1", { type: "changeMap", connectionId: "conn-map-depth-2-down" });
    expect(world.getSnapshot("player-1").mapId).toBe("map-depth-3");
  });

  it("adds the deeper exit to a world saved before exits could be discovered", async () => {
    const world = new GameWorld();
    await world.initialize();
    const stored = await world.persistence.worlds.getWorld(world.worldId);
    if (!stored) {
      throw new Error("Expected a stored world.");
    }
    // Recreate the old saved shape: no deeper exit and no map depths.
    delete stored.graph.connectionIndex["conn-map-depth-1-down"];
    for (const summary of Object.values(stored.maps)) {
      delete summary.depth;
    }
    await world.persistence.worlds.saveWorld(stored);

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    const migrated = await reloadedWorld.persistence.worlds.getWorld(world.worldId);
    expect(migrated?.graph.connectionIndex["conn-map-depth-1-down"]?.discovered).toBe(false);
    expect(migrated?.maps["map-depth-1"].depth).toBe(1);
    expect(reloadedWorld.runtime.maps["map-depth-1"].connections.map((entry) => entry.id)).toContain("conn-map-depth-1-down");
  });
});
