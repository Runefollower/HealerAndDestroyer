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

// Terrain visibility values are numeric because snapshots store one value per terrain cell.
const hiddenVisibility = 0 as TerrainVisibilityState;
const rememberedVisibility = 1 as TerrainVisibilityState;
const visibleVisibility = 2 as TerrainVisibilityState;
// Player vision radius is measured in terrain tiles, not pixels.
const playerVisionRadiusTiles = 14;
// Player vision can reveal this many consecutive solid terrain tiles before fully occluding.
const playerOccludingTileDepth = 3;
// Enemy vision radii are tuned per enemy type so AI awareness can differ by content id.
const enemyVisionRadiusTilesByType: Record<string, number> = {
  "drone-scout": 6,
  "burrow-sentry": 5
};

export interface PlayerVisibilityView {
  // Snapshot arrays are already filtered and shaped for one receiving player.
  chunks: ChunkSnapshot[];
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  structures: StructureSnapshot[];
  foundries: FoundrySnapshot[];
  drops: DropSnapshot[];
  // visibleTiles is reused by callers that need the exact tile set for additional logic.
  visibleTiles: Set<string>;
  // memoryChanged flags when fog-of-war memory should eventually be persisted.
  memoryChanged: boolean;
}

// Builds the fog-of-war-filtered snapshot payload for one player and updates terrain memory.
export function buildPlayerVisibilityView(
  map: ActiveMapState,
  self: PlayerShipState,
  terrainMemoryByMap: PlayerSave["terrainMemoryByMap"]
): PlayerVisibilityView {
  // Terrain memory is saved per player per map so explored cells remain known after reconnect.
  const memory = ensureTerrainMemoryMap(terrainMemoryByMap, map.id);
  const visibleTiles = computeVisibleTiles(map, self.position, playerVisionRadiusTiles, playerOccludingTileDepth);
  let memoryChanged = false;

  // Every chunk is returned, but cells are hidden, remembered, or current based on visibility.
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
        // Currently visible tiles update memory with the latest authoritative terrain value.
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
        // Previously explored hidden tiles show remembered terrain instead of live changes.
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
    // Non-terrain entities are included only when their positions fall inside the visible tile set.
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

// Finds the nearest player an enemy can currently see through terrain line-of-sight.
export function findNearestVisiblePlayer(map: ActiveMapState, enemy: EnemyState): PlayerShipState | null {
  const visibleTiles = computeVisibleTiles(map, enemy.position, getEnemyVisionRadiusTiles(enemy));
  const candidates = Object.values(map.players)
    .filter((player) => isPositionVisible(player.position, visibleTiles))
    .sort((left, right) => distance(left.position, enemy.position) - distance(right.position, enemy.position));
  return candidates[0] ?? null;
}

// Computes all tiles visible from an origin within a tile radius and line-of-sight constraints.
export function computeVisibleTiles(map: ActiveMapState, origin: { x: number; y: number }, radiusTiles: number, occludingTileDepth = 1): Set<string> {
  const originTile = worldToTile(origin);
  const visibleTiles = new Set<string>();
  if (!originTile) {
    return visibleTiles;
  }

  // Scan known chunks instead of infinite map bounds so visibility stays limited to active terrain data.
  for (const chunk of Object.values(map.chunks)) {
    for (let index = 0; index < chunk.cells.length; index += 1) {
      const localX = index % CHUNK_SIZE;
      const localY = Math.floor(index / CHUNK_SIZE);
      const tileX = chunk.chunkX * CHUNK_SIZE + localX;
      const tileY = chunk.chunkY * CHUNK_SIZE + localY;
      if (Math.hypot(tileX - originTile.tileX, tileY - originTile.tileY) > radiusTiles) {
        continue;
      }
      if (hasLineOfSightToTile(map, originTile.tileX, originTile.tileY, tileX, tileY, occludingTileDepth)) {
        visibleTiles.add(createTileKey(tileX, tileY));
      }
    }
  }

  return visibleTiles;
}

// Returns the vision radius for an enemy type, falling back to the conservative default.
function getEnemyVisionRadiusTiles(enemy: EnemyState): number {
  return enemyVisionRadiusTilesByType[enemy.enemyTypeId] ?? 5;
}

// Converts a world-space point into a terrain tile key and checks it against the visible set.
function isPositionVisible(position: { x: number; y: number }, visibleTiles: Set<string>): boolean {
  const tile = worldToTile(position);
  return !!tile && visibleTiles.has(createTileKey(tile.tileX, tile.tileY));
}

// Uses Bresenham-style line walking to determine whether terrain blocks sight to a tile.
function hasLineOfSightToTile(
  map: ActiveMapState,
  originTileX: number,
  originTileY: number,
  targetTileX: number,
  targetTileY: number,
  occludingTileDepth: number
): boolean {
  let currentX = originTileX;
  let currentY = originTileY;
  const deltaX = Math.abs(targetTileX - originTileX);
  const stepX = originTileX < targetTileX ? 1 : -1;
  const deltaY = -Math.abs(targetTileY - originTileY);
  const stepY = originTileY < targetTileY ? 1 : -1;
  let error = deltaX + deltaY;
  let occludingTilesSeen = 0;

  // Step tile-by-tile until hitting a blocker or the target tile.
  while (true) {
    const isOrigin = currentX === originTileX && currentY === originTileY;
    const isTarget = currentX === targetTileX && currentY === targetTileY;
    if (!isOrigin) {
      const isBlocking = isVisionBlockingTile(map, currentX, currentY);
      if (isBlocking) {
        occludingTilesSeen += 1;
        if (occludingTilesSeen > occludingTileDepth) {
          return false;
        }
      } else if (occludingTilesSeen > 0) {
        return false;
      }
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

// Determines whether a terrain tile blocks vision.
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

// Returns an existing terrain memory map or creates an empty one for the player/map pair.
function ensureTerrainMemoryMap(terrainMemoryByMap: PlayerSave["terrainMemoryByMap"], mapId: string): TerrainMemoryMapState {
  const existing = terrainMemoryByMap[mapId];
  if (existing) {
    return existing;
  }

  const created: TerrainMemoryMapState = { chunks: {} };
  terrainMemoryByMap[mapId] = created;
  return created;
}

// Returns a memory chunk with arrays resized to match the current authoritative chunk cell count.
function ensureMemoryChunk(memory: TerrainMemoryMapState, chunkKey: string, cellCount: number): TerrainMemoryChunkState {
  const existing = memory.chunks[chunkKey];
  if (existing) {
    // Resize older memory records defensively if the prototype chunk shape changes.
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

// Creates the stable string key used for tile visibility sets.
function createTileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

// Converts live player state into the network snapshot shape.
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

// Converts live enemy state into the network snapshot shape.
function toEnemySnapshot(enemy: EnemyState): EnemySnapshot {
  return {
    id: enemy.id,
    enemyTypeId: enemy.enemyTypeId,
    position: enemy.position,
    rotation: enemy.rotation,
    health: enemy.health
  };
}

// Converts live projectile state into the network snapshot shape.
function toProjectileSnapshot(projectile: ProjectileState): ProjectileSnapshot {
  return {
    id: projectile.id,
    position: projectile.position
  };
}

// Converts live structure state into the network snapshot shape.
function toStructureSnapshot(structure: StructureState): StructureSnapshot {
  return {
    id: structure.id,
    structureTypeId: structure.structureTypeId,
    position: structure.position,
    health: structure.health,
    buildState: structure.buildState
  };
}

// Converts live foundry state into the network snapshot shape.
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

// Converts live resource drop state into the network snapshot shape.
function toDropSnapshot(drop: ActiveMapState["drops"][string]): DropSnapshot {
  return {
    id: drop.id,
    position: drop.position,
    resources: drop.resources
  };
}
