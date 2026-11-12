import { TERRAIN_CELL_TYPES } from "@healer/shared";

// MapArchetypeId names a reusable generation recipe. Persistent map summaries store it as `biomeId`
// so a map can be regenerated from just its seed and archetype.
export type MapArchetypeId = "starter-cavern" | "deep-cavern" | "foundry-arena" | "resource-cavern" | "tunnel-network";

export interface MapValidationRules {
  // minPassageClearanceTiles is how many tiles of open space must surround every tile on the
  // spawn-to-anchor path (1 means a 3x3 open neighborhood, enough for a 14px ship radius on 32px tiles).
  minPassageClearanceTiles: number;
  // anchorClearanceTiles is the open radius required around each gameplay anchor.
  anchorClearanceTiles: number;
  // minAnchorSpacingTiles keeps distinct anchors (builder, foundry, exits) from stacking on each other.
  minAnchorSpacingTiles: number;
  // volatileSafeRadiusTiles keeps unstable crystals from detonating next to anchors.
  volatileSafeRadiusTiles: number;
  // minMaterialCounts is the guaranteed number of cells of each material. The generator tops up
  // wall cells to meet it, and validation rejects any map that still falls short.
  minMaterialCounts: Partial<Record<number, number>>;
}

export interface MapGenerationConfig {
  archetypeId: MapArchetypeId;
  // label is a short designer-facing name for logs and tooling.
  label: string;
  // widthInChunks/heightInChunks give the map size in 8x8 tile chunks.
  widthInChunks: number;
  heightInChunks: number;
  // anchorRoomSize/foundryRoomSize are the square room sizes (tiles) carved around required anchors.
  anchorRoomSize: number;
  foundryRoomSize: number;
  // Random rooms: count = max(minRandomRooms, chunkArea / randomRoomChunkAreaDivisor);
  // each side is roomSizeMin + [0, roomSizeVariance) tiles.
  minRandomRooms: number;
  randomRoomChunkAreaDivisor: number;
  roomSizeMin: number;
  roomSizeVariance: number;
  // corridorRadius is the carve radius (tiles) of the corridors that chain rooms together.
  corridorRadius: number;
  // Ore pockets: one pocket per orePocketTileArea tiles; material weights and per-cell fill chance.
  orePocketTileArea: number;
  plasmaChance: number;
  ancientStoneChance: number;
  orePocketPlacementChance: number;
  // unstableCrystalTileArea is the map area (tiles) per single volatile crystal.
  unstableCrystalTileArea: number;
  validation: MapValidationRules;
}

// defaultValidationRules are shared by every archetype unless an archetype overrides a field.
const defaultValidationRules: MapValidationRules = {
  minPassageClearanceTiles: 1,
  anchorClearanceTiles: 1,
  minAnchorSpacingTiles: 4,
  volatileSafeRadiusTiles: 5,
  minMaterialCounts: {
    [TERRAIN_CELL_TYPES.ferriteOre]: 30,
    [TERRAIN_CELL_TYPES.plasmaCrystal]: 8,
    [TERRAIN_CELL_TYPES.ancientStone]: 4,
    [TERRAIN_CELL_TYPES.unstableCrystal]: 1
  }
};

// baseCaveConfig holds the original prototype tuning; the starter and deep caves keep it so the
// existing root and deeper maps stay recognisable.
const baseCaveConfig = {
  anchorRoomSize: 8,
  foundryRoomSize: 11,
  minRandomRooms: 10,
  randomRoomChunkAreaDivisor: 4,
  roomSizeMin: 5,
  roomSizeVariance: 8,
  corridorRadius: 2,
  orePocketTileArea: 110,
  plasmaChance: 0.18,
  ancientStoneChance: 0.1,
  orePocketPlacementChance: 0.65,
  unstableCrystalTileArea: 900,
  validation: defaultValidationRules
};

