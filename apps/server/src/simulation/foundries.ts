import { enemyDefinitions } from "@healer/content";
import { asEntityId, distance, type ActiveMapState, type FoundryState } from "@healer/shared";
import { findNearestValidPosition, getEnemyCollisionRadius } from "./collision.js";

export interface FoundryDamageResult {
  // hit identifies that damage landed on an active foundry.
  hit: boolean;
  // destroyedFoundry is present when the hit reduced health to zero.
  destroyedFoundry?: FoundryState;
}

// Recounts living enemies assigned to each foundry so spawn caps stay accurate after kills/reloads.
export function refreshFoundryEnemyCounts(map: ActiveMapState): void {
  for (const foundry of Object.values(map.foundries)) {
    foundry.activeEnemyCount = Object.values(map.enemies).filter((enemy) => enemy.sourceFoundryId === foundry.id).length;
  }
}

// Applies projectile damage to the foundry near the impact point and drops rewards on destruction.
export function applyFoundryDamage(map: ActiveMapState, position: { x: number; y: number }, damage: number, tickCounter: number): FoundryDamageResult {
  // A small radius lets projectile impacts damage the structure without exact center hits.
  const foundry = Object.values(map.foundries).find((entry) => entry.active && distance(entry.position, position) < 20);
  if (!foundry) {
    return { hit: false };
  }

  foundry.health = Math.max(0, foundry.health - damage);
  if (foundry.health === 0) {
    // Destruction disables future spawns and produces a resource drop for nearby players.
    foundry.active = false;
    foundry.buildState = "destroyed";
    foundry.destroyedAt = Date.now();
    map.drops[`foundry-${foundry.id}-${tickCounter}`] = {
      id: asEntityId(`foundry-${foundry.id}-${tickCounter}`),
      mapId: map.id,
      position: { ...foundry.position },
      resources: { ferrite: 30, "plasma-crystal": 10 }
    };
    return { hit: true, destroyedFoundry: foundry };
  }
  return { hit: true };
}

// Advances foundry production, spawning enemies while respecting cooldowns and local caps.
export function tickFoundries(map: ActiveMapState, now: number, spawnIdFactory: () => string): void {
  refreshFoundryEnemyCounts(map);

  // Each active foundry independently checks cap/cooldown before placing one enemy.
  for (const foundry of Object.values(map.foundries)) {
    if (!foundry.active || foundry.buildState === "destroyed") {
      continue;
    }

    if (foundry.activeEnemyCount >= foundry.spawnCap) {
      continue;
    }

    if (now - foundry.lastSpawnAt < foundry.spawnCooldownMs) {
      continue;
    }

    // Cycle through available enemy definitions so the prototype can vary pressure without new state.
    const enemyDefinition = enemyDefinitions[foundry.activeEnemyCount % enemyDefinitions.length];
    const enemyId = asEntityId(spawnIdFactory());
    const desiredPosition = {
      x: foundry.position.x + 24 + foundry.activeEnemyCount * 8,
      y: foundry.position.y + 12
    };
    map.enemies[enemyId] = {
      id: enemyId,
      mapId: map.id,
      enemyTypeId: enemyDefinition.id,
      position: findNearestValidPosition(map, desiredPosition, getEnemyCollisionRadius({ enemyTypeId: enemyDefinition.id }), {
        includePlayers: true,
        includeEnemies: true
      }),
      velocity: { x: 0, y: 0 },
      rotation: 0,
      health: enemyDefinition.maxHealth,
      aiState: "idle",
      sourceFoundryId: foundry.id
    };
    foundry.lastSpawnAt = now;
    foundry.activeEnemyCount += 1;
  }
}

// The deeper route unlocks once every root-map foundry is inactive or destroyed.
export function isDeeperPathUnlocked(rootMap: ActiveMapState): boolean {
  return Object.values(rootMap.foundries).every((foundry) => !foundry.active || foundry.buildState === "destroyed");
}

// Replaces template foundries with persisted copies during world initialization.
export function rehydrateFoundries(map: ActiveMapState, foundries: FoundryState[]): void {
  map.foundries = Object.fromEntries(foundries.map((foundry) => [foundry.id, structuredClone(foundry)]));
}
