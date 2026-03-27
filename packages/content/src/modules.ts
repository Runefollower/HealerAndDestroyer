import type { ModuleDefinition, WeaponDefinition } from "@healer/shared";

export const moduleDefinitions: ModuleDefinition[] = [
  {
    id: "starter-thruster",
    name: "Starter Thruster",
    slotType: "engine",
    capabilities: ["passive"],
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
    capabilities: ["weapon"],
    mass: 12,
    powerUse: 8,
    maxHealth: 24,
    rarity: "basic",
    buildCost: { ferrite: 10 },
    craftTimeMs: 0,
    weapon: {
      weaponId: "pulse-cannon"
    }
  },
  {
    id: "mining-laser",
    name: "Mining Laser",
    slotType: "utility",
    capabilities: ["mining"],
    mass: 8,
    powerUse: 6,
    maxHealth: 20,
    rarity: "basic",
    buildCost: { ferrite: 12 },
    craftTimeMs: 0,
    mining: {
      range: 96,
      terrainDamage: 1,
      cooldownMs: 180,
      yieldMultiplier: 1.2
    }
  },
  {
    id: "repair-beam",
    name: "Repair Beam",
    slotType: "support",
    capabilities: ["support"],
    mass: 9,
    powerUse: 7,
    maxHealth: 20,
    rarity: "basic",
    buildCost: { ferrite: 15, "plasma-crystal": 4 },
    craftTimeMs: 0,
    support: {
      range: 96,
      repairAmount: 12,
      cooldownMs: 400,
      allowSelfTarget: true
    }
  },
  {
    id: "reactive-plating",
    name: "Reactive Plating",
    slotType: "armor",
    capabilities: ["passive"],
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
  }
];
