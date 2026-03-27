import type { ConnectionId, EntityId, MapId, PlayerId, ShipId, WorldId } from "./ids.js";
import type { InstalledModule } from "./content.js";
import type { ResourceMap } from "./resources.js";
import type { Vec2, Vec2i } from "./math.js";

export interface CraftedModuleStack {
  moduleId: string;
  quantity: number;
}

export interface SpawnPoint {
  mapId: MapId;
  position: Vec2;
}

export interface StoredShip {
  id: ShipId;
  name: string;
  hullId: string;
  modules: InstalledModule[];
  hullIntegrity: number;
  status: "ready" | "active" | "building";
  buildStartedAt?: number | null;
  buildCompleteAt?: number | null;
}

export interface PlayerSave {
  playerId: PlayerId;
  worldId: WorldId;
  resourceCounts: ResourceMap;
  craftedModules: CraftedModuleStack[];
  shipStable: Record<string, StoredShip>;
  activeShipId: ShipId;
  spawnPoint: SpawnPoint;
  teamId: string | null;
  discoveredMapIds: MapId[];
  updatedAt: number;
}

export interface MapConnection {
  id: ConnectionId;
  sourceMapId: MapId;
  sourceAnchor: Vec2i;
  destinationMapId?: MapId;
  destinationAnchor?: Vec2i;
  type: "tunnel" | "gate" | "portal" | "shaft";
  discovered: boolean;
}

export interface PersistentMapSummary {
  id: MapId;
  seed: string;
  status: "undiscovered" | "discovered" | "active" | "sleeping";
  connectionIds: ConnectionId[];
  lastActivatedAt: number | null;
  biomeId?: string;
}

export interface WorldGraph {
  worldId: WorldId;
  rootMapId: MapId;
  discoveredMapIds: MapId[];
  connectionIndex: Record<string, MapConnection>;
  activeMapIds: MapId[];
}

export interface PersistentWorld {
  id: WorldId;
  name: string;
  seed: string;
  createdAt: number;
  updatedAt: number;
  graph: WorldGraph;
  maps: Record<string, PersistentMapSummary>;
  playerIds: PlayerId[];
  paused: boolean;
}

export interface ChunkDelta {
  chunkKey: string;
  changedCells: Array<{ index: number; value: number }>;
}

export interface PersistedStructureState {
  id: EntityId;
  structureTypeId: string;
  position: Vec2;
  health: number;
  maxHealth: number;
  buildState: "planned" | "building" | "active" | "destroyed";
}

export interface PersistedFoundryState extends PersistedStructureState {
  spawnCooldownMs: number;
  spawnCap: number;
  lastSpawnAt: number;
  activeEnemyCount: number;
  active: boolean;
  destroyedAt?: number | null;
}

export interface PersistedMapState {
  map: PersistentMapSummary;
  chunkDeltas: ChunkDelta[];
  structures: PersistedStructureState[];
  foundries: PersistedFoundryState[];
}
