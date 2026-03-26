import { describe, expect, it } from "vitest";
import { createInMemoryPersistence } from "./memory.js";
import { asMapId, asPlayerId, asShipId, asWorldId } from "@healer/shared";

describe("in-memory persistence", () => {
  it("restores player and ship state", async () => {
    const persistence = createInMemoryPersistence();
    const worldId = asWorldId("world-1");
    const playerId = asPlayerId("player-1");
    const shipId = asShipId("ship-1");

    await persistence.players.savePlayer({
      playerId,
      worldId,
      resourceCounts: { ferrite: 10 },
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

    const restored = await persistence.players.getPlayer(worldId, playerId);
    expect(restored?.activeShipId).toBe(shipId);
    expect(restored?.spawnPoint.mapId).toBe(asMapId("map-root"));
  });
});
