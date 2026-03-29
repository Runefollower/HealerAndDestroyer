import { DEFAULT_TERRAIN_VARIANT_COUNT } from "@healer/shared";
import { Assets, Texture } from "pixi.js";

const textureCache = new Map<string, Texture>();
let preloadPromise: Promise<void> | null = null;

export function getTerrainTexture(variant: number): Texture {
  const url = getTerrainSpriteUrl(variant);
  return textureCache.get(url) ?? Texture.from(url);
}

export function preloadTerrainTextures(): Promise<void> {
  if (preloadPromise) {
    return preloadPromise;
  }

  const urls = Array.from({ length: DEFAULT_TERRAIN_VARIANT_COUNT }, (_, index) => getTerrainSpriteUrl(index + 1));
  preloadPromise = Promise.all(
    urls.map(async (url) => {
      const texture = await Assets.load<Texture>(url);
      textureCache.set(url, texture);
    })
  ).then(() => undefined);

  return preloadPromise;
}

export function getTerrainSpriteUrl(variant: number): string {
  const normalized = Math.min(DEFAULT_TERRAIN_VARIANT_COUNT, Math.max(1, Math.floor(variant)));
  return `/assets/terrain/rock/rock-${String(normalized).padStart(2, "0")}.png`;
}
