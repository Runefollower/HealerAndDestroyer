import { enemyDefinitions, structureDefinitions } from "@healer/content";
import {
  asConnectionId,
  asEntityId,
  asMapId,
  asPlayerId,
  asShipId,
  asWorldId,
  type ActiveMapState,
  type MapConnection,
  type PersistentWorld,
  type PlayerSave,
  type WorldRuntimeState
} from "@healer/shared";

function createChunk(fill: number): number[] {
  return Array.from({ length: 64 }, (_, index) => (index % 7 === 0 ? fill : 0));
}

export function createWorldGraph(worldId = asWorldId("world-alpha")): PersistentWorld {
  const rootMapId = asMapId("map-root");
  const deeperMapId = asMapId("map-depth-1");
  const connection: MapConnection = {
    id: asConnectionId("conn-root-depth-1"),
    sourceMapId: rootMapId,
    sourceAnchor: { x: 7, y: 3 },
    destinationMapId: deeperMapId,
    destinationAnchor: { x: 1, y: 6 },
    type: "tunnel",
    discovered: true
  };

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

export function createActiveMaps(): Record<string, ActiveMapState> {
  const rootMapId = asMapId("map-root");
  const deeperMapId = asMapId("map-depth-1");
  const connection: MapConnection = {
    id: asConnectionId("conn-root-depth-1"),
    sourceMapId: rootMapId,
    sourceAnchor: { x: 7, y: 3 },
    destinationMapId: deeperMapId,
    destinationAnchor: { x: 1, y: 6 },
    type: "tunnel",
    discovered: true
  };

  const builderSite = structureDefinitions.find((entry) => entry.id === "builder-site");
  const foundry = structureDefinitions.find((entry) => entry.id === "enemy-foundry");
  const scoutEnemy = enemyDefinitions[0];

  return {
    [rootMapId]: {
      id: rootMapId,
      seed: "root-seed",
      width: 64,
      height: 64,
      chunks: {
        "0,0": { chunkX: 0, chunkY: 0, cells: createChunk(1), dirty: false, active: true }
      },
      players: {},
      enemies: {
        "enemy-1": {
          id: asEntityId("enemy-1"),
          mapId: rootMapId,
          enemyTypeId: scoutEnemy.id,
          position: { x: 280, y: 160 },
          velocity: { x: 0, y: 0 },
          rotation: 0,
          health: scoutEnemy.maxHealth,
          aiState: "idle",
          sourceFoundryId: asEntityId("structure-foundry")
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
        },
        "structure-foundry": {
          id: asEntityId("structure-foundry"),
          mapId: rootMapId,
          ownerType: "enemy",
          structureTypeId: foundry?.id ?? "enemy-foundry",
          position: { x: 320, y: 180 },
          health: foundry?.maxHealth ?? 350,
          maxHealth: foundry?.maxHealth ?? 350,
          buildState: "active"
        }
      },
      drops: {},
      connections: [connection]
    },
    [deeperMapId]: {
      id: deeperMapId,
      seed: "depth-seed",
      width: 64,
      height: 64,
      chunks: {
        "0,0": { chunkX: 0, chunkY: 0, cells: createChunk(2), dirty: false, active: true }
      },
      players: {},
      enemies: {},
      projectiles: {},
      structures: {},
      drops: {},
      connections: [connection]
    }
  };
}

export function createDefaultPlayerSave(worldId: string, playerId: string): PlayerSave {
  const mapId = asMapId("map-root");
  const shipId = asShipId(`ship-${playerId}`);
  return {
    playerId: asPlayerId(playerId),
    worldId: asWorldId(worldId),
    resourceCounts: { ferrite: 25, "plasma-crystal": 5 },
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
        status: "active"
      }
    },
    activeShipId: shipId,
    spawnPoint: {
      mapId,
      position: { x: 64, y: 64 }
    },
    teamId: null,
    discoveredMapIds: [mapId],
    updatedAt: Date.now()
  };
}

export function createRuntimeState(): WorldRuntimeState {
  return {
    worldId: "world-alpha",
    activeMapId: asMapId("map-root"),
    maps: createActiveMaps()
  };
}

