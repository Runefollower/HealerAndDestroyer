import { TERRAIN_CELL_TYPES, type ActiveMapState, type ChunkState, type Vec2 } from "@healer/shared";
import { getMapArchetype, type MapGenerationConfig } from "./mapArchetypes.js";
import { MapGenerationError, validateMapGrid, type MapAnchors, type TileGrid, type TilePoint } from "./mapValidation.js";

export type { TilePoint } from "./mapValidation.js";

// CHUNK_SIZE is the shared terrain chunk width/height in cells.
export const CHUNK_SIZE = 8;

// GENERATED_TILE_SIZE mirrors the world-space pixel size used by terrain/collision code.
export const GENERATED_TILE_SIZE = 32;

export interface GeneratedMapLayout {
  widthTiles: number;
  heightTiles: number;
  chunks: ActiveMapState["chunks"];
  spawnPoint: Vec2;
  builderPosition: Vec2;
  foundryPosition: Vec2;
  enemyPosition: Vec2;
  sourceAnchor: { x: number; y: number };
  destinationAnchor: { x: number; y: number };
  // archetypeId records which generation config produced this layout.
  archetypeId: string;
  // anchors are the tile-space gameplay locations that validation guarantees are open and reachable.
  anchors: MapAnchors;
}

interface TileRoom {
  // x/y are the top-left tile coordinates of the carved room.
  x: number;
  y: number;
  width: number;
  height: number;
  center: TilePoint;
}

// Generates the baseline terrain for a map from its seed and archetype id.
export function generateMapLayout(seed: string, archetypeId: string): GeneratedMapLayout {
  return generateCaveMapLayout(seed, getMapArchetype(archetypeId));
}

