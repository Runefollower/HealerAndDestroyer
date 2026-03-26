import type { ModuleDefinition, WeaponDefinition } from "@healer/shared";

export const moduleDefinitions: ModuleDefinition[] = [
  {
    id: "starter-thruster",
    name: "Starter Thruster",
    slotType: "engine",
    mass: 10,
    powerUse: 4,
    maxHealth: 30,
    rarity: "basic",
    buildCost: { ferrite: 8 },
    craftTimeMs: 0
  },
  {
    id: "pulse-cannon",
    name: "Pulse Cannon",
    slotType: "weapon",
    mass: 12,
    powerUse: 8,
    maxHealth: 24,
    rarity: "basic",
    buildCost: { ferrite: 10 },
    craftTimeMs: 0
  },
  {
    id: "mining-laser",
    name: "Mining Laser",
    slotType: "utility",
    mass: 8,
    powerUse: 6,
    maxHealth: 20,
    rarity: "basic",
    buildCost: { ferrite: 12 },
    craftTimeMs: 0
  },
  {
    id: "repair-beam",
    name: "Repair Beam",
    slotType: "support",
    mass: 9,
    powerUse: 7,
    maxHealth: 20,
    rarity: "basic",
    buildCost: { ferrite: 15, "plasma-crystal": 4 },
    craftTimeMs: 0
  },
  {
    id: "reactive-plating",
    name: "Reactive Plating",
    slotType: "armor",
    mass: 15,
    powerUse: 0,
    maxHealth: 36,
    rarity: "basic",
    buildCost: { ferrite: 18 },
    craftTimeMs: 0
  }
];

export const weaponDefinitions: WeaponDefinition[] = [
  {
    id: "pulse-cannon",
    name: "Pulse Cannon",
    damage: 25,
    range: 220,
    cooldownMs: 300
  },
  {
    id: "mining-laser",
    name: "Mining Laser",
    damage: 5,
    range: 80,
    cooldownMs: 150
  }
];


