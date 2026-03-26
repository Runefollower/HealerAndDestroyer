import type { HullDefinition } from "@healer/shared";

export const hullDefinitions: HullDefinition[] = [
  {
    id: "sparrow-scout",
    name: "Sparrow Scout",
    category: "scout",
    baseHull: 100,
    mass: 40,
    powerCapacity: 60,
    buildCost: { ferrite: 0 },
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
    powerCapacity: 85,
    buildCost: { ferrite: 80, "plasma-crystal": 20 },
    buildTimeMs: 45000,
    hardpoints: [
      { id: "support-top", type: "support", localPosition: { x: 0, y: -10 }, orientation: "north" },
      { id: "weapon-front", type: "weapon", localPosition: { x: 14, y: 0 }, orientation: "east" },
      { id: "engine-rear", type: "engine", localPosition: { x: -16, y: 0 }, orientation: "west" },
            { id: "power-core", type: "power", localPosition: { x: -4, y: 0 }, orientation: "east" },
      { id: "armor-ring", type: "armor", localPosition: { x: 0, y: 10 }, orientation: "south" }
    ]
  }
];




