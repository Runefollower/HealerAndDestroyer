import { describe, expect, it } from "vitest";
import {
  TERRAIN_CELL_TYPES,
  getTerrainMaterialDefinition,
  isEmptyTerrainCell,
  isSolidTerrainCell,
  terrainMaterialDefinitions
} from "./terrainMaterials.js";

describe("terrain material definitions", () => {
  it("defines the active terrain cells from one shared registry", () => {
    expect(terrainMaterialDefinitions.map((definition) => definition.cellType)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(isEmptyTerrainCell(TERRAIN_CELL_TYPES.empty)).toBe(true);
    expect(isSolidTerrainCell(TERRAIN_CELL_TYPES.commonRock)).toBe(true);
    expect(isSolidTerrainCell(TERRAIN_CELL_TYPES.ferriteOre)).toBe(true);
  });

  it("stores terrain breakage and debris rules beside each material id", () => {
    expect(getTerrainMaterialDefinition(TERRAIN_CELL_TYPES.commonRock)).toMatchObject({
      breakDamage: 18,
      debrisResources: { rock: 2 }
    });
    expect(getTerrainMaterialDefinition(TERRAIN_CELL_TYPES.plasmaCrystal)).toMatchObject({
      breakDamage: 30,
      debrisResources: { "plasma-crystal": 1 }
    });
  });

  it("keeps rare special materials readable in data", () => {
    expect(getTerrainMaterialDefinition(TERRAIN_CELL_TYPES.ancientStone)).toMatchObject({
      name: "Ancient Stone",
      debrisResources: { stone: 2 }
    });
    expect(getTerrainMaterialDefinition(TERRAIN_CELL_TYPES.unstableCrystal)).toMatchObject({
      name: "Unstable Crystal",
      explosionRadiusTiles: 1,
      debrisResources: { "plasma-crystal": 2 }
    });
  });
});
