import { TERRAIN_CELL_TYPES, type ActiveMapState, type ChunkState, type Vec2 } from "@healer/shared";

// CHUNK_SIZE is the shared terrain chunk width/height in cells.
export const CHUNK_SIZE = 8;

// GENERATED_TILE_SIZE mirrors the world-space pixel size used by terrain/collision code.
export const GENERATED_TILE_SIZE = 32;

// orePocketPlasmaChance controls how often generated mineable pockets use the richer plasma material.
const orePocketPlasmaChance = 0.28;
// orePocketPlacementChance controls how dense each generated pocket is around its chosen center.
const orePocketPlacementChance = 0.65;

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
}

export interface TilePoint {
  // x/y are tile coordinates within the generated map grid.
  x: number;
  y: number;
}

interface TileRoom {
  // x/y are the top-left tile coordinates of the carved room.
  x: number;
  y: number;
  width: number;
  height: number;
  center: TilePoint;
}

// Creates a deterministic cave-like map with guaranteed connected gameplay anchors.
export function generateCaveMapLayout(seed: string, widthInChunks: number, heightInChunks: number): GeneratedMapLayout {
  const widthTiles = widthInChunks * CHUNK_SIZE;
  const heightTiles = heightInChunks * CHUNK_SIZE;
  const random = createSeededRandom(seed);
  const cells = new Array<number>(widthTiles * heightTiles).fill(TERRAIN_CELL_TYPES.ferriteRock);

  // Required anchors are intentionally inset so ship collision radii have room around key locations.
  const spawnTile = { x: 3, y: 3 };
  const builderTile = { x: 8, y: 7 };
  const foundryTile = { x: Math.max(12, widthTiles - 12), y: Math.max(10, heightTiles - 10) };
  const sourceAnchor = { x: Math.max(8, widthTiles - 5), y: Math.max(8, heightTiles - 5) };
  const destinationAnchor = { x: 4, y: Math.max(5, heightTiles - 6) };
  const rooms: TileRoom[] = [];

  // Anchor rooms guarantee that progression-critical locations are open and reachable.
  rooms.push(carveRoom(cells, widthTiles, heightTiles, spawnTile.x - 3, spawnTile.y - 3, 8, 8));
  rooms.push(carveRoom(cells, widthTiles, heightTiles, builderTile.x - 3, builderTile.y - 3, 8, 8));
  rooms.push(carveRoom(cells, widthTiles, heightTiles, foundryTile.x - 5, foundryTile.y - 5, 11, 11));
  rooms.push(carveRoom(cells, widthTiles, heightTiles, sourceAnchor.x - 3, sourceAnchor.y - 3, 8, 8));
  rooms.push(carveRoom(cells, widthTiles, heightTiles, destinationAnchor.x - 3, destinationAnchor.y - 3, 8, 8));

  // Random rooms create navigational variety while the later corridor chain keeps the map connected.
  const randomRoomCount = Math.max(10, Math.floor((widthInChunks * heightInChunks) / 4));
  for (let index = 0; index < randomRoomCount; index += 1) {
    const roomWidth = 5 + Math.floor(random() * 8);
    const roomHeight = 5 + Math.floor(random() * 8);
    const roomX = 2 + Math.floor(random() * Math.max(1, widthTiles - roomWidth - 4));
    const roomY = 2 + Math.floor(random() * Math.max(1, heightTiles - roomHeight - 4));
    rooms.push(carveRoom(cells, widthTiles, heightTiles, roomX, roomY, roomWidth, roomHeight));
  }

  // Connect every room center in creation order so the generated layout has one traversable component.
  for (let index = 1; index < rooms.length; index += 1) {
    carveCorridor(cells, widthTiles, heightTiles, rooms[index - 1].center, rooms[index].center);
  }

  // Add mineable cover and resource pockets near the carved space without blocking required anchors.
  addOrePockets(cells, widthTiles, heightTiles, seed, [spawnTile, builderTile, foundryTile, sourceAnchor, destinationAnchor]);

  return {
    widthTiles,
    heightTiles,
    chunks: toChunks(cells, widthInChunks, heightInChunks),
    spawnPoint: tileToWorld(spawnTile),
    builderPosition: tileToWorld(builderTile),
    foundryPosition: tileToWorld(foundryTile),
    enemyPosition: tileToWorld({ x: foundryTile.x - 4, y: foundryTile.y }),
    sourceAnchor,
    destinationAnchor
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

// Carves an L-shaped corridor between room centers with a small width for ship movement.
function carveCorridor(cells: number[], widthTiles: number, heightTiles: number, from: TilePoint, to: TilePoint): void {
  carveLine(cells, widthTiles, heightTiles, from, { x: to.x, y: from.y });
  carveLine(cells, widthTiles, heightTiles, { x: to.x, y: from.y }, to);
}

// Carves a two-tile-radius line segment through the terrain grid.
function carveLine(cells: number[], widthTiles: number, heightTiles: number, from: TilePoint, to: TilePoint): void {
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let currentX = from.x;
  let currentY = from.y;

  while (currentX !== to.x || currentY !== to.y) {
    carveDisk(cells, widthTiles, heightTiles, currentX, currentY, 2);
    if (currentX !== to.x) {
      currentX += stepX;
    }
    if (currentY !== to.y) {
      currentY += stepY;
    }
  }
  carveDisk(cells, widthTiles, heightTiles, to.x, to.y, 2);
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

// Adds deterministic mineable resource pockets along walls while keeping important anchors clear.
function addOrePockets(cells: number[], widthTiles: number, heightTiles: number, seed: string, protectedTiles: TilePoint[]): void {
  const random = createSeededRandom(`${seed}:ore`);
  const protectedKeys = new Set(protectedTiles.flatMap((tile) => nearbyKeys(tile, 4)));
  const pocketCount = Math.floor((widthTiles * heightTiles) / 110);

  for (let index = 0; index < pocketCount; index += 1) {
    const centerX = 2 + Math.floor(random() * Math.max(1, widthTiles - 4));
    const centerY = 2 + Math.floor(random() * Math.max(1, heightTiles - 4));
    const material = random() < orePocketPlasmaChance ? TERRAIN_CELL_TYPES.plasmaRock : TERRAIN_CELL_TYPES.ferriteRock;

    for (let tileY = centerY - 1; tileY <= centerY + 1; tileY += 1) {
      for (let tileX = centerX - 1; tileX <= centerX + 1; tileX += 1) {
        if (tileX <= 0 || tileY <= 0 || tileX >= widthTiles - 1 || tileY >= heightTiles - 1) {
          continue;
        }
        if (protectedKeys.has(createTileKey(tileX, tileY))) {
          continue;
        }
        if (hasOpenNeighbor(cells, widthTiles, heightTiles, tileX, tileY) && random() < orePocketPlacementChance) {
          cells[tileY * widthTiles + tileX] = material;
        }
      }
    }
  }
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
          chunkCells.push(cells[tileY * widthTiles + tileX] ?? TERRAIN_CELL_TYPES.ferriteRock);
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