// Creates a deterministic cave-like map with guaranteed connected gameplay anchors.
// Throws MapGenerationError if the result breaks the config's validation rules, so a bad
// seed/config combination fails at startup instead of producing an unplayable map.
export function generateCaveMapLayout(seed: string, config: MapGenerationConfig): GeneratedMapLayout {
  const { widthInChunks, heightInChunks } = config;
  const widthTiles = widthInChunks * CHUNK_SIZE;
  const heightTiles = heightInChunks * CHUNK_SIZE;
  const random = createSeededRandom(seed);
  const cells = new Array<number>(widthTiles * heightTiles).fill(TERRAIN_CELL_TYPES.commonRock);

  // Required anchors are intentionally inset so ship collision radii have room around key locations.
  const spawnTile = { x: 3, y: 3 };
  const builderTile = { x: 8, y: 7 };
  const foundryTile = { x: Math.max(12, widthTiles - 12), y: Math.max(10, heightTiles - 10) };
  const sourceAnchor = { x: Math.max(8, widthTiles - 5), y: Math.max(8, heightTiles - 5) };
  const destinationAnchor = { x: 4, y: Math.max(5, heightTiles - 6) };
  const anchors: MapAnchors = {
    spawn: spawnTile,
    builder: builderTile,
    foundry: foundryTile,
    enemy: { x: foundryTile.x - 4, y: foundryTile.y },
    sourceExit: sourceAnchor,
    destinationEntry: destinationAnchor
  };
  const rooms: TileRoom[] = [];

  // Anchor rooms guarantee that progression-critical locations are open and reachable.
  const anchorRoom = config.anchorRoomSize;
  const anchorOffset = Math.floor((anchorRoom - 1) / 2);
  const foundryOffset = Math.floor((config.foundryRoomSize - 1) / 2);
  rooms.push(carveRoom(cells, widthTiles, heightTiles, spawnTile.x - anchorOffset, spawnTile.y - anchorOffset, anchorRoom, anchorRoom));
  rooms.push(carveRoom(cells, widthTiles, heightTiles, builderTile.x - anchorOffset, builderTile.y - anchorOffset, anchorRoom, anchorRoom));
  rooms.push(
    carveRoom(cells, widthTiles, heightTiles, foundryTile.x - foundryOffset, foundryTile.y - foundryOffset, config.foundryRoomSize, config.foundryRoomSize)
  );
  rooms.push(carveRoom(cells, widthTiles, heightTiles, sourceAnchor.x - anchorOffset, sourceAnchor.y - anchorOffset, anchorRoom, anchorRoom));
  rooms.push(
    carveRoom(cells, widthTiles, heightTiles, destinationAnchor.x - anchorOffset, destinationAnchor.y - anchorOffset, anchorRoom, anchorRoom)
  );

  // Random rooms create navigational variety while the later corridor chain keeps the map connected.
  const randomRoomCount = Math.max(config.minRandomRooms, Math.floor((widthInChunks * heightInChunks) / config.randomRoomChunkAreaDivisor));
  for (let index = 0; index < randomRoomCount; index += 1) {
    const roomWidth = config.roomSizeMin + Math.floor(random() * config.roomSizeVariance);
    const roomHeight = config.roomSizeMin + Math.floor(random() * config.roomSizeVariance);
    const roomX = 2 + Math.floor(random() * Math.max(1, widthTiles - roomWidth - 4));
    const roomY = 2 + Math.floor(random() * Math.max(1, heightTiles - roomHeight - 4));
    rooms.push(carveRoom(cells, widthTiles, heightTiles, roomX, roomY, roomWidth, roomHeight));
  }

  // Connect every room center in creation order so the generated layout has one traversable component.
  // The corridor centerlines form a navigation spine that later material placement must keep open.
  const spine = new Set<number>();
  for (let index = 1; index < rooms.length; index += 1) {
    carveCorridor(cells, widthTiles, heightTiles, rooms[index - 1].center, rooms[index].center, config.corridorRadius, spine);
  }
  const keepOpen = expandTileSet(spine, widthTiles, heightTiles, config.validation.minPassageClearanceTiles);

  // Add mineable cover and resource pockets near the carved space without blocking anchors or the spine.
  const protectedTiles = Object.values(anchors);
  addOrePockets(cells, widthTiles, heightTiles, seed, protectedTiles, keepOpen, config);
  addUnstableCrystals(cells, widthTiles, heightTiles, seed, protectedTiles, keepOpen, config);
  topUpMaterials(cells, widthTiles, heightTiles, seed, protectedTiles, keepOpen, config);

  // Validate before handing the map to the runtime so broken layouts fail fast.
  const grid: TileGrid = { widthTiles, heightTiles, cells };
  const issues = validateMapGrid(grid, anchors, config.validation);
  if (issues.length > 0) {
    throw new MapGenerationError(seed, config.archetypeId, issues);
  }

  return {
    widthTiles,
    heightTiles,
    chunks: toChunks(cells, widthInChunks, heightInChunks),
    spawnPoint: tileToWorld(spawnTile),
    builderPosition: tileToWorld(builderTile),
    foundryPosition: tileToWorld(foundryTile),
    enemyPosition: tileToWorld(anchors.enemy),
    sourceAnchor,
    destinationAnchor,
    archetypeId: config.archetypeId,
    anchors
  };
}

// Converts tile coordinates into the world-space position at the center of that tile.
export function tileToWorld(tile: TilePoint): Vec2 {
  return {
    x: tile.x * GENERATED_TILE_SIZE + GENERATED_TILE_SIZE / 2,
    y: tile.y * GENERATED_TILE_SIZE + GENERATED_TILE_SIZE / 2
  };
}

// Carves a rectangular room into the solid cell grid and returns its clipped dimensions.
function carveRoom(cells: number[], widthTiles: number, heightTiles: number, x: number, y: number, width: number, height: number): TileRoom {
  const clippedX = clamp(Math.floor(x), 1, widthTiles - 2);
  const clippedY = clamp(Math.floor(y), 1, heightTiles - 2);
  const clippedWidth = Math.max(1, Math.min(Math.floor(width), widthTiles - clippedX - 1));
  const clippedHeight = Math.max(1, Math.min(Math.floor(height), heightTiles - clippedY - 1));

  for (let tileY = clippedY; tileY < clippedY + clippedHeight; tileY += 1) {
    for (let tileX = clippedX; tileX < clippedX + clippedWidth; tileX += 1) {
      cells[tileY * widthTiles + tileX] = TERRAIN_CELL_TYPES.empty;
    }
  }

  return {
    x: clippedX,
    y: clippedY,
    width: clippedWidth,
    height: clippedHeight,
    center: {
      x: clippedX + Math.floor(clippedWidth / 2),
      y: clippedY + Math.floor(clippedHeight / 2)
    }
  };
}