// mapArchetypes is the generation config table. Add new map types here rather than in generator code.
export const mapArchetypes: Record<MapArchetypeId, MapGenerationConfig> = {
  // Root map: the original cave tuning, sized for the first builder/foundry loop.
  "starter-cavern": {
    ...baseCaveConfig,
    archetypeId: "starter-cavern",
    label: "Starter cavern",
    widthInChunks: 12,
    heightInChunks: 9
  },
  // Deeper prototype map: same recipe as the starter cave on a slightly smaller footprint.
  "deep-cavern": {
    ...baseCaveConfig,
    archetypeId: "deep-cavern",
    label: "Deep cavern",
    widthInChunks: 10,
    heightInChunks: 8
  },
  // Foundry arena: fewer, larger rooms and a big foundry chamber for fortification encounters.
  "foundry-arena": {
    ...baseCaveConfig,
    archetypeId: "foundry-arena",
    label: "Foundry arena",
    widthInChunks: 10,
    heightInChunks: 8,
    foundryRoomSize: 17,
    minRandomRooms: 6,
    randomRoomChunkAreaDivisor: 10,
    roomSizeMin: 8,
    roomSizeVariance: 8,
    orePocketTileArea: 160,
    plasmaChance: 0.12,
    validation: {
      ...defaultValidationRules,
      anchorClearanceTiles: 2,
      minMaterialCounts: {
        [TERRAIN_CELL_TYPES.ferriteOre]: 15,
        [TERRAIN_CELL_TYPES.plasmaCrystal]: 3,
        [TERRAIN_CELL_TYPES.unstableCrystal]: 1
      }
    }
  },
  // Resource cavern: dense ore walls and more plasma, aimed at mining runs.
  "resource-cavern": {
    ...baseCaveConfig,
    archetypeId: "resource-cavern",
    label: "Resource cavern",
    widthInChunks: 10,
    heightInChunks: 8,
    orePocketTileArea: 55,
    plasmaChance: 0.3,
    ancientStoneChance: 0.12,
    orePocketPlacementChance: 0.75,
    unstableCrystalTileArea: 600,
    validation: {
      ...defaultValidationRules,
      minMaterialCounts: {
        [TERRAIN_CELL_TYPES.ferriteOre]: 80,
        [TERRAIN_CELL_TYPES.plasmaCrystal]: 40,
        [TERRAIN_CELL_TYPES.ancientStone]: 12,
        [TERRAIN_CELL_TYPES.unstableCrystal]: 4
      }
    }
  },
  // Tunnel network: many small rooms densely chained by corridors.
  "tunnel-network": {
    ...baseCaveConfig,
    archetypeId: "tunnel-network",
    label: "Tunnel network",
    widthInChunks: 12,
    heightInChunks: 9,
    minRandomRooms: 18,
    randomRoomChunkAreaDivisor: 3,
    roomSizeMin: 4,
    roomSizeVariance: 4,
    orePocketTileArea: 130
  }
};

// Returns the config for an archetype id, failing loudly on unknown ids so bad map data surfaces early.
export function getMapArchetype(archetypeId: string): MapGenerationConfig {
  const config = mapArchetypes[archetypeId as MapArchetypeId];
  if (!config) {
    throw new Error(`Unknown map archetype "${archetypeId}"`);
  }
  return config;
}

export interface PrototypeMapDefinition {
  // mapId/seed/archetypeId are everything needed to regenerate the map's baseline terrain.
  mapId: string;
  seed: string;
  archetypeId: MapArchetypeId;
}

// prototypeMaps defines the fixed root and deeper maps used by the current vertical slice.
export const prototypeMaps = {
  root: { mapId: "map-root", seed: "root-seed", archetypeId: "starter-cavern" },
  deeper: { mapId: "map-depth-1", seed: "depth-seed", archetypeId: "deep-cavern" }
} as const satisfies Record<string, PrototypeMapDefinition>;
