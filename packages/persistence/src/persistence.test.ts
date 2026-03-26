import { describe, expect, it } from "vitest";
import { createInMemoryPersistence } from "./memory.js";
import { asMapId, asPlayerId, asShipId, asWorldId } from "@healer/shared";

describe("in-memory persistence", () => {
  it("restores player, ship, and crafted module state", async () => {
    const persistence = createInMemoryPersistence();
    const worldId = asWorldId("world-1");
    const playerId = asPlayerId("player-1");
    const shipId = asShipId("ship-1");

    await persistence.players.savePlayer({
      playerId,
      worldId,
      resourceCounts: { ferrite: 10 },
      craftedModules: [{ moduleId: "repair-beam", quantity: 1 }],
      shipStable: {
        "ship-1": {
          id: shipId,
          name: "Sparrow",
          hullId: "sparrow-scout",
          modules: [],
          hullIntegrity: 100,
          status: "active"
        }
      },
      activeShipId: shipId,
      spawnPoint: {
        mapId: asMapId("map-root"),
        position: { x: 16, y: 16 }
      },
      teamId: null,
      discoveredMapIds: [asMapId("map-root")],
      updatedAt: Date.now()
    });

    await persistence.maps.saveMapState(worldId, {
      map: {
        id: asMapId("map-root"),
        seed: "seed",
        status: "active",
        connectionIds: [],
        lastActivatedAt: Date.now()
      },
      chunkDeltas: [{ chunkKey: "0,0", changedCells: [{ index: 0, value: 0 }] }]
    });

    const restored = await persistence.players.getPlayer(worldId, playerId);
    const restoredMap = await persistence.maps.getMapState(worldId, asMapId("map-root"));
    expect(restored?.activeShipId).toBe(shipId);
    expect(restored?.craftedModules[0]?.moduleId).toBe("repair-beam");
    expect(restoredMap?.chunkDeltas[0]?.chunkKey).toBe("0,0");
  });
});
