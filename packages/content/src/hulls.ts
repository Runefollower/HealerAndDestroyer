import type { HullDefinition } from "@healer/shared";

// Movement tuning: acceleration = 40 * thrust / mass and turn step = 0.2 * torque / mass (see shipStats.ts).
// The starter Sparrow with its default loadout (mass 70, thrust 280, torque 70) reproduces the original shared
// movement constants exactly, so heavier hulls and loadouts read as slower and lighter ones as quicker.
// powerCapacity is a tight budget on purpose: a hull can carry its signature loadout, but stacking heavy modules
// either overloads it or leaves little surplus for energy recharge unless a power module goes in.
export const hullDefinitions: HullDefinition[] = [
  {
    id: "sparrow-scout",
    name: "Sparrow Scout",
    category: "scout",
    baseHull: 100,
    mass: 40,
    powerCapacity: 30,
    energyCapacity: 60,
    baseThrust: 70,
    torque: 70,
    buildCost: { rock: 0, ferrite: 0 },
    buildTimeMs: 0,
    hardpoints: [
      { id: "weapon-front", type: "weapon", localPosition: { x: 12, y: 0 }, orientation: "east" },
      { id: "engine-rear", type: "engine", localPosition: { x: -14, y: 0 }, orientation: "west" },
      { id: "utility-belly", type: "utility", localPosition: { x: 0, y: 8 }, orientation: "south" }
    ]
  },
  {
    id: "warden-healer",
    name: "Warden Healer",
    category: "healer",
    baseHull: 130,
    mass: 55,
    powerCapacity: 40,
    energyCapacity: 90,
    baseThrust: 80,
    torque: 85,
    buildCost: { rock: 40, ferrite: 80, "plasma-crystal": 20 },
    buildTimeMs: 45000,
    hardpoints: [
      { id: "support-top", type: "support", localPosition: { x: 0, y: -10 }, orientation: "north" },
      { id: "weapon-front", type: "weapon", localPosition: { x: 14, y: 0 }, orientation: "east" },
      { id: "engine-rear", type: "engine", localPosition: { x: -16, y: 0 }, orientation: "west" },
      { id: "power-core", type: "power", localPosition: { x: -4, y: 0 }, orientation: "east" },
      { id: "armor-ring", type: "armor", localPosition: { x: 0, y: 10 }, orientation: "south" }
    ]
  },
  {
    // Destroyer: twin forward guns and a big reactor, but heavy, so it turns and accelerates slowly.
    id: "breaker-destroyer",
    name: "Breaker Destroyer",
    category: "destroyer",
    baseHull: 170,
    mass: 75,
    powerCapacity: 45,
    energyCapacity: 110,
    baseThrust: 80,
    torque: 100,
    buildCost: { rock: 30, stone: 30, ferrite: 120, "plasma-crystal": 15 },
    buildTimeMs: 60000,
    hardpoints: [
      { id: "weapon-port", type: "weapon", localPosition: { x: 14, y: -10 }, orientation: "east" },
      { id: "weapon-starboard", type: "weapon", localPosition: { x: 14, y: 10 }, orientation: "east" },
      { id: "engine-rear", type: "engine", localPosition: { x: -18, y: 0 }, orientation: "west" },
      { id: "power-core", type: "power", localPosition: { x: -4, y: 0 }, orientation: "east" },
      { id: "armor-ring", type: "armor", localPosition: { x: 0, y: 12 }, orientation: "south" }
    ]
  },
  {
    // Miner: two utility mounts for mining tools and a light gun. Built mostly from rock and stone so it is
    // reachable early, and sturdy enough to work near enemies.
    id: "delver-miner",
    name: "Delver Miner",
    category: "miner",
    baseHull: 150,
    mass: 65,
    powerCapacity: 40,
    energyCapacity: 70,
    baseThrust: 80,
    torque: 85,
    buildCost: { rock: 60, stone: 40, ferrite: 40 },
    buildTimeMs: 40000,
    hardpoints: [
      { id: "utility-port", type: "utility", localPosition: { x: 6, y: -12 }, orientation: "north" },
      { id: "utility-starboard", type: "utility", localPosition: { x: 6, y: 12 }, orientation: "south" },
      { id: "weapon-front", type: "weapon", localPosition: { x: 16, y: 0 }, orientation: "east" },
      { id: "engine-rear", type: "engine", localPosition: { x: -16, y: 0 }, orientation: "west" },
      { id: "armor-nose", type: "armor", localPosition: { x: 10, y: 0 }, orientation: "east" }
    ]
  }
];
