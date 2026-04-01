import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asPlayerId, distance } from "@healer/shared";
import { GameWorld } from "./gameWorld.js";
import { getPlayerShipCollisionRadius, getStructureCollisionRadius, isPositionBlocked } from "./collision.js";

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
    expect(player.rotation).toBeCloseTo(Math.PI / 2 + 0.1, 5);

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

  it("queues throttled action feedback for locked routes and rejected module use", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

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
    save.resourceCounts = { ferrite: 0, "plasma-crystal": 0 };
    await world.persistence.players.savePlayer(save);

    const rootMap = world.runtime.maps["map-root"];
    const runtimePlayer = rootMap.players["player-1"];
    runtimePlayer.inventory = { ferrite: 0, "plasma-crystal": 0 };
    runtimePlayer.position = { x: 96, y: 96 };
    rootMap.drops["test-drop"] = {
      id: "test-drop" as never,
      mapId: rootMap.id,
      position: { x: 96, y: 96 },
      resources: { ferrite: 80, "plasma-crystal": 20 }
    };

    await world.tick();

    const refreshedSave = await world.persistence.players.getPlayer(world.worldId, playerId);
    expect(runtimePlayer.inventory).toEqual({ ferrite: 80, "plasma-crystal": 20 });
    expect(refreshedSave?.resourceCounts).toEqual({ ferrite: 80, "plasma-crystal": 20 });

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
    expect(spentSave?.resourceCounts).toEqual({ ferrite: 0, "plasma-crystal": 0 });
    expect(rootMap.players["player-1"].inventory).toEqual({ ferrite: 0, "plasma-crystal": 0 });
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
    save.resourceCounts = { ferrite: 200, "plasma-crystal": 50 };
    await world.persistence.players.savePlayer(save);

    const rootMap = world.runtime.maps["map-root"];
    rootMap.players["player-1"].inventory = { ferrite: 200, "plasma-crystal": 50 };
    rootMap.players["player-1"].position = { x: 96, y: 96 };

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

  it("spawns foundry enemies, unlocks the deeper path after foundry destruction, and restores state after reconnect", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    const initialEnemyCount = Object.keys(rootMap.enemies).length;
    expect(world.getSnapshot("player-1").deeperPathUnlocked).toBe(false);

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

    const rotatedEnemy = world.getSnapshot("player-1").enemies[0];
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

    await reloadedWorld.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });
    expect(reloadedWorld.getSnapshot("player-1").mapId).toBe("map-depth-1");
  });
});
