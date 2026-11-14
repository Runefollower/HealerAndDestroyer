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
import { getMapArchetype, prototypeMaps, type PrototypeMapDefinition } from "./mapArchetypes.js";
import { generateMapLayout, tileToWorld, type GeneratedMapLayout } from "./mapGeneration.js";
import { createFoundry, defenseCountForDepth, planFoundryDefenses } from "./foundries.js";
import { createUndiscoveredExit } from "./worldGraph.js";

export { CHUNK_SIZE } from "./mapGeneration.js";

// Generates a prototype map's baseline layout from its seed and archetype config data.
function generatePrototypeLayout(definition: PrototypeMapDefinition): GeneratedMapLayout {
  return generateMapLayout(definition.seed, definition.archetypeId);
}

// Defines the starter tunnel from the root map into the deeper prototype map.
function createRootConnection(): MapConnection {
  const rootLayout = generatePrototypeLayout(prototypeMaps.root);
  const deeperLayout = generatePrototypeLayout(prototypeMaps.deeper);
  return {
    id: asConnectionId("conn-root-depth-1"),
    sourceMapId: asMapId(prototypeMaps.root.mapId),
    sourceAnchor: rootLayout.sourceAnchor,
    destinationMapId: asMapId(prototypeMaps.deeper.mapId),
    destinationAnchor: deeperLayout.destinationAnchor,
    type: "tunnel",
    discovered: true
  };
}

const worldSeed = "alpha-seed";

// Reserves the undiscovered exit at the bottom of the deeper prototype map; the first player through
// it generates the next map in the world graph.
function createDeeperExit(): MapConnection {
  const deeperLayout = generatePrototypeLayout(prototypeMaps.deeper);
  return createUndiscoveredExit(worldSeed, prototypeMaps.deeper.mapId, 1, deeperLayout.sourceAnchor);
}

// Creates the starter foundry that acts as the root-map objective gate, tuned by the starter archetype.
function createRootFoundry(position: { x: number; y: number }): FoundryState {
  const config = getMapArchetype(prototypeMaps.root.archetypeId).content.foundry;
  if (!config) {
    throw new Error("The root map archetype must define a foundry.");
  }
  // The hand-placed starter enemy counts toward the cap from the start.
  return createFoundry({
    id: "foundry-root-1",
    mapId: asMapId(prototypeMaps.root.mapId),
    position,
    config,
    depth: 0,
    now: Date.now(),
    activeEnemyCount: 1
  });
}

// Creates the persistent world graph metadata used to bootstrap or seed storage.
export function createWorldGraph(worldId = asWorldId("world-alpha")): PersistentWorld {
  // Stable ids keep tests, snapshots, and persisted records deterministic across process restarts.
  const rootMapId = asMapId(prototypeMaps.root.mapId);
  const deeperMapId = asMapId(prototypeMaps.deeper.mapId);
  const connection = createRootConnection();
  const deeperExit = createDeeperExit();

  return {
    id: worldId,
    name: "Alpha Cavern",
    seed: worldSeed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    graph: {
      worldId,
      rootMapId,
      discoveredMapIds: [rootMapId, deeperMapId],
      connectionIndex: { [connection.id]: connection, [deeperExit.id]: deeperExit },
      activeMapIds: [rootMapId]
    },
    maps: {
      [rootMapId]: {
        id: rootMapId,
        seed: prototypeMaps.root.seed,
        status: "active",
        connectionIds: [connection.id],
        lastActivatedAt: Date.now(),
        biomeId: prototypeMaps.root.archetypeId,
        depth: 0
      },
      [deeperMapId]: {
        id: deeperMapId,
        seed: prototypeMaps.deeper.seed,
        status: "discovered",
        connectionIds: [connection.id, deeperExit.id],
        lastActivatedAt: null,
        biomeId: prototypeMaps.deeper.archetypeId,
        depth: 1
      }
    },
    playerIds: [],
    paused: false
  };
}

// Creates in-memory active map state from prototype templates and content definitions.
export function createActiveMaps(): Record<string, ActiveMapState> {
  // These ids and content references define the playable vertical-slice layout.
  const rootMapId = asMapId(prototypeMaps.root.mapId);
  const deeperMapId = asMapId(prototypeMaps.deeper.mapId);
  const connection = createRootConnection();
  const builderSite = structureDefinitions.find((entry) => entry.id === "builder-site");
  const scoutEnemy = enemyDefinitions[0];
  const rootLayout = generatePrototypeLayout(prototypeMaps.root);
  const deeperLayout = generatePrototypeLayout(prototypeMaps.deeper);
  const rootFoundry = createRootFoundry(rootLayout.foundryPosition);

  // Root map contains the generated starter cave, builder site, first enemy, and objective foundry.
  const maps: Record<string, ActiveMapState> = {
    [rootMapId]: {
      id: rootMapId,
      seed: prototypeMaps.root.seed,
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
      seed: prototypeMaps.deeper.seed,
      width: deeperLayout.widthTiles,
      height: deeperLayout.heightTiles,
      chunks: deeperLayout.chunks,
      players: {},
      enemies: {},
      projectiles: {},
      structures: {},
      foundries: {},
      drops: {},
      connections: [connection, createDeeperExit()]
    }
  };

  // Fortification pocket around the root foundry, clear of the spawn, builder, and both exits. Turrets are
  // placed when GameWorld initializes (seedFoundryDefenses), after any persisted foundry state is applied.
  const rootFoundryConfig = getMapArchetype(prototypeMaps.root.archetypeId).content.foundry!;
  rootFoundry.defenseSlots = planFoundryDefenses(maps[rootMapId], rootFoundry, defenseCountForDepth(rootFoundryConfig, 0), [
    rootLayout.spawnPoint,
    rootLayout.builderPosition,
    rootLayout.enemyPosition,
    tileToWorld(rootLayout.sourceAnchor),
    tileToWorld(rootLayout.destinationAnchor)
  ]);
  return maps;
}

// Returns where a destroyed ship respawns: the player's original starting location on the root map
// (GDD §16.2 default spawn point).
export function getDefaultRespawnPoint(): { mapId: ReturnType<typeof asMapId>; position: { x: number; y: number } } {
  const rootLayout = generatePrototypeLayout(prototypeMaps.root);
  return { mapId: asMapId(prototypeMaps.root.mapId), position: { ...rootLayout.spawnPoint } };
}

// Creates the first-time player save with starter resources, ship, modules, and spawn point.
export function createDefaultPlayerSave(worldId: string, playerId: string): PlayerSave {
  // The ship id is derived from player id so repeated save creation stays predictable.
  const mapId = asMapId(prototypeMaps.root.mapId);
  const shipId = asShipId(`ship-${playerId}`);
  const rootLayout = generatePrototypeLayout(prototypeMaps.root);
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
    activeMapId: asMapId(prototypeMaps.root.mapId),
    maps: createActiveMaps()
  };
}
