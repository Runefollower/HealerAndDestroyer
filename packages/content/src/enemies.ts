import type { EnemyDefinition } from "@healer/shared";

export const enemyDefinitions: EnemyDefinition[] = [
  {
    id: "drone-scout",
    name: "Drone Scout",
    maxHealth: 25,
    speed: 45,
    contactDamage: 8,
    salvage: { ferrite: 5 }
  },
  {
    id: "burrow-sentry",
    name: "Burrow Sentry",
    maxHealth: 40,
    speed: 30,
    contactDamage: 12,
    salvage: { ferrite: 8, "plasma-crystal": 1 }
  }
];

