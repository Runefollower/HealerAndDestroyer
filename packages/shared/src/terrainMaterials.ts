import type { ResourceMap } from "./resources.js";
import type { CellType } from "./world.js";

export const TERRAIN_CELL_TYPES = {
  empty: 0,
  ferriteRock: 1,
  plasmaRock: 2,
  denseOre: 3,
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
  // renderAlpha and tint values keep client rendering data close to the material rules.
  renderAlpha: number;
  tint?: number;
  rememberedTint: number;
  burstTint: number;
}

// terrainMaterialDefinitions is the source of truth for persisted terrain ids and their behavior.
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
    id: "ferriteRock",
    cellType: TERRAIN_CELL_TYPES.ferriteRock,
    name: "Ferrite Rock",
    solid: true,
    breakDamage: 20,
    debrisResources: { ferrite: 2 },
    renderAlpha: 0.99,
    rememberedTint: 0x7f8a95,
    burstTint: 0xb9a48a
  },
  {
    id: "plasmaRock",
    cellType: TERRAIN_CELL_TYPES.plasmaRock,
    name: "Plasma-Bearing Rock",
    solid: true,
    breakDamage: 30,
    debrisResources: { ferrite: 1, "plasma-crystal": 1 },
    renderAlpha: 0.95,
    tint: 0xc4d7e6,
    rememberedTint: 0x8fa3b2,
    burstTint: 0x9ad7ff
  },
  {
    id: "denseOre",
    cellType: TERRAIN_CELL_TYPES.denseOre,
    name: "Dense Ore",
    solid: true,
    breakDamage: 36,
    debrisResources: { ferrite: 1, "plasma-crystal": 1 },
    renderAlpha: 0.95,
    tint: 0xb7ccd8,
    rememberedTint: 0x7f8a95,
    burstTint: 0xc6d8e6
  },
  {
    id: "ancientStone",
    cellType: TERRAIN_CELL_TYPES.ancientStone,
    name: "Ancient Stone",
    solid: true,
    breakDamage: 36,
    debrisResources: { ferrite: 1, "plasma-crystal": 1 },
    renderAlpha: 0.95,
    tint: 0xb7ccd8,
    rememberedTint: 0x7f8a95,
    burstTint: 0xc6d8e6
  },
  {
    id: "unstableCrystal",
    cellType: TERRAIN_CELL_TYPES.unstableCrystal,
    name: "Unstable Crystal",
    solid: true,
    breakDamage: 36,
    debrisResources: { ferrite: 1, "plasma-crystal": 1 },
    renderAlpha: 0.95,
    tint: 0xb7ccd8,
    rememberedTint: 0x7f8a95,
    burstTint: 0xc6d8e6
  }
];

const terrainMaterialsByCellType = new Map<number, TerrainMaterialDefinition>(
  terrainMaterialDefinitions.map((definition) => [definition.cellType, definition])
);

// fallbackTerrainMaterial preserves old/future unknown solid cells as mineable terrain.
const fallbackTerrainMaterial = terrainMaterialsByCellType.get(TERRAIN_CELL_TYPES.denseOre)!;

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
