import type { PersistedMapState, PersistentWorld, PlayerSave, StoredShip } from "@healer/shared";
import type { MapId, PlayerId, ShipId, WorldId } from "@healer/shared";
import type { MapRepository, PersistenceBundle, PlayerRepository, ShipRepository, StructureRepository, WorldRepository } from "./ports.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

class InMemoryPlayerRepository implements PlayerRepository {
  private players = new Map<string, PlayerSave>();

  async getPlayer(worldId: WorldId, playerId: PlayerId): Promise<PlayerSave | null> {
    return clone(this.players.get(`${worldId}:${playerId}`) ?? null);
  }

  async savePlayer(player: PlayerSave): Promise<void> {
    this.players.set(`${player.worldId}:${player.playerId}`, clone(player));
  }
}

class InMemoryWorldRepository implements WorldRepository {
  private worlds = new Map<string, PersistentWorld>();

  async getWorld(worldId: WorldId): Promise<PersistentWorld | null> {
    return clone(this.worlds.get(worldId) ?? null);
  }

  async saveWorld(world: PersistentWorld): Promise<void> {
    this.worlds.set(world.id, clone(world));
  }
}

class InMemoryMapRepository implements MapRepository {
  private maps = new Map<string, PersistedMapState>();

  async getMapState(worldId: WorldId, mapId: MapId): Promise<PersistedMapState | null> {
    return clone(this.maps.get(`${worldId}:${mapId}`) ?? null);
  }

  async saveMapState(worldId: WorldId, mapState: PersistedMapState): Promise<void> {
    this.maps.set(`${worldId}:${mapState.map.id}`, clone(mapState));
  }
}

class InMemoryStructureRepository implements StructureRepository {
  private snapshots = new Map<string, unknown[]>();

  async saveStructureSnapshot(worldId: WorldId, mapId: MapId, structures: unknown[]): Promise<void> {
    this.snapshots.set(`${worldId}:${mapId}`, clone(structures));
  }
}

class InMemoryShipRepository implements ShipRepository {
  private ships = new Map<string, StoredShip>();

  async saveShip(worldId: WorldId, playerId: PlayerId, ship: StoredShip): Promise<void> {
    this.ships.set(`${worldId}:${playerId}:${ship.id}`, clone(ship));
  }

  async getShip(worldId: WorldId, playerId: PlayerId, shipId: ShipId): Promise<StoredShip | null> {
    return clone(this.ships.get(`${worldId}:${playerId}:${shipId}`) ?? null);
  }
}

export function createInMemoryPersistence(): PersistenceBundle {
  return {
    players: new InMemoryPlayerRepository(),
    worlds: new InMemoryWorldRepository(),
    maps: new InMemoryMapRepository(),
    structures: new InMemoryStructureRepository(),
    ships: new InMemoryShipRepository()
  };
}
