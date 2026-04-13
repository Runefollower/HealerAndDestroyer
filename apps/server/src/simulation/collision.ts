import type { ActiveMapState, EnemyState, PlayerShipState, Vec2 } from "@healer/shared";
import { clamp, distance, isEmptyTerrainCell } from "@healer/shared";
import { CHUNK_SIZE } from "./createWorld.js";
import { TILE_SIZE } from "./terrain.js";

// Default radii keep collision behavior defined even when new content lacks explicit tuning.
const defaultShipRadius = 14;
const defaultEnemyRadius = 12;
const defaultStructureRadius = 24;
// Ship hull ids map to gameplay collision radii in world-space pixels.
const shipCollisionRadii: Record<string, number> = {
  "sparrow-scout": 14,
  "warden-healer": 16
};
// Enemy type ids map to gameplay collision radii in world-space pixels.
const enemyCollisionRadii: Record<string, number> = {
  "drone-scout": 12,
  "burrow-sentry": 14
};
// Structure type ids map to gameplay collision radii in world-space pixels.
const structureCollisionRadii: Record<string, number> = {
  "builder-site": 28,
  "enemy-foundry": 34
};

interface PositionBlockOptions {
  // Entity id ignored by collision checks, usually the moving entity itself.
  excludeEntityId?: string;
  // Player/enemy checks are opt-in so terrain-only and structure-only queries stay cheap.
  includePlayers?: boolean;
  includeEnemies?: boolean;
}

interface MovementResolution extends PositionBlockOptions {
  // Radius of the moving body in world-space pixels.
  radius: number;
}

// Returns the collision radius for a player hull, falling back to a safe prototype default.
export function getPlayerShipCollisionRadius(player: Pick<PlayerShipState, "hullId">): number {
  return shipCollisionRadii[player.hullId] ?? defaultShipRadius;
}

// Returns the collision radius for an enemy type, falling back to a safe prototype default.
export function getEnemyCollisionRadius(enemy: Pick<EnemyState, "enemyTypeId">): number {
  return enemyCollisionRadii[enemy.enemyTypeId] ?? defaultEnemyRadius;
}

// Returns the collision radius for structures/foundries by content id.
export function getStructureCollisionRadius(structureTypeId: string): number {
  return structureCollisionRadii[structureTypeId] ?? defaultStructureRadius;
}

// Checks whether a circular body at a position overlaps terrain, structures, or selected entities.
export function isPositionBlocked(map: ActiveMapState, position: Vec2, radius: number, options: PositionBlockOptions = {}): boolean {
  // Terrain is always blocking and includes out-of-bounds handling.
  if (collidesWithTerrain(map, position, radius)) {
    return true;
  }

  // Structures and active foundries are always blocking unless explicitly excluded.
  for (const structure of Object.values(map.structures)) {
    if (structure.id === options.excludeEntityId || structure.buildState === "destroyed") {
      continue;
    }
    if (distance(position, structure.position) < radius + getStructureCollisionRadius(structure.structureTypeId)) {
      return true;
    }
  }

  for (const foundry of Object.values(map.foundries)) {
    if (foundry.id === options.excludeEntityId || foundry.buildState === "destroyed" || !foundry.active) {
      continue;
    }
    if (distance(position, foundry.position) < radius + getStructureCollisionRadius(foundry.structureTypeId)) {
      return true;
    }
  }

  // Player and enemy body checks are optional because some placement queries intentionally ignore them.
  if (options.includePlayers) {
    for (const player of Object.values(map.players)) {
      if (player.id === options.excludeEntityId) {
        continue;
      }
      if (distance(position, player.position) < radius + getPlayerShipCollisionRadius(player)) {
        return true;
      }
    }
  }

  if (options.includeEnemies) {
    for (const enemy of Object.values(map.enemies)) {
      if (enemy.id === options.excludeEntityId) {
        continue;
      }
      if (distance(position, enemy.position) < radius + getEnemyCollisionRadius(enemy)) {
        return true;
      }
    }
  }

  return false;
}

// Resolves movement one axis at a time so sliding along walls remains possible.
export function resolveMovement(map: ActiveMapState, position: Vec2, velocity: Vec2, deltaSeconds: number, options: MovementResolution): { position: Vec2; velocity: Vec2 } {
  const resolvedPosition = { ...position };
  const resolvedVelocity = { ...velocity };

  // Try horizontal movement first and cancel only the X velocity if blocked.
  const candidateX = {
    x: position.x + velocity.x * deltaSeconds,
    y: position.y
  };
  if (!isPositionBlocked(map, candidateX, options.radius, options)) {
    resolvedPosition.x = candidateX.x;
  } else {
    resolvedVelocity.x = 0;
  }

  // Then try vertical movement from the resolved X position and cancel only Y if blocked.
  const candidateY = {
    x: resolvedPosition.x,
    y: position.y + velocity.y * deltaSeconds
  };
  if (!isPositionBlocked(map, candidateY, options.radius, options)) {
    resolvedPosition.y = candidateY.y;
  } else {
    resolvedVelocity.y = 0;
  }

  return {
    position: resolvedPosition,
    velocity: resolvedVelocity
  };
}

