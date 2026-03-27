import { asEntityId, type ActiveMapState } from "@healer/shared";
import { CHUNK_SIZE } from "./createWorld.js";

export interface TileAddress {
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  cellIndex: number;
}

export function worldToTile(position: { x: number; y: number }): TileAddress | null {
  const tileX = Math.floor(position.x / 32);
  const tileY = Math.floor(position.y / 32);
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
  const tile = worldToTile(position);
  if (!tile) {
    return false;
  }
  const chunk = map.chunks[tile.chunkKey];
  if (!chunk) {
    return false;
  }
  const currentValue = chunk.cells[tile.cellIndex] ?? 0;
  if (currentValue === 0) {
    return false;
  }

  chunk.cells[tile.cellIndex] = 0;
  chunk.dirty = true;
  const baseResources = currentValue === 1 ? { ferrite: 2 } : { ferrite: 1, "plasma-crystal": 1 };
  const resources = Object.fromEntries(
    Object.entries(baseResources).map(([resourceId, amount]) => [resourceId, Math.max(1, Math.round(amount * yieldMultiplier))])
  );
  map.drops[`terrain-${tile.chunkKey}-${tile.cellIndex}-${tickCounter}`] = {
    id: asEntityId(`terrain-${tile.chunkKey}-${tile.cellIndex}-${tickCounter}`),
    mapId: map.id,
    position: { x: position.x, y: position.y },
    resources
  };
  return true;
}
