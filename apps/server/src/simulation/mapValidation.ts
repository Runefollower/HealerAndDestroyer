import { TERRAIN_CELL_TYPES, getTerrainMaterialDefinition } from "@healer/shared";
import type { MapValidationRules } from "./mapArchetypes.js";

export interface TilePoint {
  // x/y are tile coordinates within the generated map grid.
  x: number;
  y: number;
}

// MapAnchorName lists the gameplay locations every generated map must keep usable.
export type MapAnchorName = "spawn" | "builder" | "foundry" | "enemy" | "sourceExit" | "destinationEntry";

export type MapAnchors = Record<MapAnchorName, TilePoint>;

export interface TileGrid {
  widthTiles: number;
  heightTiles: number;
  // cells is the row-major terrain cell array (index = y * widthTiles + x).
  cells: readonly number[];
}

export type MapValidationIssueCode =
  | "anchor-out-of-bounds"
  | "anchor-blocked"
  | "anchors-too-close"
  | "anchor-unreachable"
  | "volatile-near-anchor"
  | "material-shortfall";

export interface MapValidationIssue {
  code: MapValidationIssueCode;
  message: string;
}

// The enemy spawn anchor sits inside the foundry room by design, so it is exempt from spacing checks.
const spacedAnchorNames: MapAnchorName[] = ["spawn", "builder", "foundry", "sourceExit", "destinationEntry"];

// Thrown by the generator when a seed/archetype pair produces a map that breaks validation rules.
export class MapGenerationError extends Error {
  constructor(
    readonly seed: string,
    readonly archetypeId: string,
    readonly issues: MapValidationIssue[]
  ) {
    super(`Generated map "${seed}" (${archetypeId}) failed validation: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "MapGenerationError";
  }
}

// Checks a generated grid against an archetype's rules and returns every problem found.
// An empty array means the map is safe to hand to the runtime.
export function validateMapGrid(grid: TileGrid, anchors: MapAnchors, rules: MapValidationRules): MapValidationIssue[] {
  const issues: MapValidationIssue[] = [];
  const anchorEntries = Object.entries(anchors) as Array<[MapAnchorName, TilePoint]>;

  // Bounds: everything else assumes anchors index into the grid.
  for (const [name, tile] of anchorEntries) {
    if (!isInBounds(grid, tile.x, tile.y)) {
      issues.push({ code: "anchor-out-of-bounds", message: `${name} anchor (${tile.x},${tile.y}) is outside the map` });
    }
  }
  if (issues.length > 0) {
    return issues;
  }

  // Clearance: each anchor needs open space around it so ships and structures are not wedged into rock.
  for (const [name, tile] of anchorEntries) {
    if (!hasOpenClearance(grid, tile.x, tile.y, rules.anchorClearanceTiles)) {
      issues.push({
        code: "anchor-blocked",
        message: `${name} anchor (${tile.x},${tile.y}) lacks ${rules.anchorClearanceTiles}-tile open clearance`
      });
    }
  }

  // Spacing: distinct gameplay locations must not stack on top of each other.
  for (let first = 0; first < spacedAnchorNames.length; first += 1) {
    for (let second = first + 1; second < spacedAnchorNames.length; second += 1) {
      const firstName = spacedAnchorNames[first];
      const secondName = spacedAnchorNames[second];
      const distance = Math.hypot(anchors[firstName].x - anchors[secondName].x, anchors[firstName].y - anchors[secondName].y);
      if (distance < rules.minAnchorSpacingTiles) {
        issues.push({
          code: "anchors-too-close",
          message: `${firstName} and ${secondName} anchors are ${distance.toFixed(1)} tiles apart (min ${rules.minAnchorSpacingTiles})`
        });
      }
    }
  }

  // Reachability: a ship must be able to fly from spawn to every anchor without mining.
  const reachable = findNavigableTiles(grid, anchors.spawn, rules.minPassageClearanceTiles);
  for (const [name, tile] of anchorEntries) {
    if (name !== "spawn" && !reachable.has(tile.y * grid.widthTiles + tile.x)) {
      issues.push({
        code: "anchor-unreachable",
        message: `${name} anchor (${tile.x},${tile.y}) is not reachable from spawn through ${rules.minPassageClearanceTiles}-tile clearance passages`
      });
    }
  }

  // Volatile placement: unstable crystals near anchors would blow open protected rooms or hurt new players.
  for (const [name, tile] of anchorEntries) {
    if (hasCellWithin(grid, tile, rules.volatileSafeRadiusTiles, TERRAIN_CELL_TYPES.unstableCrystal)) {
      issues.push({
        code: "volatile-near-anchor",
        message: `unstable crystal within ${rules.volatileSafeRadiusTiles} tiles of ${name} anchor`
      });
    }
  }

  // Resource distribution: each archetype promises a minimum amount of each material.
  const counts = countCells(grid);
  for (const [cellTypeText, minimum] of Object.entries(rules.minMaterialCounts)) {
    const cellType = Number(cellTypeText);
    const actual = counts.get(cellType) ?? 0;
    if (minimum !== undefined && actual < minimum) {
      issues.push({
        code: "material-shortfall",
        message: `${getTerrainMaterialDefinition(cellType).name} count ${actual} is below minimum ${minimum}`
      });
    }
  }

  return issues;
}

// Flood-fills from a start tile through tiles whose whole (2r+1)x(2r+1) neighborhood is open,
// approximating where a ship of the given clearance can fly. Returns flat tile indexes.
export function findNavigableTiles(grid: TileGrid, start: TilePoint, clearanceTiles: number): Set<number> {
  const visited = new Set<number>();
  const stack: TilePoint[] = [start];

  while (stack.length > 0) {
    const tile = stack.pop()!;
    const index = tile.y * grid.widthTiles + tile.x;
    if (!isInBounds(grid, tile.x, tile.y) || visited.has(index) || !hasOpenClearance(grid, tile.x, tile.y, clearanceTiles)) {
      continue;
    }
    visited.add(index);
    stack.push({ x: tile.x + 1, y: tile.y }, { x: tile.x - 1, y: tile.y }, { x: tile.x, y: tile.y + 1 }, { x: tile.x, y: tile.y - 1 });
  }

  return visited;
}

// Returns true when every tile in the square of the given radius around (x, y) is open space.
function hasOpenClearance(grid: TileGrid, tileX: number, tileY: number, radius: number): boolean {
  for (let y = tileY - radius; y <= tileY + radius; y += 1) {
    for (let x = tileX - radius; x <= tileX + radius; x += 1) {
      if (!isInBounds(grid, x, y) || grid.cells[y * grid.widthTiles + x] !== TERRAIN_CELL_TYPES.empty) {
        return false;
      }
    }
  }
  return true;
}

// Returns true when a cell of the given type exists in the square of the given radius around a tile.
function hasCellWithin(grid: TileGrid, center: TilePoint, radius: number, cellType: number): boolean {
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      if (isInBounds(grid, x, y) && grid.cells[y * grid.widthTiles + x] === cellType) {
        return true;
      }
    }
  }
  return false;
}

// Tallies how many cells of each terrain type the grid contains.
export function countCells(grid: TileGrid): Map<number, number> {
  const counts = new Map<number, number>();
  for (const cell of grid.cells) {
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return counts;
}

// Bounds check for tile coordinates.
function isInBounds(grid: TileGrid, tileX: number, tileY: number): boolean {
  return tileX >= 0 && tileY >= 0 && tileX < grid.widthTiles && tileY < grid.heightTiles;
}
