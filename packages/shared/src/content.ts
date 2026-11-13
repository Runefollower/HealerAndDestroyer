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
  // powerCapacity is the hull reactor's output. Installed modules' powerUse must fit inside it (plus any
  // power-module output), and whatever is left over recharges the energy store.
  powerCapacity: number;
  // energyCapacity is the built-in energy store that weapon shots and support pulses draw from.
  energyCapacity: number;
  // baseThrust is the hull's own maneuvering thrust, so a ship without an engine module can still crawl.
  baseThrust: number;
  // torque sets turn rate together with total mass (turn step = torque / mass, GDD 8.3).
  torque: number;
  buildCost: ResourceMap;
  buildTimeMs: number;
  hardpoints: HardpointDefinition[];
}

export interface EngineModuleConfig {
  // thrust adds to the hull's base thrust; acceleration = total thrust / total mass.
  thrust: number;
  // torque optionally adds turning authority on top of the hull's own torque.
  torque?: number;
}

export interface PowerModuleConfig {
  // output raises the ship's power budget (and so its recharge surplus).
  output: number;
  // storage raises the energy store's capacity.
  storage: number;
}

export interface ArmorModuleConfig {
  // hullBonus raises the ship's maximum hull integrity while installed.
  hullBonus: number;
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
  // energyCost is spent from the ship's energy store on each successful repair pulse.
  energyCost: number;
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
  engine?: EngineModuleConfig;
  power?: PowerModuleConfig;
  armor?: ArmorModuleConfig;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  damage: number;
  // range is the projectile speed in pixels per second for the current prototype.
  range: number;
  cooldownMs: number;
  // energyCost is spent from the ship's energy store on each shot.
  energyCost: number;
  // projectileLifetimeMs overrides the default lifetime of cooldownMs * 3.
  projectileLifetimeMs?: number;
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
