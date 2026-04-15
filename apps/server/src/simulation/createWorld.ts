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
import { generateCaveMapLayout } from "./mapGeneration.js";

export { CHUNK_SIZE } from "./mapGeneration.js";

const rootMapSeed = "root-seed";
const deeperMapSeed = "depth-seed";
const rootMapChunkSize = { width: 12, height: 9 };
const deeperMapChunkSize = { width: 10, height: 8 };

// Defines the starter tunnel from the root map into the deeper prototype map.
function createRootConnection(): MapConnection {
  const rootLayout = generateCaveMapLayout(rootMapSeed, rootMapChunkSize.width, rootMapChunkSize.height);
  const deeperLayout = generateCaveMapLayout(deeperMapSeed, deeperMapChunkSize.width, deeperMapChunkSize.height);
  return {
    id: asConnectionId("conn-root-depth-1"),
    sourceMapId: asMapId("map-root"),
    sourceAnchor: rootLayout.sourceAnchor,
    destinationMapId: asMapId("map-depth-1"),
    destinationAnchor: deeperLayout.destinationAnchor,
    type: "tunnel",
    discovered: true
  };
}

// Creates the starter foundry that acts as the root-map objective gate.
function createFoundryState(position: { x: number; y: number }): FoundryState {
  // Content definitions provide health tuning while this file owns prototype placement/spawn state.
  const foundry = structureDefinitions.find((entry) => entry.id === "enemy-foundry");
  return {
    id: asEntityId("foundry-root-1"),
    mapId: asMapId("map-root"),
    ownerType: "enemy",
    structureTypeId: foundry?.id ?? "enemy-foundry",
    position,
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
        seed: rootMapSeed,
        status: "active",
        connectionIds: [connection.id],
        lastActivatedAt: Date.now(),
        biomeId: "starter-cavern"
      },
      [deeperMapId]: {
        id: deeperMapId,
        seed: deeperMapSeed,
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
  const rootLayout = generateCaveMapLayout(rootMapSeed, rootMapChunkSize.width, rootMapChunkSize.height);
  const deeperLayout = generateCaveMapLayout(deeperMapSeed, deeperMapChunkSize.width, deeperMapChunkSize.height);
  const rootFoundry = createFoundryState(rootLayout.foundryPosition);

  // Root map contains the generated starter cave, builder site, first enemy, and objective foundry.
  return {
    [rootMapId]: {
      id: rootMapId,
      seed: rootMapSeed,
      width: rootLayout.widthTiles,
      height: rootLayout.heightTiles,
      chunks: rootLayout.chunks,
      players: {},
      enemies: {
        "enemy-root-1": {
          id: asEntityId("enemy-root-1"),
          mapId: rootMapId,
          enemyTypeId: scoutEnemy.id,
          position: rootLayout.enemyPosition,
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
          position: rootLayout.builderPosition,
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
      seed: deeperMapSeed,
      width: deeperLayout.widthTiles,
      height: deeperLayout.heightTiles,
      chunks: deeperLayout.chunks,
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
  const rootLayout = generateCaveMapLayout(rootMapSeed, rootMapChunkSize.width, rootMapChunkSize.height);
  return {
    playerId: asPlayerId(playerId),
    worldId: asWorldId(worldId),
    resourceCounts: { rock: 40, ferrite: 25, "plasma-crystal": 5 },
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
      position: rootLayout.spawnPoint
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
