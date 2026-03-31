import type { ActiveMapState, EnemyState, PlayerShipState, Vec2 } from "@healer/shared";
import { clamp, distance } from "@healer/shared";
import { CHUNK_SIZE } from "./createWorld.js";
import { TILE_SIZE } from "./terrain.js";

const defaultShipRadius = 14;
const defaultEnemyRadius = 12;
const defaultStructureRadius = 24;
const shipCollisionRadii: Record<string, number> = {
  "sparrow-scout": 14,
  "warden-healer": 16
};
const enemyCollisionRadii: Record<string, number> = {
  "drone-scout": 12,
  "burrow-sentry": 14
};
const structureCollisionRadii: Record<string, number> = {
  "builder-site": 28,
  "enemy-foundry": 34
};

interface PositionBlockOptions {
  excludeEntityId?: string;
  includePlayers?: boolean;
  includeEnemies?: boolean;
}

interface MovementResolution extends PositionBlockOptions {
  radius: number;
}

export function getPlayerShipCollisionRadius(player: Pick<PlayerShipState, "hullId">): number {
  return shipCollisionRadii[player.hullId] ?? defaultShipRadius;
}

export function getEnemyCollisionRadius(enemy: Pick<EnemyState, "enemyTypeId">): number {
  return enemyCollisionRadii[enemy.enemyTypeId] ?? defaultEnemyRadius;
}

export function getStructureCollisionRadius(structureTypeId: string): number {
  return structureCollisionRadii[structureTypeId] ?? defaultStructureRadius;
}

export function isPositionBlocked(map: ActiveMapState, position: Vec2, radius: number, options: PositionBlockOptions = {}): boolean {
  if (collidesWithTerrain(map, position, radius)) {
    return true;
  }

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

export function resolveMovement(map: ActiveMapState, position: Vec2, velocity: Vec2, deltaSeconds: number, options: MovementResolution): { position: Vec2; velocity: Vec2 } {
  const resolvedPosition = { ...position };
  const resolvedVelocity = { ...velocity };

  const candidateX = {
    x: position.x + velocity.x * deltaSeconds,
    y: position.y
  };
  if (!isPositionBlocked(map, candidateX, options.radius, options)) {
    resolvedPosition.x = candidateX.x;
  } else {
    resolvedVelocity.x = 0;
  }

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

  return (chunk.cells[localY * CHUNK_SIZE + localX] ?? 0) !== 0;
}

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