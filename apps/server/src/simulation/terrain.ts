import {
  TERRAIN_CELL_TYPES,
  addResourceMaps,
  asEntityId,
  getTerrainMaterialDefinition,
  isEmptyTerrainCell,
  type ActiveMapState,
  type ResourceMap
} from "@healer/shared";
import { CHUNK_SIZE } from "./createWorld.js";

// TILE_SIZE converts between pixel/world coordinates and persisted terrain cells.
export const TILE_SIZE = 32;

export interface TileAddress {
  // Absolute tile coordinates in the active map.
  tileX: number;
  tileY: number;
  // Chunk lookup key and chunk coordinates for map.chunks.
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  // Linear cell index inside the chunk's CHUNK_SIZE by CHUNK_SIZE cell array.
  cellIndex: number;
}

export interface TerrainDamageResult {
  // hit means a solid terrain cell was targeted, even if damage was too low to break it.
  hit: boolean;
  // destroyed means the cell was cleared and resources were produced.
  destroyed: boolean;
  // resources carries the debris payout when terrain is destroyed.
  resources?: ResourceMap;
}

// Converts a world-space position into the chunk/cell address used by terrain storage.
export function worldToTile(position: { x: number; y: number }): TileAddress | null {
  const tileX = Math.floor(position.x / TILE_SIZE);
  const tileY = Math.floor(position.y / TILE_SIZE);
  if (tileX < 0 || tileY < 0) {
    return null;
  }

  const chunkX = Math.floor(tileX / CHUNK_SIZE);
  const chunkY = Math.floor(tileY / CHUNK_SIZE);
  const localX = tileX % CHUNK_SIZE;
  const localY = tileY % CHUNK_SIZE;
  return {
    tileX,
    tileY,
    chunkKey: `${chunkX},${chunkY}`,
    chunkX,
    chunkY,
    cellIndex: localY * CHUNK_SIZE + localX
  };
}

// Applies unlimited mining damage and returns whether the terrain cell was actually cleared.
export function mineTerrainAt(map: ActiveMapState, position: { x: number; y: number }, tickCounter: number, yieldMultiplier = 1): boolean {
  return damageTerrainAt(map, position, Number.POSITIVE_INFINITY, tickCounter, yieldMultiplier).destroyed;
}

// Applies weapon/mining damage to one terrain cell and creates a resource drop on destruction.
export function damageTerrainAt(
  map: ActiveMapState,
  position: { x: number; y: number },
  damage: number,
  tickCounter: number,
  yieldMultiplier = 1
): TerrainDamageResult {
  // Resolve the target tile and reject positions outside known terrain.
  const tile = worldToTile(position);
  if (!tile) {
    return { hit: false, destroyed: false };
  }
  const chunk = map.chunks[tile.chunkKey];
  if (!chunk) {
    return { hit: false, destroyed: false };
  }
  const currentValue = chunk.cells[tile.cellIndex] ?? 0;
  if (isEmptyTerrainCell(currentValue)) {
    return { hit: false, destroyed: false };
  }

  if (damage < getTerrainCriticalDamage(currentValue)) {
    return { hit: true, destroyed: false };
  }

  // Clear the terrain cell, mark the chunk for persistence, and spawn deterministic-ish debris id data.
  const material = getTerrainMaterialDefinition(currentValue);
  chunk.cells[tile.cellIndex] = TERRAIN_CELL_TYPES.empty;
  chunk.dirty = true;
  let resources = createTerrainDebrisResources(currentValue, yieldMultiplier);
  if (material.explosionRadiusTiles) {
    resources = addResourceMaps(resources, destroyNearbyTerrain(map, tile, material.explosionRadiusTiles, yieldMultiplier));
  }
  map.drops[`terrain-${tile.chunkKey}-${tile.cellIndex}-${tickCounter}`] = {
    id: asEntityId(`terrain-${tile.chunkKey}-${tile.cellIndex}-${tickCounter}`),
    mapId: map.id,
    position: { x: position.x, y: position.y },
    resources
  };
  return { hit: true, destroyed: true, resources };
}

// Maps prototype terrain material values to the damage required to break them.
function getTerrainCriticalDamage(cellValue: number): number {
  return getTerrainMaterialDefinition(cellValue).breakDamage;
}

// Converts a terrain material value into the resources dropped after destruction.
function createTerrainDebrisResources(cellValue: number, yieldMultiplier: number): ResourceMap {
  const baseResources = getTerrainMaterialDefinition(cellValue).debrisResources;
  return Object.fromEntries(
    Object.entries(baseResources).map(([resourceId, amount]) => [resourceId, Math.max(1, Math.round(amount * yieldMultiplier))])
  );
}

// Clears solid terrain around volatile materials and returns the combined debris payout.
function destroyNearbyTerrain(map: ActiveMapState, origin: TileAddress, radiusTiles: number, yieldMultiplier: number): ResourceMap {
  let resources: ResourceMap = {};
  for (let tileY = origin.tileY - radiusTiles; tileY <= origin.tileY + radiusTiles; tileY += 1) {
    for (let tileX = origin.tileX - radiusTiles; tileX <= origin.tileX + radiusTiles; tileX += 1) {
      if (tileX === origin.tileX && tileY === origin.tileY) {
        continue;
      }
      const tile = tileAddressFromTileCoordinates(tileX, tileY);
      if (!tile) {
        continue;
      }
      const chunk = map.chunks[tile.chunkKey];
      if (!chunk) {
        continue;
      }
      const cellValue = chunk.cells[tile.cellIndex] ?? TERRAIN_CELL_TYPES.empty;
      if (isEmptyTerrainCell(cellValue)) {
        continue;
      }
      chunk.cells[tile.cellIndex] = TERRAIN_CELL_TYPES.empty;
      chunk.dirty = true;
      resources = addResourceMaps(resources, createTerrainDebrisResources(cellValue, yieldMultiplier));
    }
  }
  return resources;
}

// Converts absolute tile coordinates into a chunk/cell address without requiring world pixels.
function tileAddressFromTileCoordinates(tileX: number, tileY: number): TileAddress | null {
  if (tileX < 0 || tileY < 0) {
    return null;
  }
  const chunkX = Math.floor(tileX / CHUNK_SIZE);
  const chunkY = Math.floor(tileY / CHUNK_SIZE);
  const localX = tileX % CHUNK_SIZE;
  const localY = tileY % CHUNK_SIZE;
  return {
    tileX,
    tileY,
    chunkKey: `${chunkX},${chunkY}`,
    chunkX,
    chunkY,
    cellIndex: localY * CHUNK_SIZE + localX
  };
}