// Searches outward from a desired point to find a nearby non-blocking spawn/transition position.
export function findNearestValidPosition(
  map: ActiveMapState,
  desired: Vec2,
  radius: number,
  options: PositionBlockOptions = {},
  maxRings = 12
): Vec2 {
  if (!isPositionBlocked(map, desired, radius, options)) {
    return { ...desired };
  }

  // Ring search samples tile-half offsets so map transitions avoid spawning inside walls or entities.
  const searchStep = TILE_SIZE / 2;
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (let offsetY = -ring; offsetY <= ring; offsetY += 1) {
      for (let offsetX = -ring; offsetX <= ring; offsetX += 1) {
        if (Math.abs(offsetX) !== ring && Math.abs(offsetY) !== ring) {
          continue;
        }

        const candidate = {
          x: desired.x + offsetX * searchStep,
          y: desired.y + offsetY * searchStep
        };
        if (!isPositionBlocked(map, candidate, radius, options)) {
          return candidate;
        }
      }
    }
  }

  return { ...desired };
}

// Samples a moving projectile path and returns the first terrain impact point, if any.
export function findTerrainImpactAlongPath(map: ActiveMapState, start: Vec2, end: Vec2, radius: number): Vec2 | null {
  if (collidesWithTerrain(map, start, radius)) {
    return { ...start };
  }

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const travelDistance = Math.hypot(deltaX, deltaY);
  if (travelDistance === 0) {
    return collidesWithTerrain(map, end, radius) ? { ...end } : null;
  }

  // Use sub-tile sampling so fast projectiles do not skip through thin terrain.
  const steps = Math.max(1, Math.ceil(travelDistance / Math.max(2, TILE_SIZE / 4)));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const sample = {
      x: start.x + deltaX * t,
      y: start.y + deltaY * t
    };
    if (collidesWithTerrain(map, sample, radius)) {
      return sample;
    }
  }

  return null;
}

// Tests a circular body against every solid terrain tile overlapping its bounding box.
function collidesWithTerrain(map: ActiveMapState, position: Vec2, radius: number): boolean {
  const minTileX = Math.floor((position.x - radius) / TILE_SIZE);
  const maxTileX = Math.floor((position.x + radius) / TILE_SIZE);
  const minTileY = Math.floor((position.y - radius) / TILE_SIZE);
  const maxTileY = Math.floor((position.y + radius) / TILE_SIZE);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (!isSolidTile(map, tileX, tileY)) {
        continue;
      }
      if (
        circleIntersectsRect(position, radius, {
          x: tileX * TILE_SIZE,
          y: tileY * TILE_SIZE,
          width: TILE_SIZE,
          height: TILE_SIZE
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

// Determines whether a terrain tile blocks movement, treating missing/out-of-bounds chunks as solid.
function isSolidTile(map: ActiveMapState, tileX: number, tileY: number): boolean {
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

  const cellValue = chunk.cells[localY * CHUNK_SIZE + localX] ?? 0;
  if (isEmptyTerrainCell(cellValue)) {
    return false;
  }

  // Structures carve out their occupied tiles so placed objects are not buried in solid terrain.
  return !isTileOccupiedByStructure(map, tileX, tileY);
}

// Checks whether a tile center is covered by a live structure or foundry footprint.
function isTileOccupiedByStructure(map: ActiveMapState, tileX: number, tileY: number): boolean {
  const tileCenter = {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tileY * TILE_SIZE + TILE_SIZE / 2
  };

  for (const structure of Object.values(map.structures)) {
    if (structure.buildState === "destroyed") {
      continue;
    }
    if (distance(tileCenter, structure.position) <= getStructureCollisionRadius(structure.structureTypeId)) {
      return true;
    }
  }

  for (const foundry of Object.values(map.foundries)) {
    if (foundry.buildState === "destroyed" || !foundry.active) {
      continue;
    }
    if (distance(tileCenter, foundry.position) <= getStructureCollisionRadius(foundry.structureTypeId)) {
      return true;
    }
  }

  return false;
}

// Tests circle-vs-axis-aligned-rectangle overlap using the nearest point on the rectangle.
function circleIntersectsRect(
  circle: Vec2,
  radius: number,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const nearestX = clamp(circle.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(circle.y, rect.y, rect.y + rect.height);
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}
