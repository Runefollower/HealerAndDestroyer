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
    expect(isSolidTerrainCell(TERRAIN_CELL_TYPES.ferriteRock)).toBe(true);
    expect(isSolidTerrainCell(TERRAIN_CELL_TYPES.plasmaRock)).toBe(true);
  });

  it("stores terrain breakage and debris rules beside each material id", () => {
    expect(getTerrainMaterialDefinition(TERRAIN_CELL_TYPES.ferriteRock)).toMatchObject({
      breakDamage: 20,
      debrisResources: { ferrite: 2 }
    });
    expect(getTerrainMaterialDefinition(TERRAIN_CELL_TYPES.plasmaRock)).toMatchObject({
      breakDamage: 30,
      debrisResources: { ferrite: 1, "plasma-crystal": 1 }
    });
  });
});
