import { DEFAULT_TERRAIN_VARIANT_COUNT, TERRAIN_CELL_TYPES, getTerrainMaterialDefinition } from "@healer/shared";
import { Assets, Texture } from "pixi.js";

interface TerrainSpriteSet {
  // folder is the public asset directory under /assets/terrain.
  folder: string;
  // prefix is the filename prefix used by the deterministic sprite generator.
  prefix: string;
}

const terrainSpriteSetsByMaterialId = {
  commonRock: { folder: "rock", prefix: "rock" },
  ferriteOre: { folder: "ferrite-ore", prefix: "ferrite-ore" },
  plasmaCrystal: { folder: "plasma-crystal", prefix: "plasma-crystal" },
  ancientStone: { folder: "ancient-stone", prefix: "ancient-stone" },
  unstableCrystal: { folder: "unstable-crystal", prefix: "unstable-crystal" }
} satisfies Partial<Record<keyof typeof TERRAIN_CELL_TYPES, TerrainSpriteSet>>;

// Terrain textures are cached by URL so renderWorld can create sprites without repeated asset loads.
const textureCache = new Map<string, Texture>();
// preloadPromise makes texture preloading idempotent across repeated boot calls/tests.
let preloadPromise: Promise<void> | null = null;

// Returns the Pixi texture for a terrain variant, falling back to Texture.from if preload missed it.
export function getTerrainTexture(cellType: number, variant: number): Texture {
  const url = getTerrainSpriteUrl(cellType, variant);
  return textureCache.get(url) ?? Texture.from(url);
}

// Preloads all supported terrain sprite variants before the first world render.
export function preloadTerrainTextures(): Promise<void> {
  if (preloadPromise) {
    return preloadPromise;
  }

  // Terrain variants are one-indexed in the asset filenames.
  const solidCellTypes = Object.values(TERRAIN_CELL_TYPES).filter((cellType) => getTerrainMaterialDefinition(cellType).solid);
  const urls = solidCellTypes.flatMap((cellType) =>
    Array.from({ length: DEFAULT_TERRAIN_VARIANT_COUNT }, (_, index) => getTerrainSpriteUrl(cellType, index + 1))
  );
  preloadPromise = Promise.all(
    urls.map(async (url) => {
      const texture = await Assets.load<Texture>(url);
      textureCache.set(url, texture);
    })
  ).then(() => undefined);

  return preloadPromise;
}

// Converts a material cell and terrain variant into the matching sprite URL.
export function getTerrainSpriteUrl(cellType: number, variant: number): string {
  const normalized = Math.min(DEFAULT_TERRAIN_VARIANT_COUNT, Math.max(1, Math.floor(variant)));
  const materialId = getTerrainMaterialDefinition(cellType).id;
  const spriteSet = terrainSpriteSetsByMaterialId[materialId] ?? terrainSpriteSetsByMaterialId.commonRock;
  return `/assets/terrain/${spriteSet.folder}/${spriteSet.prefix}-${String(normalized).padStart(2, "0")}.png`;
}
