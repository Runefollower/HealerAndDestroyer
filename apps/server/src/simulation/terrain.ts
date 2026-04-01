import { asEntityId, type ActiveMapState, type ResourceMap } from "@healer/shared";
import { CHUNK_SIZE } from "./createWorld.js";

export const TILE_SIZE = 32;

export interface TileAddress {
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  cellIndex: number;
}

export interface TerrainDamageResult {
  hit: boolean;
  destroyed: boolean;
  resources?: ResourceMap;
}

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
    chunkKey: `${chunkX},${chunkY}`,
    chunkX,
    chunkY,
    cellIndex: localY * CHUNK_SIZE + localX
  };
}

export function mineTerrainAt(map: ActiveMapState, position: { x: number; y: number }, tickCounter: number, yieldMultiplier = 1): boolean {
  return damageTerrainAt(map, position, Number.POSITIVE_INFINITY, tickCounter, yieldMultiplier).destroyed;
}

export function damageTerrainAt(
  map: ActiveMapState,
  position: { x: number; y: number },
  damage: number,
  tickCounter: number,
  yieldMultiplier = 1
): TerrainDamageResult {
  const tile = worldToTile(position);
  if (!tile) {
    return { hit: false, destroyed: false };
  }
  const chunk = map.chunks[tile.chunkKey];
  if (!chunk) {
    return { hit: false, destroyed: false };
  }
  const currentValue = chunk.cells[tile.cellIndex] ?? 0;
  if (currentValue === 0) {
    return { hit: false, destroyed: false };
  }

  if (damage < getTerrainCriticalDamage(currentValue)) {
    return { hit: true, destroyed: false };
  }

  chunk.cells[tile.cellIndex] = 0;
  chunk.dirty = true;
  const resources = createTerrainDebrisResources(currentValue, yieldMultiplier);
  map.drops[`terrain-${tile.chunkKey}-${tile.cellIndex}-${tickCounter}`] = {
    id: asEntityId(`terrain-${tile.chunkKey}-${tile.cellIndex}-${tickCounter}`),
    mapId: map.id,
    position: { x: position.x, y: position.y },
    resources
  };
  return { hit: true, destroyed: true, resources };
}

function getTerrainCriticalDamage(cellValue: number): number {
  if (cellValue === 1) {
    return 20;
  }
  if (cellValue === 2) {
    return 30;
  }
  return 36;
}

function createTerrainDebrisResources(cellValue: number, yieldMultiplier: number): ResourceMap {
  const baseResources = cellValue === 1 ? { ferrite: 2 } : { ferrite: 1, "plasma-crystal": 1 };
  return Object.fromEntries(
    Object.entries(baseResources).map(([resourceId, amount]) => [resourceId, Math.max(1, Math.round(amount * yieldMultiplier))])
  );
}