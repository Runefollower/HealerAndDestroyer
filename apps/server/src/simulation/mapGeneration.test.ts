import { describe, expect, it } from "vitest";
import { TERRAIN_CELL_TYPES, isEmptyTerrainCell, isSolidTerrainCell } from "@healer/shared";
import { CHUNK_SIZE, GENERATED_TILE_SIZE, generateCaveMapLayout, type GeneratedMapLayout } from "./mapGeneration.js";

describe("map generation", () => {
  it("generates the same cave layout for the same seed", () => {
    const first = generateCaveMapLayout("stable-seed", 12, 9);
    const second = generateCaveMapLayout("stable-seed", 12, 9);

    expect(first.widthTiles).toBe(96);
    expect(first.heightTiles).toBe(72);
    expect(first.chunks).toEqual(second.chunks);
    expect(first.spawnPoint).toEqual(second.spawnPoint);
    expect(first.builderPosition).toEqual(second.builderPosition);
    expect(first.foundryPosition).toEqual(second.foundryPosition);
    expect(first.sourceAnchor).toEqual(second.sourceAnchor);
  });

  it("varies cave terrain for different seeds", () => {
    const first = generateCaveMapLayout("alpha-seed", 12, 9);
    const second = generateCaveMapLayout("beta-seed", 12, 9);

    expect(flattenCells(first)).not.toEqual(flattenCells(second));
  });

  it("keeps required gameplay anchors open and connected", () => {
    const layout = generateCaveMapLayout("connectivity-seed", 12, 9);
    const spawnTile = worldToTile(layout.spawnPoint);
    const builderTile = worldToTile(layout.builderPosition);
    const foundryTile = worldToTile(layout.foundryPosition);

    expect(getCell(layout, spawnTile.x, spawnTile.y)).toBe(TERRAIN_CELL_TYPES.empty);
    expect(getCell(layout, builderTile.x, builderTile.y)).toBe(TERRAIN_CELL_TYPES.empty);
    expect(getCell(layout, foundryTile.x, foundryTile.y)).toBe(TERRAIN_CELL_TYPES.empty);
    expect(getCell(layout, layout.sourceAnchor.x, layout.sourceAnchor.y)).toBe(TERRAIN_CELL_TYPES.empty);
    expect(getCell(layout, layout.destinationAnchor.x, layout.destinationAnchor.y)).toBe(TERRAIN_CELL_TYPES.empty);

    const reachable = findReachableOpenTiles(layout, spawnTile);
    expect(reachable.has(createTileKey(builderTile.x, builderTile.y))).toBe(true);
    expect(reachable.has(createTileKey(foundryTile.x, foundryTile.y))).toBe(true);
    expect(reachable.has(createTileKey(layout.sourceAnchor.x, layout.sourceAnchor.y))).toBe(true);
  });

  it("includes mineable solid terrain next to generated open space", () => {
    const layout = generateCaveMapLayout("ore-seed", 12, 9);
    const cells = flattenCells(layout);
    const mineableWallCount = cells.filter((cell, index) => {
      if (!isSolidTerrainCell(cell)) {
        return false;
      }
      const tileX = index % layout.widthTiles;
      const tileY = Math.floor(index / layout.widthTiles);
      return hasOpenNeighbor(layout, tileX, tileY);
    }).length;

    expect(mineableWallCount).toBeGreaterThan(20);
  });

  it("places first-pass ore and rare volatile materials", () => {
    const layout = generateCaveMapLayout("ore-variety-seed", 12, 9);
    const cells = flattenCells(layout);

    expect(cells).toContain(TERRAIN_CELL_TYPES.ferriteOre);
    expect(cells).toContain(TERRAIN_CELL_TYPES.plasmaCrystal);
    expect(cells).toContain(TERRAIN_CELL_TYPES.ancientStone);
    expect(cells).toContain(TERRAIN_CELL_TYPES.unstableCrystal);
  });
});

// Converts the generated chunk dictionary back into a flat row-major cell array for comparisons.
function flattenCells(layout: GeneratedMapLayout): number[] {
  const cells: number[] = [];
  for (let tileY = 0; tileY < layout.heightTiles; tileY += 1) {
    for (let tileX = 0; tileX < layout.widthTiles; tileX += 1) {
      cells.push(getCell(layout, tileX, tileY));
    }
  }
  return cells;
}

// Finds every open tile reachable from the provided start tile using four-way movement.
function findReachableOpenTiles(layout: GeneratedMapLayout, start: { x: number; y: number }): Set<string> {
  const reachable = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const tile = queue.shift()!;
    const key = createTileKey(tile.x, tile.y);
    if (reachable.has(key) || !isEmptyTerrainCell(getCell(layout, tile.x, tile.y))) {
      continue;
    }

    reachable.add(key);
    queue.push(
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 }
    );
  }

  return reachable;
}

// Returns whether a tile has a neighboring floor tile and could be mined from open space.
function hasOpenNeighbor(layout: GeneratedMapLayout, tileX: number, tileY: number): boolean {
  return [
    { x: tileX + 1, y: tileY },
    { x: tileX - 1, y: tileY },
    { x: tileX, y: tileY + 1 },
    { x: tileX, y: tileY - 1 }
  ].some((neighbor) => isEmptyTerrainCell(getCell(layout, neighbor.x, neighbor.y)));
}

// Reads one tile value from the generated chunk dictionary.
function getCell(layout: GeneratedMapLayout, tileX: number, tileY: number): number {
  if (tileX < 0 || tileY < 0 || tileX >= layout.widthTiles || tileY >= layout.heightTiles) {
    return TERRAIN_CELL_TYPES.commonRock;
  }

  const chunkX = Math.floor(tileX / CHUNK_SIZE);
  const chunkY = Math.floor(tileY / CHUNK_SIZE);
  const localX = tileX % CHUNK_SIZE;
  const localY = tileY % CHUNK_SIZE;
  return layout.chunks[`${chunkX},${chunkY}`]?.cells[localY * CHUNK_SIZE + localX] ?? TERRAIN_CELL_TYPES.commonRock;
}

// Converts world-space positions back to tile coordinates for anchor validation.
function worldToTile(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.floor(position.x / GENERATED_TILE_SIZE),
    y: Math.floor(position.y / GENERATED_TILE_SIZE)
  };
}

// Creates the stable key used by the reachability set.
function createTileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}
