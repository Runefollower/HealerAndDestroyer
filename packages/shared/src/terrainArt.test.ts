import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_VARIANT_COUNT, selectTerrainVariant } from "./terrainArt.js";

describe("terrain art selection", () => {
  it("returns a stable variant for the same tile input", () => {
    const first = selectTerrainVariant({
      mapId: "map-root",
      chunkX: 1,
      chunkY: 2,
      cellIndex: 17,
      cellType: 1
    });
    const second = selectTerrainVariant({
      mapId: "map-root",
      chunkX: 1,
      chunkY: 2,
      cellIndex: 17,
      cellType: 1
    });

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(DEFAULT_TERRAIN_VARIANT_COUNT);
  });

  it("changes variants when tile identity changes", () => {
    const base = selectTerrainVariant({
      mapId: "map-root",
      chunkX: 0,
      chunkY: 0,
      cellIndex: 0,
      cellType: 1
    });
    const shifted = selectTerrainVariant({
      mapId: "map-root",
      chunkX: 0,
      chunkY: 0,
      cellIndex: 1,
      cellType: 1
    });

    expect(base).not.toBe(shifted);
  });
});
