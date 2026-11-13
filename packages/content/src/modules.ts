import type { ModuleDefinition, WeaponDefinition } from "@healer/shared";

// powerUse counts against the ship's power budget (hull powerCapacity plus power modules); unused budget speeds
// up energy recharge. Weapons and support tools spend energy per use (see weaponDefinitions and support config).
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
    buildCost: { rock: 8 },
    craftTimeMs: 0,
    engine: {
      thrust: 210
    }
  },
  {
    id: "heavy-drive",
    name: "Heavy Drive",
    slotType: "engine",
    capabilities: ["passive"],
    mass: 22,
    powerUse: 12,
    maxHealth: 45,
    rarity: "improved",
    buildCost: { stone: 10, ferrite: 30 },
    craftTimeMs: 0,
    engine: {
      thrust: 420,
      torque: 20
    }
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
    id: "rail-lance",
    name: "Rail Lance",
    slotType: "weapon",
    capabilities: ["weapon"],
    mass: 20,
    powerUse: 14,
    maxHealth: 30,
    rarity: "improved",
    buildCost: { ferrite: 30, "plasma-crystal": 6 },
    craftTimeMs: 0,
    weapon: {
      weaponId: "rail-lance"
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
    buildCost: { rock: 8, ferrite: 4 },
    craftTimeMs: 0,
    mining: {
      range: 96,
      terrainDamage: 1,
      cooldownMs: 180,
      yieldMultiplier: 1.2
    }
  },
  {
    // Short reach but faster and richer than the laser: a dedicated miner's tool.
    id: "bore-drill",
    name: "Bore Drill",
    slotType: "utility",
    capabilities: ["mining"],
    mass: 16,
    powerUse: 10,
    maxHealth: 40,
    rarity: "improved",
    buildCost: { rock: 20, stone: 12, ferrite: 10 },
    craftTimeMs: 0,
    mining: {
      range: 64,
      terrainDamage: 2,
      cooldownMs: 120,
      yieldMultiplier: 1.6
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
      allowSelfTarget: true,
      energyCost: 8
    }
  },
  {
    id: "micro-reactor",
    name: "Micro Reactor",
    slotType: "power",
    capabilities: ["passive"],
    mass: 14,
    powerUse: 0,
    maxHealth: 30,
    rarity: "improved",
    buildCost: { ferrite: 20, "plasma-crystal": 8 },
    craftTimeMs: 0,
    power: {
      output: 40,
      storage: 40
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
    buildCost: { stone: 6, ferrite: 12 },
    craftTimeMs: 0,
    armor: {
      hullBonus: 30
    }
  }
];

export const weaponDefinitions: WeaponDefinition[] = [
  {
    id: "pulse-cannon",
    name: "Pulse Cannon",
    damage: 25,
    range: 220,
    cooldownMs: 300,
    energyCost: 5
  },
  {
    // Slow, hard-hitting, long-reaching shot. Expensive on energy, so it rewards aiming over spraying.
    id: "rail-lance",
    name: "Rail Lance",
    damage: 60,
    range: 420,
    cooldownMs: 900,
    energyCost: 18,
    projectileLifetimeMs: 900
  }
];
