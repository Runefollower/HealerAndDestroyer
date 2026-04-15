import { describe, expect, it } from "vitest";
import { TERRAIN_CELL_TYPES, asMapId, type ActiveMapState } from "@healer/shared";
import { damageTerrainAt, TILE_SIZE } from "./terrain.js";

describe("terrain damage", () => {
  it("detonates unstable crystals and clears nearby solid blocks", () => {
    const map = createTestMap();
    const cells = map.chunks["0,0"].cells;
    cells[9] = TERRAIN_CELL_TYPES.unstableCrystal;
    cells[8] = TERRAIN_CELL_TYPES.commonRock;
    cells[10] = TERRAIN_CELL_TYPES.ferriteOre;
    cells[17] = TERRAIN_CELL_TYPES.ancientStone;

    const result = damageTerrainAt(map, { x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE }, 12, 1);

    expect(result.destroyed).toBe(true);
    expect(cells[9]).toBe(TERRAIN_CELL_TYPES.empty);
    expect(cells[8]).toBe(TERRAIN_CELL_TYPES.empty);
    expect(cells[10]).toBe(TERRAIN_CELL_TYPES.empty);
    expect(cells[17]).toBe(TERRAIN_CELL_TYPES.empty);
    expect(result.resources).toEqual({
      "plasma-crystal": 2,
      rock: 2,
      ferrite: 2,
      stone: 2
    });
  });
});

// Creates the minimal active map shape needed to exercise terrain cell mutation.
function createTestMap(): ActiveMapState {
  return {
    id: asMapId("test-map"),
    seed: "test-seed",
    width: 8 * TILE_SIZE,
    height: 8 * TILE_SIZE,
    chunks: {
      "0,0": {
        chunkX: 0,
        chunkY: 0,
        cells: new Array(64).fill(TERRAIN_CELL_TYPES.empty),
        dirty: false,
        active: true
      }
    },
    players: {},
    enemies: {},
    projectiles: {},
    structures: {},
    foundries: {},
    drops: {},
    connections: []
  };
}
