import { describe, expect, it } from "vitest";
import type { ChunkSnapshot, MapId } from "@healer/shared";
import { buildMinimapTerrainImage, colorForCell, computeMinimapScale, computeMinimapView } from "./minimap.js";

function chunk(chunkX: number, chunkY: number, cell: number, visibility: 0 | 1 | 2): ChunkSnapshot {
  return {
    chunkKey: `${chunkX}:${chunkY}`,
    chunkX,
    chunkY,
    cells: new Array(64).fill(cell),
    visibility: new Array(64).fill(visibility)
  };
}

function pixelAt(image: ReturnType<typeof buildMinimapTerrainImage>, x: number, y: number): number[] {
  const offset = (y * image.widthTiles + x) * 4;
  return Array.from(image.pixels.slice(offset, offset + 4));
}

describe("buildMinimapTerrainImage", () => {
  it("lays chunks out one pixel per tile and distinguishes unknown, remembered, and visible", () => {
    const image = buildMinimapTerrainImage({
      mapId: "root" as MapId,
      chunks: [chunk(0, 0, 0, 2), chunk(1, 0, 1, 1), chunk(0, 1, 1, 0), chunk(1, 1, 0, 1)]
    });

    expect(image.widthTiles).toBe(16);
    expect(image.heightTiles).toBe(16);
    expect(pixelAt(image, 3, 3)).toEqual([...colorForCell(0, 2)]);
    expect(pixelAt(image, 12, 3)).toEqual([...colorForCell(1, 1)]);
    // Unknown terrain is transparent even though the snapshot cell value is solid.
    expect(pixelAt(image, 3, 12)[3]).toBe(0);
    expect(pixelAt(image, 12, 12)).toEqual([...colorForCell(0, 1)]);
    expect(image.exploredCells).toBe(192);
    expect(image.totalCells).toBe(256);
  });

  it("keeps remembered cells dimmer than visible ones", () => {
    for (const cellType of [0, 1, 2, 3, 4, 5]) {
      const visible = colorForCell(cellType, 2);
      const remembered = colorForCell(cellType, 1);
      expect(remembered[0] + remembered[1] + remembered[2]).toBeLessThan(visible[0] + visible[1] + visible[2]);
    }
  });

  it("handles maps whose chunks do not start at the origin", () => {
    const image = buildMinimapTerrainImage({ mapId: "deeper" as MapId, chunks: [chunk(2, 3, 0, 2)] });
    expect(image.originTileX).toBe(16);
    expect(image.originTileY).toBe(24);
    expect(image.widthTiles).toBe(8);
    expect(image.mapId).toBe("deeper");
  });

  it("returns an empty image when no terrain has arrived", () => {
    const image = buildMinimapTerrainImage({ mapId: "root" as MapId, chunks: [] });
    expect(image.widthTiles).toBe(0);
    expect(image.totalCells).toBe(0);
  });
});

describe("computeMinimapScale", () => {
  it("fits wide and tall maps inside the minimap box", () => {
    expect(240 * computeMinimapScale(240, 100)).toBeLessThanOrEqual(240);
    expect(100 * computeMinimapScale(100, 400)).toBeLessThanOrEqual(200);
  });
});

describe("computeMinimapView", () => {
  const terrain = { originTileX: 0, originTileY: 0, widthTiles: 200, heightTiles: 160 };

  it("centers the local window on the ship", () => {
    const view = computeMinimapView("local", terrain, { x: 100 * 32, y: 80 * 32 });
    expect(view.x + view.width / 2).toBeCloseTo(100);
    expect(view.y + view.height / 2).toBeCloseTo(80);
  });

  it("clamps the local window to the map edge", () => {
    const view = computeMinimapView("local", terrain, { x: 0, y: 0 });
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
    const far = computeMinimapView("local", terrain, { x: 10_000 * 32, y: 10_000 * 32 });
    expect(far.x + far.width).toBe(200);
    expect(far.y + far.height).toBe(160);
  });

  it("shows the whole map in sector mode or on small maps", () => {
    expect(computeMinimapView("sector", terrain, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 200, height: 160 });
    const small = { originTileX: 0, originTileY: 0, widthTiles: 24, heightTiles: 16 };
    expect(computeMinimapView("local", small, { x: 50, y: 50 })).toEqual({ x: 0, y: 0, width: 24, height: 16 });
  });
});
