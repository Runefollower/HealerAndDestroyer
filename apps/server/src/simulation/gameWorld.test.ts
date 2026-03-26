import { describe, expect, it } from "vitest";
import { GameWorld } from "./gameWorld.js";

describe("GameWorld", () => {
  it("spawns a player into the persistent starter world", async () => {
    const world = new GameWorld();
    await world.initialize();
    const player = await world.connectPlayer("player-1");

    expect(player.spawnPoint.mapId).toBeDefined();
    expect(world.getSnapshot("player-1").players).toHaveLength(1);
  });

  it("mines terrain and restores the edited chunk state on reload", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const map = world.runtime.maps["map-root"];
    map.players["player-1"].position = { x: 48, y: 48 };
    const beforeCell = map.chunks["0,0"].cells[0];
    expect(beforeCell).toBeGreaterThan(0);

    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "mining-laser",
      targetWorld: { x: 16, y: 16 },
      tick: 1
    });

    for (let index = 0; index < 20; index += 1) {
      world.tick();
    }

    expect(map.chunks["0,0"].cells[0]).toBe(0);

    const reloadedWorld = new GameWorld(world.persistence);
    await reloadedWorld.initialize();
    expect(reloadedWorld.runtime.maps["map-root"].chunks["0,0"].cells[0]).toBe(0);
  });

  it("applies movement, combat, and salvage flow", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    await world.handleMessage("player-1", {
      type: "moveInput",
      thrustForward: true,
      thrustReverse: false,
      rotateLeft: false,
      rotateRight: false,
      aimWorld: { x: 180, y: 64 },
      tick: 1
    });
    world.tick();

    const before = world.getSnapshot("player-1").players[0].position.x;
    expect(before).toBeGreaterThan(64);

    const runtimeMap = world.runtime.maps["map-root"];
    runtimeMap.enemies["enemy-1"].position = { x: before + 5, y: 64 };

    await world.handleMessage("player-1", {
      type: "fireWeapon",
      weaponHardpointId: "pulse-cannon",
      targetWorld: { x: before + 10, y: 64 },
      tick: 2
    });

    for (let index = 0; index < 6; index += 1) {
      world.tick();
    }

    const snapshot = world.getSnapshot("player-1");
    expect(snapshot.inventory.ferrite).toBeGreaterThan(25);
    expect(runtimeMap.enemies["enemy-1"]).toBeUndefined();
  });

  it("supports builder crafting, install/remove, and map transition", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    rootMap.players["player-1"].position = { x: 96, y: 96 };

    const builderResponses = await world.handleMessage("player-1", { type: "interact" });
    expect(builderResponses[0]?.type).toBe("builderState");

    const crafted = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "craftModule",
      targetId: "starter-thruster"
    });
    expect(crafted[0]?.type).toBe("builderState");
    if (crafted[0]?.type !== "builderState") {
      throw new Error("Expected builder state response.");
    }
    expect(crafted[0].craftedModules.some((entry) => entry.moduleId === "starter-thruster")).toBe(true);

    const installed = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "installModule",
      targetId: "starter-thruster",
      shipId: String(crafted[0].activeShipId),
      hardpointId: "engine-rear"
    });
    expect(installed[0]?.type).toBe("builderState");

    const buildNewShip = await world.handleMessage("player-1", {
      type: "builderAction",
      action: "startShipBuild",
      targetId: "warden-healer"
    });
    expect(buildNewShip[0]?.type).toBe("builderState");

    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });

    expect(world.getSnapshot("player-1").mapId).toBe("map-depth-1");
  });
});



