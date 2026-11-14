import {
  asConnectionId,
  asMapId,
  distance,
  type ActiveMapState,
  type FoundryState,
  type MapConnection,
  type MapId,
  type PersistentMapSummary,
  type PersistentWorld,
  type Vec2,
  type Vec2i
} from "@healer/shared";
import { chooseArchetypeForDepth, getMapArchetype } from "./mapArchetypes.js";
import { generateMapLayout, tileToWorld, type GeneratedMapLayout } from "./mapGeneration.js";
import { MapGenerationError } from "./mapValidation.js";
import { createFoundry, defenseCountForDepth, planFoundryDefenses } from "./foundries.js";

// A ship within this many pixels of an exit's tile center can travel through it (about two tiles).
export const EXIT_TRAVEL_RADIUS = 72;

// Reserved seeds that fail validation are retried with a numbered suffix this many times.
const maxGenerationAttempts = 8;

// Returns the id of the deeper exit reserved on a map. Each map currently has one deeper exit.
export function deeperExitId(sourceMapId: string): ReturnType<typeof asConnectionId> {
  return asConnectionId(`conn-${sourceMapId}-down`);
}

// Creates an undiscovered exit at a map's exit anchor. The destination seed and archetype are fixed now,
// so the map a player finds behind it does not depend on when or by whom it is first opened.
export function createUndiscoveredExit(worldSeed: string, sourceMapId: string, sourceDepth: number, sourceAnchor: Vec2i): MapConnection {
  const id = deeperExitId(sourceMapId);
  const destinationSeed = `${worldSeed}/${id}`;
  return {
    id,
    sourceMapId: asMapId(sourceMapId),
    sourceAnchor: { ...sourceAnchor },
    type: "tunnel",
    discovered: false,
    destinationSeed,
    destinationArchetypeId: chooseArchetypeForDepth(sourceDepth + 1, hashToUnit(destinationSeed))
  };
}

// Returns every connection that starts or ends on a map, in connection-index order.
export function connectionsForMap(world: PersistentWorld, mapId: string): MapConnection[] {
  return Object.values(world.graph.connectionIndex).filter((entry) => entry.sourceMapId === mapId || entry.destinationMapId === mapId);
}

// Returns the world-space point a ship stands on to use a connection from the given map.
export function exitPositionOnMap(connection: MapConnection, mapId: string): Vec2 | null {
  if (connection.sourceMapId === mapId) {
    return tileToWorld(connection.sourceAnchor);
  }
  if (connection.destinationMapId === mapId && connection.destinationAnchor) {
    return tileToWorld(connection.destinationAnchor);
  }
  return null;
}

// Returns the connection whose exit on this map is within travel range of a position, nearest first.
export function findNearbyExit(world: PersistentWorld, mapId: string, position: Vec2): MapConnection | null {
  let best: { connection: MapConnection; range: number } | null = null;
  for (const connection of connectionsForMap(world, mapId)) {
    const exit = exitPositionOnMap(connection, mapId);
    if (!exit) {
      continue;
    }
    const range = distance(exit, position);
    if (range <= EXIT_TRAVEL_RADIUS && (!best || range < best.range)) {
      best = { connection, range };
    }
  }
  return best?.connection ?? null;
}

// Adds an undiscovered deeper exit to every map that has no outgoing connection yet. Worlds saved
// before discovery existed get their missing exits this way on load. Returns true if anything changed.
export function ensureUndiscoveredExits(world: PersistentWorld, layouts: Record<string, GeneratedMapLayout>): boolean {
  let changed = false;
  for (const summary of Object.values(world.maps)) {
    const hasOutgoing = Object.values(world.graph.connectionIndex).some((entry) => entry.sourceMapId === summary.id);
    const layout = layouts[summary.id];
    if (hasOutgoing || !layout) {
      continue;
    }
    const exit = createUndiscoveredExit(world.seed, summary.id, summary.depth ?? 0, layout.sourceAnchor);
    world.graph.connectionIndex[exit.id] = exit;
    if (!summary.connectionIds.includes(exit.id)) {
      summary.connectionIds.push(exit.id);
    }
    changed = true;
  }
  return changed;
}

