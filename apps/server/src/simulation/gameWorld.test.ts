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

  it("supports builder site interaction and map transition", async () => {
    const world = new GameWorld();
    await world.initialize();
    await world.connectPlayer("player-1");

    const rootMap = world.runtime.maps["map-root"];
    rootMap.players["player-1"].position = { x: 96, y: 96 };

    const builderResponses = await world.handleMessage("player-1", { type: "interact" });
    expect(builderResponses[0]?.type).toBe("builderState");

    await world.handleMessage("player-1", {
      type: "changeMap",
      connectionId: "conn-root-depth-1"
    });

    expect(world.getSnapshot("player-1").mapId).toBe("map-depth-1");
  });
});