// Carves an L-shaped corridor between room centers with the configured radius for ship movement.
// Every centerline tile is recorded in `spine` as a flat tile index.
function carveCorridor(
  cells: number[],
  widthTiles: number,
  heightTiles: number,
  from: TilePoint,
  to: TilePoint,
  radius: number,
  spine: Set<number>
): void {
  carveLine(cells, widthTiles, heightTiles, from, { x: to.x, y: from.y }, radius, spine);
  carveLine(cells, widthTiles, heightTiles, { x: to.x, y: from.y }, to, radius, spine);
}

// Carves a line segment of the given tile radius through the terrain grid.
function carveLine(
  cells: number[],
  widthTiles: number,
  heightTiles: number,
  from: TilePoint,
  to: TilePoint,
  radius: number,
  spine: Set<number>
): void {
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let currentX = from.x;
  let currentY = from.y;

  while (currentX !== to.x || currentY !== to.y) {
    carveDisk(cells, widthTiles, heightTiles, currentX, currentY, radius);
    spine.add(currentY * widthTiles + currentX);
    if (currentX !== to.x) {
      currentX += stepX;
    }
    if (currentY !== to.y) {
      currentY += stepY;
    }
  }
  carveDisk(cells, widthTiles, heightTiles, to.x, to.y, radius);
  spine.add(to.y * widthTiles + to.x);
}

// Grows a set of flat tile indexes by a square radius so placement can keep a corridor band open.
function expandTileSet(tiles: Set<number>, widthTiles: number, heightTiles: number, radius: number): Set<number> {
  const expanded = new Set<number>();
  for (const index of tiles) {
    const centerX = index % widthTiles;
    const centerY = Math.floor(index / widthTiles);
    for (let tileY = Math.max(0, centerY - radius); tileY <= Math.min(heightTiles - 1, centerY + radius); tileY += 1) {
      for (let tileX = Math.max(0, centerX - radius); tileX <= Math.min(widthTiles - 1, centerX + radius); tileX += 1) {
        expanded.add(tileY * widthTiles + tileX);
      }
    }
  }
  return expanded;
}

// Clears a circular-ish patch of cells around a tile point.
function carveDisk(cells: number[], widthTiles: number, heightTiles: number, centerX: number, centerY: number, radius: number): void {
  for (let tileY = centerY - radius; tileY <= centerY + radius; tileY += 1) {
    for (let tileX = centerX - radius; tileX <= centerX + radius; tileX += 1) {
      if (tileX <= 0 || tileY <= 0 || tileX >= widthTiles - 1 || tileY >= heightTiles - 1) {
        continue;
      }
      if (Math.hypot(tileX - centerX, tileY - centerY) <= radius + 0.35) {
        cells[tileY * widthTiles + tileX] = TERRAIN_CELL_TYPES.empty;
      }
    }
  }
}

// Adds deterministic mineable resource pockets and cover near open space while keeping anchors clear.
// Pockets may sit on carved floor as cover, but never on the `keepOpen` corridor band, which
// previously let ore choke corridors shut.
function addOrePockets(
  cells: number[],
  widthTiles: number,
  heightTiles: number,
  seed: string,
  protectedTiles: TilePoint[],
  keepOpen: Set<number>,
  config: MapGenerationConfig
): void {
  const random = createSeededRandom(`${seed}:ore`);
  const protectedKeys = new Set(protectedTiles.flatMap((tile) => nearbyKeys(tile, 4)));
  const pocketCount = Math.floor((widthTiles * heightTiles) / config.orePocketTileArea);

  for (let index = 0; index < pocketCount; index += 1) {
    const centerX = 2 + Math.floor(random() * Math.max(1, widthTiles - 4));
    const centerY = 2 + Math.floor(random() * Math.max(1, heightTiles - 4));
    const material = chooseOrePocketMaterial(random(), config);

    for (let tileY = centerY - 1; tileY <= centerY + 1; tileY += 1) {
      for (let tileX = centerX - 1; tileX <= centerX + 1; tileX += 1) {
        if (tileX <= 0 || tileY <= 0 || tileX >= widthTiles - 1 || tileY >= heightTiles - 1) {
          continue;
        }
        if (protectedKeys.has(createTileKey(tileX, tileY))) {
          continue;
        }
        const placed = hasOpenNeighbor(cells, widthTiles, heightTiles, tileX, tileY) && random() < config.orePocketPlacementChance;
        if (placed && !keepOpen.has(tileY * widthTiles + tileX)) {
          cells[tileY * widthTiles + tileX] = material;
        }
      }
    }
  }
}

