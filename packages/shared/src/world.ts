import type { EntityId, MapId, PlayerId } from "./ids.js";
import type { InstalledModule } from "./content.js";
import type { ResourceMap } from "./resources.js";
import type { MapConnection } from "./persistence.js";
import type { Vec2 } from "./math.js";

export type CellType = 0 | 1 | 2 | 3 | 4 | 5;

export interface ChunkState {
  chunkX: number;
  chunkY: number;
  cells: number[];
  dirty: boolean;
  active: boolean;
}

export interface PlayerShipState {
  id: EntityId;
  playerId: PlayerId;
  shipId: string;
  mapId: MapId;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  angularVelocity: number;
  hull: number;
  maxHull: number;
  power: number;
  maxPower: number;
  modules: InstalledModule[];
  inventory: ResourceMap;
}

export interface EnemyState {
  id: EntityId;
  mapId: MapId;
  enemyTypeId: string;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  health: number;
  aiState: "idle" | "chasing";
  sourceFoundryId?: EntityId | null;
}

export interface ProjectileState {
  id: EntityId;
  mapId: MapId;
  ownerPlayerId: PlayerId;
  position: Vec2;
  velocity: Vec2;
  damage: number;
  lifetimeMs: number;
}

export interface StructureState {
  id: EntityId;
  mapId: MapId;
  ownerType: "player" | "enemy" | "neutral";
  structureTypeId: string;
  position: Vec2;
  health: number;
  maxHealth: number;
  buildState: "planned" | "building" | "active" | "destroyed";
}

export interface LootDropState {
  id: EntityId;
  mapId: MapId;
  position: Vec2;
  resources: ResourceMap;
  ownerPlayerId?: PlayerId | null;
  protectedUntil?: number | null;
}

export interface ActiveMapState {
  id: MapId;
  seed: string;
  width: number;
  height: number;
  chunks: Record<string, ChunkState>;
  players: Record<string, PlayerShipState>;
  enemies: Record<string, EnemyState>;
  projectiles: Record<string, ProjectileState>;
  structures: Record<string, StructureState>;
  drops: Record<string, LootDropState>;
  connections: MapConnection[];
}

export interface WorldRuntimeState {
  worldId: string;
  activeMapId: MapId;
  maps: Record<string, ActiveMapState>;
}

