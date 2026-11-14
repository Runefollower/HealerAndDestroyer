import type { EntityId, MapId, PlayerId, ShipId } from "./ids.js";
import type { InstalledModule } from "./content.js";
import type { ResourceMap } from "./resources.js";
import type { MapConnection } from "./persistence.js";
import type { Vec2 } from "./math.js";
import type { EffectEvent } from "./effects.js";

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
  shipId: ShipId;
  hullId: string;
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
  moduleCooldowns: Record<string, number>;
  // invulnerableUntil is a server timestamp; a freshly respawned ship ignores damage until then.
  invulnerableUntil?: number;
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
  // sourceFoundryId links units a foundry produced, which count toward its spawn cap.
  sourceFoundryId?: EntityId | null;
  // defendsFoundryId/defenseSlotIndex mark a fortification defense placed around a foundry. Defenses do
  // not count toward the spawn cap; the foundry rebuilds them slowly instead.
  defendsFoundryId?: EntityId | null;
  defenseSlotIndex?: number;
  // nextAttackAt is the server time this enemy may attack again (contact or ranged).
  nextAttackAt?: number;
}

export interface ProjectileState {
  id: EntityId;
  mapId: MapId;
  // faction decides what a projectile can hit: player bolts hit enemies and foundries, enemy bolts hit players.
  faction: "player" | "enemy";
  ownerPlayerId?: PlayerId | null;
  ownerEnemyId?: EntityId | null;
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

export interface FoundryState extends StructureState {
  spawnCooldownMs: number;
  spawnCap: number;
  lastSpawnAt: number;
  activeEnemyCount: number;
  active: boolean;
  destroyedAt?: number | null;
  // enemyMix is the cycle of enemy type ids this foundry produces.
  enemyMix?: string[];
  // defenseSlots are fortification positions around the foundry, each holding one defense turret.
  defenseSlots?: Vec2[];
  // defenseRebuildMs is how often an active foundry may rebuild one destroyed defense.
  defenseRebuildMs?: number;
  lastDefenseRebuildAt?: number;
  // reward is the salvage dropped when the foundry is destroyed (already scaled for depth).
  reward?: ResourceMap;
}

export interface LootDropState {
  id: EntityId;
  mapId: MapId;
  position: Vec2;
  resources: ResourceMap;
  ownerPlayerId?: PlayerId | null;
  protectedUntil?: number | null;
  // Drift state (§12). Drops are launched with a small random velocity and spin the first tick they exist,
  // so creation sites only need a position; undefined velocity means "not launched yet".
  velocity?: Vec2;
  rotation?: number;
  angularVelocity?: number;
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
  foundries: Record<string, FoundryState>;
  drops: Record<string, LootDropState>;
  connections: MapConnection[];
  // effects holds recent cosmetic events (dust, explosions) for snapshots. Runtime-only, never persisted.
  effects?: EffectEvent[];
}

export interface WorldRuntimeState {
  worldId: string;
  activeMapId: MapId;
  maps: Record<string, ActiveMapState>;
}