// Chooses the material for a small wall pocket using simple first-pass resource weights.
function chooseOrePocketMaterial(randomValue: number, config: MapGenerationConfig): number {
  if (randomValue < config.plasmaChance) {
    return TERRAIN_CELL_TYPES.plasmaCrystal;
  }
  if (randomValue < config.plasmaChance + config.ancientStoneChance) {
    return TERRAIN_CELL_TYPES.ancientStone;
  }
  return TERRAIN_CELL_TYPES.ferriteOre;
}

// Places rare unstable crystal cells one at a time so they feel dangerous and discoverable.
function addUnstableCrystals(
  cells: number[],
  widthTiles: number,
  heightTiles: number,
  seed: string,
  protectedTiles: TilePoint[],
  keepOpen: Set<number>,
  config: MapGenerationConfig
): void {
  const random = createSeededRandom(`${seed}:unstable-crystal`);
  const protectedKeys = new Set(protectedTiles.flatMap((tile) => nearbyKeys(tile, config.validation.volatileSafeRadiusTiles)));
  const crystalCount = Math.max(1, Math.floor((widthTiles * heightTiles) / config.unstableCrystalTileArea));
  let placed = 0;
  let attempts = 0;

  while (placed < crystalCount && attempts < crystalCount * 80) {
    attempts += 1;
    const tileX = 2 + Math.floor(random() * Math.max(1, widthTiles - 4));
    const tileY = 2 + Math.floor(random() * Math.max(1, heightTiles - 4));
    if (protectedKeys.has(createTileKey(tileX, tileY))) {
      continue;
    }
    if (keepOpen.has(tileY * widthTiles + tileX) || !hasOpenNeighbor(cells, widthTiles, heightTiles, tileX, tileY)) {
      continue;
    }
    if (hasNearbyUnstableCrystal(cells, widthTiles, heightTiles, tileX, tileY)) {
      continue;
    }
    cells[tileY * widthTiles + tileX] = TERRAIN_CELL_TYPES.unstableCrystal;
    placed += 1;
  }
}

// Guarantees each archetype's minimum material counts by converting extra exposed common-rock
// wall cells when random pocket placement came up short. Uses its own seeded stream so results
// stay deterministic per seed.
function topUpMaterials(
  cells: number[],
  widthTiles: number,
  heightTiles: number,
  seed: string,
  protectedTiles: TilePoint[],
  keepOpen: Set<number>,
  config: MapGenerationConfig
): void {
  const random = createSeededRandom(`${seed}:top-up`);
  const protectedKeys = new Set(protectedTiles.flatMap((tile) => nearbyKeys(tile, config.validation.volatileSafeRadiusTiles)));

  // Count what random placement produced so far.
  const counts = new Map<number, number>();
  for (const cell of cells) {
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }

  // Candidate cells are exposed common rock that is away from anchors and off the corridor band.
  const candidates: number[] = [];
  for (let tileY = 1; tileY < heightTiles - 1; tileY += 1) {
    for (let tileX = 1; tileX < widthTiles - 1; tileX += 1) {
      const index = tileY * widthTiles + tileX;
      if (
        cells[index] === TERRAIN_CELL_TYPES.commonRock &&
        !keepOpen.has(index) &&
        !protectedKeys.has(createTileKey(tileX, tileY)) &&
        hasOpenNeighbor(cells, widthTiles, heightTiles, tileX, tileY)
      ) {
        candidates.push(index);
      }
    }
  }

  // Deterministically shuffle candidates, then convert as many as each shortfall needs.
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  let nextCandidate = 0;
  for (const [cellTypeText, minimum] of Object.entries(config.validation.minMaterialCounts)) {
    const cellType = Number(cellTypeText);
    let shortfall = (minimum ?? 0) - (counts.get(cellType) ?? 0);
    while (shortfall > 0 && nextCandidate < candidates.length) {
      const index = candidates[nextCandidate];
      nextCandidate += 1;
      const tileX = index % widthTiles;
      const tileY = Math.floor(index / widthTiles);
      if (cellType === TERRAIN_CELL_TYPES.unstableCrystal && hasNearbyUnstableCrystal(cells, widthTiles, heightTiles, tileX, tileY)) {
        continue;
      }
      cells[index] = cellType;
      shortfall -= 1;
    }
  }
}

