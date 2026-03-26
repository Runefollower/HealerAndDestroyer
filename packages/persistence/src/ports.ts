import type { ChunkDelta, PersistentMapSummary, PersistentWorld, PlayerSave, StoredShip } from "@healer/shared";
import type { MapId, PlayerId, ShipId, WorldId } from "@healer/shared";

export interface PlayerRepository {
  getPlayer(worldId: WorldId, playerId: PlayerId): Promise<PlayerSave | null>;
  savePlayer(player: PlayerSave): Promise<void>;
}

export interface WorldRepository {
  getWorld(worldId: WorldId): Promise<PersistentWorld | null>;
  saveWorld(world: PersistentWorld): Promise<void>;
}

export interface MapRepository {
  getMap(worldId: WorldId, mapId: MapId): Promise<PersistentMapSummary | null>;
  saveMap(worldId: WorldId, map: PersistentMapSummary, chunkDeltas: ChunkDelta[]): Promise<void>;
}

export interface StructureRepository {
  saveStructureSnapshot(worldId: WorldId, mapId: MapId, structures: unknown[]): Promise<void>;
}

export interface ShipRepository {
  saveShip(worldId: WorldId, playerId: PlayerId, ship: StoredShip): Promise<void>;
  getShip(worldId: WorldId, playerId: PlayerId, shipId: ShipId): Promise<StoredShip | null>;
}

export interface PersistenceBundle {
  players: PlayerRepository;
  worlds: WorldRepository;
  maps: MapRepository;
  structures: StructureRepository;
  ships: ShipRepository;
}

