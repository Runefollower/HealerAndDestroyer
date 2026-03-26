import type { ResourceMap } from "./resources.js";
import type { Vec2 } from "./math.js";

export type Direction =
  | "north"
  | "south"
  | "east"
  | "west"
  | "northEast"
  | "northWest"
  | "southEast"
  | "southWest";

export type HardpointType =
  | "weapon"
  | "turret"
  | "support"
  | "utility"
  | "engine"
  | "armor"
  | "power"
  | "structural"
  | "cargo";

export interface HardpointDefinition {
  id: string;
  type: HardpointType;
  localPosition: Vec2;
  orientation: Direction;
}

export interface HullDefinition {
  id: string;
  name: string;
  category: "scout" | "healer" | "destroyer" | "miner" | "heavy";
  baseHull: number;
  mass: number;
  powerCapacity: number;
  buildCost: ResourceMap;
  buildTimeMs: number;
  hardpoints: HardpointDefinition[];
}

export interface ModuleDefinition {
  id: string;
  name: string;
  slotType: HardpointType;
  mass: number;
  powerUse: number;
  maxHealth: number;
  rarity: "basic" | "improved" | "advanced" | "rare";
  buildCost: ResourceMap;
  craftTimeMs: number;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  damage: number;
  range: number;
  cooldownMs: number;
}

export interface EnemyDefinition {
  id: string;
  name: string;
  maxHealth: number;
  speed: number;
  contactDamage: number;
  salvage: ResourceMap;
}

export interface StructureDefinition {
  id: string;
  name: string;
  structureKind: "builderSite" | "foundry" | "turret";
  maxHealth: number;
}

export interface ResourceDefinition {
  id: string;
  name: string;
  color: number;
}

export interface InstalledModule {
  moduleId: string;
  hardpointId: string;
  currentHealth: number;
}