// Prevents volatile crystal clusters; the first pass wants isolated explosive surprises.
function hasNearbyUnstableCrystal(cells: number[], widthTiles: number, heightTiles: number, tileX: number, tileY: number): boolean {
  for (let neighborY = tileY - 1; neighborY <= tileY + 1; neighborY += 1) {
    for (let neighborX = tileX - 1; neighborX <= tileX + 1; neighborX += 1) {
      if (neighborX < 0 || neighborY < 0 || neighborX >= widthTiles || neighborY >= heightTiles) {
        continue;
      }
      if (cells[neighborY * widthTiles + neighborX] === TERRAIN_CELL_TYPES.unstableCrystal) {
        return true;
      }
    }
  }
  return false;
}

// Returns keys around a protected anchor so ore placement does not crowd required locations.
function nearbyKeys(tile: TilePoint, radius: number): string[] {
  const keys: string[] = [];
  for (let tileY = tile.y - radius; tileY <= tile.y + radius; tileY += 1) {
    for (let tileX = tile.x - radius; tileX <= tile.x + radius; tileX += 1) {
      keys.push(createTileKey(tileX, tileY));
    }
  }
  return keys;
}

// Checks whether a solid candidate is next to carved floor so it can be mined from reachable space.
function hasOpenNeighbor(cells: number[], widthTiles: number, heightTiles: number, tileX: number, tileY: number): boolean {
  const neighborOffsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  return neighborOffsets.some((offset) => {
    const neighborX = tileX + offset.x;
    const neighborY = tileY + offset.y;
    return (
      neighborX >= 0 &&
      neighborY >= 0 &&
      neighborX < widthTiles &&
      neighborY < heightTiles &&
      cells[neighborY * widthTiles + neighborX] === TERRAIN_CELL_TYPES.empty
    );
  });
}

// Converts a layout's chunk dictionary back into a flat row-major grid for validation and tests.
export function layoutToGrid(layout: GeneratedMapLayout): TileGrid {
  const cells: number[] = [];
  for (let tileY = 0; tileY < layout.heightTiles; tileY += 1) {
    for (let tileX = 0; tileX < layout.widthTiles; tileX += 1) {
      const chunk = layout.chunks[`${Math.floor(tileX / CHUNK_SIZE)},${Math.floor(tileY / CHUNK_SIZE)}`];
      cells.push(chunk?.cells[(tileY % CHUNK_SIZE) * CHUNK_SIZE + (tileX % CHUNK_SIZE)] ?? TERRAIN_CELL_TYPES.commonRock);
    }
  }
  return { widthTiles: layout.widthTiles, heightTiles: layout.heightTiles, cells };
}

// Converts the flat tile cell grid into the chunk dictionary used by runtime maps.
function toChunks(cells: number[], widthInChunks: number, heightInChunks: number): ActiveMapState["chunks"] {
  const chunks: ActiveMapState["chunks"] = {};
  const widthTiles = widthInChunks * CHUNK_SIZE;

  for (let chunkY = 0; chunkY < heightInChunks; chunkY += 1) {
    for (let chunkX = 0; chunkX < widthInChunks; chunkX += 1) {
      const chunkCells: number[] = [];
      for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
        for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
          const tileX = chunkX * CHUNK_SIZE + localX;
          const tileY = chunkY * CHUNK_SIZE + localY;
          chunkCells.push(cells[tileY * widthTiles + tileX] ?? TERRAIN_CELL_TYPES.commonRock);
        }
      }

      const chunk: ChunkState = {
        chunkX,
        chunkY,
        cells: chunkCells,
        dirty: false,
        active: true
      };
      chunks[`${chunkX},${chunkY}`] = chunk;
    }
  }

  return chunks;
}

// Creates a deterministic pseudo-random number generator from a string seed.
function createSeededRandom(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Hashes arbitrary seed text into an unsigned integer for seeded generation.
function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Creates the map/set key used for protected ore-placement coordinates.
function createTileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

// Clamps a number into an inclusive min/max range.
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
