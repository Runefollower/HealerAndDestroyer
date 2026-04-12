import { enemyDefinitions, structureDefinitions } from "@healer/content";
import {
  asConnectionId,
  asEntityId,
  asMapId,
  asPlayerId,
  asShipId,
  asWorldId,
  type ActiveMapState,
  type FoundryState,
  type MapConnection,
  type PersistentWorld,
  type PlayerSave,
  type WorldRuntimeState
} from "@healer/shared";

export const CHUNK_SIZE = 8;

// Creates one prototype terrain chunk with sparse filled cells for early mining tests.
function createChunk(fill: number): number[] {
  return Array.from({ length: CHUNK_SIZE * CHUNK_SIZE }, (_, index) => (index % 7 === 0 ? fill : 0));
}

// Builds a rectangular chunk map keyed by "chunkX,chunkY" for runtime lookup.
function createChunkGrid(widthInChunks: number, heightInChunks: number, fill: number): ActiveMapState["chunks"] {
  return Object.fromEntries(
    Array.from({ length: widthInChunks * heightInChunks }, (_, index) => {
      const chunkX = index % widthInChunks;
      const chunkY = Math.floor(index / widthInChunks);
      return [`${chunkX},${chunkY}`, { chunkX, chunkY, cells: createChunk(fill), dirty: false, active: true }];
    })
  );
}

// Defines the starter tunnel from the root map into the deeper prototype map.
function createRootConnection(): MapConnection {
  return {
    id: asConnectionId("conn-root-depth-1"),
    sourceMapId: asMapId("map-root"),
    sourceAnchor: { x: 7, y: 3 },
    destinationMapId: asMapId("map-depth-1"),
    destinationAnchor: { x: 1, y: 6 },
    type: "tunnel",
    discovered: true
  };
}

// Creates the starter foundry that acts as the root-map objective gate.
function createFoundryState(): FoundryState {
  // Content definitions provide health tuning while this file owns prototype placement/spawn state.
  const foundry = structureDefinitions.find((entry) => entry.id === "enemy-foundry");
  return {
    id: asEntityId("foundry-root-1"),
    mapId: asMapId("map-root"),
    ownerType: "enemy",
    structureTypeId: foundry?.id ?? "enemy-foundry",
    position: { x: 320, y: 180 },
    health: foundry?.maxHealth ?? 350,
    maxHealth: foundry?.maxHealth ?? 350,
    buildState: "active",
    spawnCooldownMs: 3000,
    spawnCap: 3,
    lastSpawnAt: Date.now(),
    activeEnemyCount: 1,
    active: true,
    destroyedAt: null
  };
}

// Creates the persistent world graph metadata used to bootstrap or seed storage.
export function createWorldGraph(worldId = asWorldId("world-alpha")): PersistentWorld {
  // Stable ids keep tests, snapshots, and persisted records deterministic across process restarts.
  const rootMapId = asMapId("map-root");
  const deeperMapId = asMapId("map-depth-1");
  const connection = createRootConnection();

  return {
    id: worldId,
    name: "Alpha Cavern",
    seed: "alpha-seed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    graph: {
      worldId,
      rootMapId,
      discoveredMapIds: [rootMapId, deeperMapId],
      connectionIndex: { [connection.id]: connection },
      activeMapIds: [rootMapId]
    },
    maps: {
      [rootMapId]: {
        id: rootMapId,
        seed: "root-seed",
        status: "active",
        connectionIds: [connection.id],
        lastActivatedAt: Date.now(),
        biomeId: "starter-cavern"
      },
      [deeperMapId]: {
        id: deeperMapId,
        seed: "depth-seed",
        status: "discovered",
        connectionIds: [connection.id],
        lastActivatedAt: null,
        biomeId: "deep-cavern"
      }
    },
    playerIds: [],
    paused: false
  };
}

// Creates in-memory active map state from prototype templates and content definitions.
export function createActiveMaps(): Record<string, ActiveMapState> {
  // These ids and content references define the playable vertical-slice layout.
  const rootMapId = asMapId("map-root");
  const deeperMapId = asMapId("map-depth-1");
  const connection = createRootConnection();
  const builderSite = structureDefinitions.find((entry) => entry.id === "builder-site");
  const scoutEnemy = enemyDefinitions[0];
  const rootFoundry = createFoundryState();

  // Root map contains the player start area, builder site, first enemy, and objective foundry.
  return {
    [rootMapId]: {
      id: rootMapId,
      seed: "root-seed",
      width: 128,
      height: 128,
      chunks: createChunkGrid(4, 2, 1),
      players: {},
      enemies: {
        "enemy-root-1": {
          id: asEntityId("enemy-root-1"),
          mapId: rootMapId,
          enemyTypeId: scoutEnemy.id,
          position: { x: 280, y: 160 },
          velocity: { x: 0, y: 0 },
          rotation: 0,
          health: scoutEnemy.maxHealth,
          aiState: "idle",
          sourceFoundryId: rootFoundry.id
        }
      },
      projectiles: {},
      structures: {
        "structure-builder": {
          id: asEntityId("structure-builder"),
          mapId: rootMapId,
          ownerType: "neutral",
          structureTypeId: builderSite?.id ?? "builder-site",
          position: { x: 96, y: 96 },
          health: builderSite?.maxHealth ?? 500,
          maxHealth: builderSite?.maxHealth ?? 500,
          buildState: "active"
        }
      },
      foundries: {
        [rootFoundry.id]: rootFoundry
      },
      drops: {},
      connections: [connection]
    },
    // Deeper map starts discovered but locked behind root foundry progression.
    [deeperMapId]: {
      id: deeperMapId,
      seed: "depth-seed",
      width: 64,
      height: 64,
      chunks: createChunkGrid(2, 1, 2),
      players: {},
      enemies: {},
      projectiles: {},
      structures: {},
      foundries: {},
      drops: {},
      connections: [connection]
    }
  };
}

// Creates the first-time player save with starter resources, ship, modules, and spawn point.
export function createDefaultPlayerSave(worldId: string, playerId: string): PlayerSave {
  // The ship id is derived from player id so repeated save creation stays predictable.
  const mapId = asMapId("map-root");
  const shipId = asShipId(`ship-${playerId}`);
  return {
    playerId: asPlayerId(playerId),
    worldId: asWorldId(worldId),
    resourceCounts: { ferrite: 25, "plasma-crystal": 5 },
    craftedModules: [],
    shipStable: {
      [shipId]: {
        id: shipId,
        name: "Starter Sparrow",
        hullId: "sparrow-scout",
        modules: [
          { moduleId: "starter-thruster", hardpointId: "engine-rear", currentHealth: 30 },
          { moduleId: "pulse-cannon", hardpointId: "weapon-front", currentHealth: 24 },
          { moduleId: "mining-laser", hardpointId: "utility-belly", currentHealth: 20 }
        ],
        hullIntegrity: 100,
        status: "active",
        buildStartedAt: null,
        buildCompleteAt: null
      }
    },
    activeShipId: shipId,
    spawnPoint: {
      mapId,
      position: { x: 64, y: 64 }
    },
    teamId: null,
    discoveredMapIds: [mapId],
    terrainMemoryByMap: {},
    updatedAt: Date.now()
  };
}

// Creates a fresh runtime state graph for the authoritative simulation.
export function createRuntimeState(): WorldRuntimeState {
  return {
    worldId: "world-alpha",
    activeMapId: asMapId("map-root"),
    maps: createActiveMaps()
  };
}

