import { Pool } from "pg";
import type { PersistedMapState, PersistentWorld, PlayerSave, StoredShip } from "@healer/shared";
import type { MapId, PlayerId, ShipId, WorldId } from "@healer/shared";
import type { MapRepository, PersistenceBundle, PlayerRepository, ShipRepository, StructureRepository, WorldRepository } from "./ports.js";

export interface PostgresPersistenceOptions {
  connectionString: string;
}

class PostgresPlayerRepository implements PlayerRepository {
  constructor(private readonly pool: Pool) {}

  async getPlayer(worldId: WorldId, playerId: PlayerId): Promise<PlayerSave | null> {
    const result = await this.pool.query("select payload from players where world_id = $1 and player_id = $2", [worldId, playerId]);
    return (result.rows[0]?.payload as PlayerSave | undefined) ?? null;
  }

  async savePlayer(player: PlayerSave): Promise<void> {
    await this.pool.query(
      "insert into players(world_id, player_id, payload) values ($1, $2, $3) on conflict (world_id, player_id) do update set payload = excluded.payload",
      [player.worldId, player.playerId, player]
    );
  }
}

class PostgresWorldRepository implements WorldRepository {
  constructor(private readonly pool: Pool) {}

  async getWorld(worldId: WorldId): Promise<PersistentWorld | null> {
    const result = await this.pool.query("select payload from worlds where world_id = $1", [worldId]);
    return (result.rows[0]?.payload as PersistentWorld | undefined) ?? null;
  }

  async saveWorld(world: PersistentWorld): Promise<void> {
    await this.pool.query(
      "insert into worlds(world_id, payload) values ($1, $2) on conflict (world_id) do update set payload = excluded.payload",
      [world.id, world]
    );
  }
}

class PostgresMapRepository implements MapRepository {
  constructor(private readonly pool: Pool) {}

  async getMapState(worldId: WorldId, mapId: MapId): Promise<PersistedMapState | null> {
    const result = await this.pool.query("select payload, chunk_deltas from maps where world_id = $1 and map_id = $2", [worldId, mapId]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      map: row.payload as PersistedMapState["map"],
      chunkDeltas: (row.chunk_deltas as PersistedMapState["chunkDeltas"]) ?? []
    };
  }

  async saveMapState(worldId: WorldId, mapState: PersistedMapState): Promise<void> {
    await this.pool.query(
      "insert into maps(world_id, map_id, payload, chunk_deltas) values ($1, $2, $3, $4) on conflict (world_id, map_id) do update set payload = excluded.payload, chunk_deltas = excluded.chunk_deltas",
      [worldId, mapState.map.id, mapState.map, mapState.chunkDeltas]
    );
  }
}

class PostgresStructureRepository implements StructureRepository {
  constructor(private readonly pool: Pool) {}

  async saveStructureSnapshot(worldId: WorldId, mapId: MapId, structures: unknown[]): Promise<void> {
    await this.pool.query(
      "insert into structures(world_id, map_id, payload) values ($1, $2, $3) on conflict (world_id, map_id) do update set payload = excluded.payload",
      [worldId, mapId, structures]
    );
  }
}

class PostgresShipRepository implements ShipRepository {
  constructor(private readonly pool: Pool) {}

  async saveShip(worldId: WorldId, playerId: PlayerId, ship: StoredShip): Promise<void> {
    await this.pool.query(
      "insert into ships(world_id, player_id, ship_id, payload) values ($1, $2, $3, $4) on conflict (world_id, player_id, ship_id) do update set payload = excluded.payload",
      [worldId, playerId, ship.id, ship]
    );
  }

  async getShip(worldId: WorldId, playerId: PlayerId, shipId: ShipId): Promise<StoredShip | null> {
    const result = await this.pool.query("select payload from ships where world_id = $1 and player_id = $2 and ship_id = $3", [worldId, playerId, shipId]);
    return (result.rows[0]?.payload as StoredShip | undefined) ?? null;
  }
}

export function createPostgresPersistence(options: PostgresPersistenceOptions): PersistenceBundle {
  const pool = new Pool({ connectionString: options.connectionString });
  return {
    players: new PostgresPlayerRepository(pool),
    worlds: new PostgresWorldRepository(pool),
    maps: new PostgresMapRepository(pool),
    structures: new PostgresStructureRepository(pool),
    ships: new PostgresShipRepository(pool)
  };
}

export const POSTGRES_SCHEMA_SQL = `
create table if not exists worlds (
  world_id text primary key,
  payload jsonb not null
);

create table if not exists players (
  world_id text not null,
  player_id text not null,
  payload jsonb not null,
  primary key (world_id, player_id)
);

create table if not exists maps (
  world_id text not null,
  map_id text not null,
  payload jsonb not null,
  chunk_deltas jsonb not null default '[]'::jsonb,
  primary key (world_id, map_id)
);

create table if not exists structures (
  world_id text not null,
  map_id text not null,
  payload jsonb not null,
  primary key (world_id, map_id)
);

create table if not exists ships (
  world_id text not null,
  player_id text not null,
  ship_id text not null,
  payload jsonb not null,
  primary key (world_id, player_id, ship_id)
);
`;
