import type { EnemyDefinition } from "@healer/shared";

// Enemy roster. Melee units ram for contact damage, ranged units hold distance and shoot, and turrets are
// stationary fortification defenses placed around foundries. Contact damage lands at most once per
// attackCooldownMs per enemy, so a single drone takes several seconds to kill a starter ship.
export const enemyDefinitions: EnemyDefinition[] = [
  {
    id: "drone-scout",
    name: "Drone Scout",
    role: "melee",
    maxHealth: 25,
    speed: 45,
    contactDamage: 8,
    attackCooldownMs: 700,
    visionRadiusTiles: 6,
    collisionRadius: 12,
    salvage: { ferrite: 5 }
  },
  {
    id: "burrow-sentry",
    name: "Burrow Sentry",
    role: "melee",
    maxHealth: 40,
    speed: 30,
    contactDamage: 12,
    attackCooldownMs: 900,
    visionRadiusTiles: 5,
    collisionRadius: 14,
    salvage: { ferrite: 8, "plasma-crystal": 1 }
  },
  {
    // GDD §11.2 Sentinel: a patrol guard with steady ranged fire. It keeps its distance and shoots, so
    // players have to close in or use cover instead of waiting for it to ram them.
    id: "sentinel",
    name: "Sentinel",
    role: "ranged",
    maxHealth: 35,
    speed: 32,
    contactDamage: 4,
    attackCooldownMs: 900,
    visionRadiusTiles: 7,
    collisionRadius: 13,
    ranged: { damage: 6, range: 190, cooldownMs: 1400, projectileSpeed: 200, preferredRange: 140 },
    salvage: { ferrite: 6, "plasma-crystal": 2 }
  },
  {
    // Fortification defense. Stationary, tougher than a drone, outranged by the pulse cannon (220 px)
    // so a careful player can pick turrets off from the edge of their reach.
    id: "defense-turret",
    name: "Defense Turret",
    role: "turret",
    maxHealth: 60,
    speed: 0,
    contactDamage: 0,
    attackCooldownMs: 1000,
    visionRadiusTiles: 7,
    collisionRadius: 14,
    ranged: { damage: 7, range: 200, cooldownMs: 1700, projectileSpeed: 220, preferredRange: 0 },
    salvage: { ferrite: 10, stone: 4 }
  }
];

// Returns an enemy definition by id, or undefined for unknown ids from old data.
export function findEnemyDefinition(enemyTypeId: string): EnemyDefinition | undefined {
  return enemyDefinitions.find((entry) => entry.id === enemyTypeId);
}
