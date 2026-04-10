import {
  distance,
  type ActiveMapState,
  type ChunkSnapshot,
  type DropSnapshot,
  type EnemySnapshot,
  type EnemyState,
  type FoundrySnapshot,
  type FoundryState,
  type PlayerSave,
  type PlayerShipState,
  type PlayerSnapshot,
  type ProjectileSnapshot,
  type ProjectileState,
  type StructureSnapshot,
  type StructureState,
  type TerrainMemoryChunkState,
  type TerrainMemoryMapState,
  type TerrainVisibilityState
} from "@healer/shared";
import { CHUNK_SIZE } from "./createWorld.js";
import { TILE_SIZE, worldToTile } from "./terrain.js";
import { getStructureCollisionRadius } from "./collision.js";

const hiddenVisibility = 0 as TerrainVisibilityState;
const rememberedVisibility = 1 as TerrainVisibilityState;
const visibleVisibility = 2 as TerrainVisibilityState;
const playerVisionRadiusTiles = 7;
const enemyVisionRadiusTilesByType: Record<string, number> = {
  "drone-scout": 6,
  "burrow-sentry": 5
};

export interface PlayerVisibilityView {
  chunks: ChunkSnapshot[];
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  structures: StructureSnapshot[];
  foundries: FoundrySnapshot[];
  drops: DropSnapshot[];
  visibleTiles: Set<string>;
  memoryChanged: boolean;
}

export function buildPlayerVisibilityView(
  map: ActiveMapState,
  self: PlayerShipState,
  terrainMemoryByMap: PlayerSave["terrainMemoryByMap"]
): PlayerVisibilityView {
  const memory = ensureTerrainMemoryMap(terrainMemoryByMap, map.id);
  const visibleTiles = computeVisibleTiles(map, self.position, playerVisionRadiusTiles);
  let memoryChanged = false;

  const chunks = Object.entries(map.chunks).map(([chunkKey, chunk]) => {
    const memoryChunk = ensureMemoryChunk(memory, chunkKey, chunk.cells.length);
    const cells = new Array<number>(chunk.cells.length).fill(0);
    const visibility = new Array<TerrainVisibilityState>(chunk.cells.length).fill(hiddenVisibility);

    for (let index = 0; index < chunk.cells.length; index += 1) {
      const localX = index % CHUNK_SIZE;
      const localY = Math.floor(index / CHUNK_SIZE);
      const tileX = chunk.chunkX * CHUNK_SIZE + localX;
      const tileY = chunk.chunkY * CHUNK_SIZE + localY;
      const key = createTileKey(tileX, tileY);

      if (visibleTiles.has(key)) {
        const currentCell = chunk.cells[index] ?? 0;
        cells[index] = currentCell;
        visibility[index] = visibleVisibility;
        if (memoryChunk.cells[index] !== currentCell || !memoryChunk.explored[index]) {
          memoryChunk.cells[index] = currentCell;
          memoryChunk.explored[index] = true;
          memoryChanged = true;
        }
        continue;
      }

      if (memoryChunk.explored[index]) {
        cells[index] = memoryChunk.cells[index] ?? 0;
        visibility[index] = rememberedVisibility;
      }
    }

    return {
      chunkKey,
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      cells,
      visibility
    } satisfies ChunkSnapshot;
  });

  return {
    chunks,
    players: Object.values(map.players)
      .filter((player) => player.playerId === self.playerId || isPositionVisible(player.position, visibleTiles))
      .map(toPlayerSnapshot),
    enemies: Object.values(map.enemies)
      .filter((enemy) => isPositionVisible(enemy.position, visibleTiles))
      .map(toEnemySnapshot),
    projectiles: Object.values(map.projectiles)
      .filter((projectile) => isPositionVisible(projectile.position, visibleTiles))
      .map(toProjectileSnapshot),
    structures: Object.values(map.structures)
      .filter((structure) => structure.buildState !== "destroyed" && isPositionVisible(structure.position, visibleTiles))
      .map(toStructureSnapshot),
    foundries: Object.values(map.foundries)
      .filter((foundry) => foundry.buildState !== "destroyed" && isPositionVisible(foundry.position, visibleTiles))
      .map(toFoundrySnapshot),
    drops: Object.values(map.drops)
      .filter((drop) => isPositionVisible(drop.position, visibleTiles))
      .map(toDropSnapshot),
    visibleTiles,
    memoryChanged
  };
}

export function findNearestVisiblePlayer(map: ActiveMapState, enemy: EnemyState): PlayerShipState | null {
  const visibleTiles = computeVisibleTiles(map, enemy.position, getEnemyVisionRadiusTiles(enemy));
  const candidates = Object.values(map.players)
    .filter((player) => isPositionVisible(player.position, visibleTiles))
    .sort((left, right) => distance(left.position, enemy.position) - distance(right.position, enemy.position));
  return candidates[0] ?? null;
}

