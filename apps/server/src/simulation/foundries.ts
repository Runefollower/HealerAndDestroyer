import { enemyDefinitions } from "@healer/content";
import { asEntityId, distance, type ActiveMapState, type FoundryState } from "@healer/shared";

export function refreshFoundryEnemyCounts(map: ActiveMapState): void {
  for (const foundry of Object.values(map.foundries)) {
    foundry.activeEnemyCount = Object.values(map.enemies).filter((enemy) => enemy.sourceFoundryId === foundry.id).length;
  }
}

export function applyFoundryDamage(map: ActiveMapState, position: { x: number; y: number }, damage: number, tickCounter: number): boolean {
  const foundry = Object.values(map.foundries).find((entry) => entry.active && distance(entry.position, position) < 20);
  if (!foundry) {
    return false;
  }

  foundry.health = Math.max(0, foundry.health - damage);
  if (foundry.health === 0) {
    foundry.active = false;
    foundry.buildState = "destroyed";
    foundry.destroyedAt = Date.now();
    map.drops[`foundry-${foundry.id}-${tickCounter}`] = {
      id: asEntityId(`foundry-${foundry.id}-${tickCounter}`),
      mapId: map.id,
      position: { ...foundry.position },
      resources: { ferrite: 30, "plasma-crystal": 10 }
    };
  }
  return true;
}

export function tickFoundries(map: ActiveMapState, now: number, spawnIdFactory: () => string): void {
  refreshFoundryEnemyCounts(map);

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

    const enemyDefinition = enemyDefinitions[foundry.activeEnemyCount % enemyDefinitions.length];
    const enemyId = asEntityId(spawnIdFactory());
    map.enemies[enemyId] = {
      id: enemyId,
      mapId: map.id,
      enemyTypeId: enemyDefinition.id,
      position: {
        x: foundry.position.x + 24 + foundry.activeEnemyCount * 8,
        y: foundry.position.y + 12
      },
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

export function isDeeperPathUnlocked(rootMap: ActiveMapState): boolean {
  return Object.values(rootMap.foundries).every((foundry) => !foundry.active || foundry.buildState === "destroyed");
}

export function rehydrateFoundries(map: ActiveMapState, foundries: FoundryState[]): void {
  map.foundries = Object.fromEntries(foundries.map((foundry) => [foundry.id, structuredClone(foundry)]));
}