// Generates a layout from a reserved seed, retrying with suffixed seeds if validation rejects it.
// Returns the seed that actually produced the layout so the map summary can regenerate it later.
export function generateLayoutWithRetries(seed: string, archetypeId: string): { seed: string; layout: GeneratedMapLayout } {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxGenerationAttempts; attempt += 1) {
    const attemptSeed = attempt === 0 ? seed : `${seed}#${attempt}`;
    try {
      return { seed: attemptSeed, layout: generateMapLayout(attemptSeed, archetypeId) };
    } catch (error) {
      if (!(error instanceof MapGenerationError)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

// Builds the baseline runtime state for a discovered map from its layout and archetype content config.
// Persisted terrain/foundry deltas are replayed over this baseline on load, like the prototype maps.
export function buildDiscoveredMap(summary: PersistentMapSummary, layout: GeneratedMapLayout, now = Date.now()): ActiveMapState {
  const content = getMapArchetype(summary.biomeId ?? layout.archetypeId).content;
  const depth = summary.depth ?? 1;
  const foundries: Record<string, FoundryState> = {};
  if (content.foundry) {
    const foundry = createFoundry({
      id: `foundry-${summary.id}-1`,
      mapId: summary.id,
      position: layout.foundryPosition,
      config: content.foundry,
      depth,
      now
    });
    foundries[foundry.id] = foundry;
  }

  const map: ActiveMapState = {
    id: summary.id,
    seed: summary.seed,
    width: layout.widthTiles,
    height: layout.heightTiles,
    chunks: layout.chunks,
    players: {},
    enemies: {},
    projectiles: {},
    structures: {},
    foundries,
    drops: {},
    connections: []
  };

  // Fortification pocket: plan turret slots on the generated terrain, clear of spawn and exit anchors.
  const keepOut = [layout.spawnPoint, layout.builderPosition, tileToWorld(layout.sourceAnchor), tileToWorld(layout.destinationAnchor)];
  for (const foundry of Object.values(foundries)) {
    foundry.defenseSlots = planFoundryDefenses(map, foundry, defenseCountForDepth(content.foundry!, depth), keepOut);
  }
  return map;
}
// Picks an unused map id for a newly discovered map at the given depth.
function nextDiscoveredMapId(world: PersistentWorld, depth: number): MapId {
  const base = `map-depth-${depth}`;
  let candidate = base;
  for (let index = 2; world.maps[candidate]; index += 1) {
    candidate = `${base}-${index}`;
  }
  return asMapId(candidate);
}

export interface DiscoveredMap {
  summary: PersistentMapSummary;
  map: ActiveMapState;
}

// Generates the map behind an undiscovered exit and records it in the world graph: the exit gets its
// destination, the new map gets a summary and its own undiscovered deeper exit. Mutates `world` and
// `connection` in place; the caller is responsible for persisting the world and new map state.
export function discoverExit(world: PersistentWorld, connection: MapConnection, now = Date.now()): DiscoveredMap {
  if (connection.discovered && connection.destinationMapId) {
    throw new Error(`Connection ${connection.id} is already discovered`);
  }

  const sourceDepth = world.maps[connection.sourceMapId]?.depth ?? 0;
  const depth = sourceDepth + 1;
  const reservedSeed = connection.destinationSeed ?? `${world.seed}/${connection.id}`;
  const archetypeId = connection.destinationArchetypeId ?? chooseArchetypeForDepth(depth, hashToUnit(reservedSeed));
  const { seed, layout } = generateLayoutWithRetries(reservedSeed, archetypeId);
  const mapId = nextDiscoveredMapId(world, depth);
  const deeperExit = createUndiscoveredExit(world.seed, mapId, depth, layout.sourceAnchor);

  connection.discovered = true;
  connection.destinationMapId = mapId;
  connection.destinationAnchor = { ...layout.destinationAnchor };

  const summary: PersistentMapSummary = {
    id: mapId,
    seed,
    status: "discovered",
    connectionIds: [connection.id, deeperExit.id],
    lastActivatedAt: null,
    biomeId: archetypeId,
    depth
  };

  world.maps[mapId] = summary;
  world.graph.connectionIndex[connection.id] = connection;
  world.graph.connectionIndex[deeperExit.id] = deeperExit;
  if (!world.graph.discoveredMapIds.includes(mapId)) {
    world.graph.discoveredMapIds.push(mapId);
  }
  world.updatedAt = now;

  const map = buildDiscoveredMap(summary, layout, now);
  map.connections = [connection, deeperExit];
  return { summary, map };
}

// Hashes a string to a deterministic number in [0, 1) (FNV-1a).
function hashToUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}