export function computeVisibleTiles(map: ActiveMapState, origin: { x: number; y: number }, radiusTiles: number): Set<string> {
  const originTile = worldToTile(origin);
  const visibleTiles = new Set<string>();
  if (!originTile) {
    return visibleTiles;
  }

  for (const chunk of Object.values(map.chunks)) {
    for (let index = 0; index < chunk.cells.length; index += 1) {
      const localX = index % CHUNK_SIZE;
      const localY = Math.floor(index / CHUNK_SIZE);
      const tileX = chunk.chunkX * CHUNK_SIZE + localX;
      const tileY = chunk.chunkY * CHUNK_SIZE + localY;
      if (Math.hypot(tileX - originTile.tileX, tileY - originTile.tileY) > radiusTiles) {
        continue;
      }
      if (hasLineOfSightToTile(map, originTile.tileX, originTile.tileY, tileX, tileY)) {
        visibleTiles.add(createTileKey(tileX, tileY));
      }
    }
  }

  return visibleTiles;
}

function getEnemyVisionRadiusTiles(enemy: EnemyState): number {
  return enemyVisionRadiusTilesByType[enemy.enemyTypeId] ?? 5;
}

function isPositionVisible(position: { x: number; y: number }, visibleTiles: Set<string>): boolean {
  const tile = worldToTile(position);
  return !!tile && visibleTiles.has(createTileKey(tile.tileX, tile.tileY));
}

function hasLineOfSightToTile(map: ActiveMapState, originTileX: number, originTileY: number, targetTileX: number, targetTileY: number): boolean {
  let currentX = originTileX;
  let currentY = originTileY;
  const deltaX = Math.abs(targetTileX - originTileX);
  const stepX = originTileX < targetTileX ? 1 : -1;
  const deltaY = -Math.abs(targetTileY - originTileY);
  const stepY = originTileY < targetTileY ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    const isOrigin = currentX === originTileX && currentY === originTileY;
    const isTarget = currentX === targetTileX && currentY === targetTileY;
    if (!isOrigin && isVisionBlockingTile(map, currentX, currentY)) {
      return isTarget;
    }
    if (isTarget) {
      return true;
    }

    const doubledError = error * 2;
    if (doubledError >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (doubledError <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

function isVisionBlockingTile(map: ActiveMapState, tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileY < 0) {
    return true;
  }

  const chunkX = Math.floor(tileX / CHUNK_SIZE);
  const chunkY = Math.floor(tileY / CHUNK_SIZE);
  const localX = tileX % CHUNK_SIZE;
  const localY = tileY % CHUNK_SIZE;
  const chunk = map.chunks[`${chunkX},${chunkY}`];
  if (!chunk) {
    return true;
  }

  // First-pass visibility only treats terrain as opaque. Structures and foundries remain visible objects,
  // but they do not block line of sight the way cave walls do.
  const cellValue = chunk.cells[localY * CHUNK_SIZE + localX] ?? 0;
  return cellValue > 0;
}

function ensureTerrainMemoryMap(terrainMemoryByMap: PlayerSave["terrainMemoryByMap"], mapId: string): TerrainMemoryMapState {
  const existing = terrainMemoryByMap[mapId];
  if (existing) {
    return existing;
  }

  const created: TerrainMemoryMapState = { chunks: {} };
  terrainMemoryByMap[mapId] = created;
  return created;
}

function ensureMemoryChunk(memory: TerrainMemoryMapState, chunkKey: string, cellCount: number): TerrainMemoryChunkState {
  const existing = memory.chunks[chunkKey];
  if (existing) {
    if (existing.cells.length !== cellCount) {
      existing.cells = existing.cells.slice(0, cellCount);
      while (existing.cells.length < cellCount) {
        existing.cells.push(0);
      }
    }
    if (existing.explored.length !== cellCount) {
      existing.explored = existing.explored.slice(0, cellCount);
      while (existing.explored.length < cellCount) {
        existing.explored.push(false);
      }
    }
    return existing;
  }

  const created: TerrainMemoryChunkState = {
    cells: new Array<number>(cellCount).fill(0),
    explored: new Array<boolean>(cellCount).fill(false)
  };
  memory.chunks[chunkKey] = created;
  return created;
}

function createTileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

function toPlayerSnapshot(player: PlayerShipState): PlayerSnapshot {
  return {
    id: player.id,
    playerId: player.playerId,
    shipId: player.shipId,
    hullId: player.hullId,
    position: player.position,
    velocity: player.velocity,
    rotation: player.rotation,
    hull: player.hull,
    maxHull: player.maxHull,
    modules: structuredClone(player.modules)
  };
}

function toEnemySnapshot(enemy: EnemyState): EnemySnapshot {
  return {
    id: enemy.id,
    enemyTypeId: enemy.enemyTypeId,
    position: enemy.position,
    rotation: enemy.rotation,
    health: enemy.health
  };
}

function toProjectileSnapshot(projectile: ProjectileState): ProjectileSnapshot {
  return {
    id: projectile.id,
    position: projectile.position
  };
}

function toStructureSnapshot(structure: StructureState): StructureSnapshot {
  return {
    id: structure.id,
    structureTypeId: structure.structureTypeId,
    position: structure.position,
    health: structure.health,
    buildState: structure.buildState
  };
}

function toFoundrySnapshot(foundry: FoundryState): FoundrySnapshot {
  return {
    id: foundry.id,
    position: foundry.position,
    health: foundry.health,
    active: foundry.active,
    spawnCooldownMs: foundry.spawnCooldownMs,
    spawnCap: foundry.spawnCap,
    activeEnemyCount: foundry.activeEnemyCount
  };
}

function toDropSnapshot(drop: ActiveMapState["drops"][string]): DropSnapshot {
  return {
    id: drop.id,
    position: drop.position,
    resources: drop.resources
  };
}

