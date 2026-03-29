export interface TerrainVariantInput {
  mapId: string;
  chunkX: number;
  chunkY: number;
  cellIndex: number;
  cellType: number;
  variantCount?: number;
}

export const DEFAULT_TERRAIN_VARIANT_COUNT = 64;

export function selectTerrainVariant(input: TerrainVariantInput): number {
  const variantCount = input.variantCount ?? DEFAULT_TERRAIN_VARIANT_COUNT;
  if (!Number.isInteger(variantCount) || variantCount <= 0) {
    throw new Error(`variantCount must be a positive integer. Received ${variantCount}.`);
  }

  const key = `${input.mapId}:${input.chunkX}:${input.chunkY}:${input.cellIndex}:${input.cellType}`;
  const hash = fnv1aHash(key);
  return (hash % variantCount) + 1;
}

function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
