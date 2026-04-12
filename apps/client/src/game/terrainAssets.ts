import { DEFAULT_TERRAIN_VARIANT_COUNT } from "@healer/shared";
import { Assets, Texture } from "pixi.js";

// Terrain textures are cached by URL so renderWorld can create sprites without repeated asset loads.
const textureCache = new Map<string, Texture>();
// preloadPromise makes texture preloading idempotent across repeated boot calls/tests.
let preloadPromise: Promise<void> | null = null;

// Returns the Pixi texture for a terrain variant, falling back to Texture.from if preload missed it.
export function getTerrainTexture(variant: number): Texture {
  const url = getTerrainSpriteUrl(variant);
  return textureCache.get(url) ?? Texture.from(url);
}

// Preloads all supported terrain sprite variants before the first world render.
export function preloadTerrainTextures(): Promise<void> {
  if (preloadPromise) {
    return preloadPromise;
  }

  // Terrain variants are one-indexed in the asset filenames.
  const urls = Array.from({ length: DEFAULT_TERRAIN_VARIANT_COUNT }, (_, index) => getTerrainSpriteUrl(index + 1));
  preloadPromise = Promise.all(
    urls.map(async (url) => {
      const texture = await Assets.load<Texture>(url);
      textureCache.set(url, texture);
    })
  ).then(() => undefined);

  return preloadPromise;
}

// Converts a terrain variant number into the matching rock sprite URL.
export function getTerrainSpriteUrl(variant: number): string {
  const normalized = Math.min(DEFAULT_TERRAIN_VARIANT_COUNT, Math.max(1, Math.floor(variant)));
  return `/assets/terrain/rock/rock-${String(normalized).padStart(2, "0")}.png`;
}
