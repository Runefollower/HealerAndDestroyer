import { describe, expect, it } from "vitest";
import { clientMessageSchema, createSnapshotMessage } from "./network.js";
import { asEntityId, asMapId, asPlayerId } from "./ids.js";

describe("network schemas", () => {
  it("validates client movement messages", () => {
    const parsed = clientMessageSchema.parse({
      type: "moveInput",
      thrustForward: true,
      thrustReverse: false,
      rotateLeft: false,
      rotateRight: true,
      aimWorld: { x: 10, y: 20 },
      tick: 5
    });

    expect(parsed.type).toBe("moveInput");
  });

  it("builds a compact snapshot payload", () => {
    const snapshot = createSnapshotMessage(
      12,
      asPlayerId("player-1"),
      asMapId("map-root"),
      {
        id: asMapId("map-root"),
        seed: "seed",
        width: 2,
        height: 2,
        chunks: {
          "0,0": { chunkX: 0, chunkY: 0, cells: [1, 0, 0, 1], dirty: false, active: true }
        },
        players: {
          a: {
            id: asEntityId("ship-1"),
            playerId: asPlayerId("player-1"),
            shipId: "ship-1",
            mapId: asMapId("map-root"),
            position: { x: 0, y: 0 },
            velocity: { x: 1, y: 1 },
            rotation: 0,
            angularVelocity: 0,
            hull: 20,
            maxHull: 20,
            power: 10,
            maxPower: 10,
            modules: [],
            inventory: { ferrite: 5 }
          }
        },
        enemies: {},
        projectiles: {},
        structures: {},
        drops: {},
        connections: []
      },
      {
        id: asEntityId("ship-1"),
        playerId: asPlayerId("player-1"),
        shipId: "ship-1",
        mapId: asMapId("map-root"),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 1 },
        rotation: 0,
        angularVelocity: 0,
        hull: 20,
        maxHull: 20,
        power: 10,
        maxPower: 10,
        modules: [],
        inventory: { ferrite: 5 }
      },
      true
    );

    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.builderSiteNearby).toBe(true);
    expect(snapshot.chunks).toHaveLength(1);
  });
});
