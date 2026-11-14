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

export type ModuleCapability = "weapon" | "mining" | "support" | "passive";

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

export interface WeaponModuleConfig {
  weaponId: string;
}

export interface MiningModuleConfig {
  range: number;
  terrainDamage: number;
  cooldownMs: number;
  yieldMultiplier: number;
}

export interface SupportModuleConfig {
  range: number;
  repairAmount: number;
  cooldownMs: number;
  allowSelfTarget: boolean;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  slotType: HardpointType;
  capabilities: ModuleCapability[];
  mass: number;
  powerUse: number;
  maxHealth: number;
  rarity: "basic" | "improved" | "advanced" | "rare";
  buildCost: ResourceMap;
  craftTimeMs: number;
  weapon?: WeaponModuleConfig;
  mining?: MiningModuleConfig;
  support?: SupportModuleConfig;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  damage: number;
  range: number;
  cooldownMs: number;
}

// EnemyRole picks the AI behavior: melee units ram for contact damage, ranged units hold distance and
// shoot, and turrets are stationary fortification defenses that shoot whatever they can see.
export type EnemyRole = "melee" | "ranged" | "turret";

export interface EnemyRangedAttack {
  // damage is hull removed per bolt that hits a player ship.
  damage: number;
  // range is the farthest distance (pixels) at which the enemy opens fire.
  range: number;
  // cooldownMs is the time between shots.
  cooldownMs: number;
  // projectileSpeed is bolt speed in pixels per second.
  projectileSpeed: number;
  // preferredRange is the distance a mobile ranged enemy tries to hold from its target.
  preferredRange: number;
}

export interface EnemyDefinition {
  id: string;
  name: string;
  role: EnemyRole;
  maxHealth: number;
  // speed is movement speed in pixels per second; turrets use 0.
  speed: number;
  // contactDamage is hull removed per contact hit, at most once per attackCooldownMs.
  contactDamage: number;
  attackCooldownMs: number;
  // visionRadiusTiles is how far the enemy can see a player through line of sight.
  visionRadiusTiles: number;
  // collisionRadius is the enemy body radius in pixels for movement, hits, and placement.
  collisionRadius: number;
  ranged?: EnemyRangedAttack;
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
