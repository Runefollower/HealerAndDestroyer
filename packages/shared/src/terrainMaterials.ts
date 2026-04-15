import type { ResourceMap } from "./resources.js";
import type { CellType } from "./world.js";

// TERRAIN_CELL_TYPES names the persisted tile values used by generated chunks.
// 0 is always open space. 1-5 are solid materials with distinct drops and behavior.
export const TERRAIN_CELL_TYPES = {
  empty: 0,
  commonRock: 1,
  ferriteOre: 2,
  plasmaCrystal: 3,
  ancientStone: 4,
  unstableCrystal: 5
} as const satisfies Record<string, CellType>;

export type TerrainMaterialId = keyof typeof TERRAIN_CELL_TYPES;

export interface TerrainMaterialDefinition {
  // id is the human-readable key used by code and future content tooling.
  id: TerrainMaterialId;
  // cellType is the persisted terrain value stored in chunk cell arrays.
  cellType: CellType;
  // name is suitable for debugging, tooling, and future HUD copy.
  name: string;
  // solid controls collision, vision blocking, and mining eligibility.
  solid: boolean;
  // breakDamage is the minimum terrain damage required to clear a solid cell.
  breakDamage: number;
  // debrisResources are spawned when this material is destroyed.
  debrisResources: ResourceMap;
  // explosionRadiusTiles makes volatile blocks clear nearby solid terrain when destroyed.
  explosionRadiusTiles?: number;
  // renderAlpha and tint values keep client rendering data close to the material rules.
  renderAlpha: number;
  tint?: number;
  rememberedTint: number;
  burstTint: number;
}

// terrainMaterialDefinitions is the source of truth for persisted terrain ids and their behavior.
// Keep this list readable: designers should be able to understand what each block is,
// how hard it is to break, what it drops, and whether it has special behavior.
export const terrainMaterialDefinitions: TerrainMaterialDefinition[] = [
  {
    id: "empty",
    cellType: TERRAIN_CELL_TYPES.empty,
    name: "Open Space",
    solid: false,
    breakDamage: 0,
    debrisResources: {},
    renderAlpha: 0,
    rememberedTint: 0x000000,
    burstTint: 0x000000
  },
  {
    id: "commonRock",
    cellType: TERRAIN_CELL_TYPES.commonRock,
    name: "Common Rock",
    solid: true,
    breakDamage: 18,
    debrisResources: { rock: 2 },
    renderAlpha: 0.99,
    rememberedTint: 0x7f8a95,
    burstTint: 0xb9a48a
  },
  {
    id: "ferriteOre",
    cellType: TERRAIN_CELL_TYPES.ferriteOre,
    name: "Ferrite Ore",
    solid: true,
    breakDamage: 24,
    debrisResources: { ferrite: 2 },
    renderAlpha: 0.95,
    tint: 0xb5c0ce,
    rememberedTint: 0x8b96a4,
    burstTint: 0xbfc9d8
  },
  {
    id: "plasmaCrystal",
    cellType: TERRAIN_CELL_TYPES.plasmaCrystal,
    name: "Plasma Crystal Vein",
    solid: true,
    breakDamage: 30,
    debrisResources: { "plasma-crystal": 1 },
    renderAlpha: 0.95,
    tint: 0xc4d7e6,
    rememberedTint: 0x8fa3b2,
    burstTint: 0x9ad7ff
  },
  {
    id: "ancientStone",
    cellType: TERRAIN_CELL_TYPES.ancientStone,
    name: "Ancient Stone",
    solid: true,
    breakDamage: 36,
    debrisResources: { stone: 2 },
    renderAlpha: 0.95,
    tint: 0x9fb7b1,
    rememberedTint: 0x73827f,
    burstTint: 0xb8cac5
  },
  {
    id: "unstableCrystal",
    cellType: TERRAIN_CELL_TYPES.unstableCrystal,
    name: "Unstable Crystal",
    solid: true,
    breakDamage: 12,
    debrisResources: { "plasma-crystal": 2 },
    explosionRadiusTiles: 1,
    renderAlpha: 0.95,
    tint: 0x8ff6ff,
    rememberedTint: 0x689aa3,
    burstTint: 0x72f5ff
  }
];

const terrainMaterialsByCellType = new Map<number, TerrainMaterialDefinition>(
  terrainMaterialDefinitions.map((definition) => [definition.cellType, definition])
);

// fallbackTerrainMaterial preserves old/future unknown solid cells as mineable terrain.
const fallbackTerrainMaterial = terrainMaterialsByCellType.get(TERRAIN_CELL_TYPES.commonRock)!;

// Returns material data for a persisted cell, with a solid fallback for unknown future values.
export function getTerrainMaterialDefinition(cellType: number): TerrainMaterialDefinition {
  return terrainMaterialsByCellType.get(cellType) ?? fallbackTerrainMaterial;
}

// Distinguishes carved space from mineable/collidable terrain.
export function isEmptyTerrainCell(cellType: number): boolean {
  return getTerrainMaterialDefinition(cellType).solid === false;
}

// Centralizes the solid-terrain check used by movement, vision, rendering, and mining.
export function isSolidTerrainCell(cellType: number): boolean {
  return getTerrainMaterialDefinition(cellType).solid;
}
