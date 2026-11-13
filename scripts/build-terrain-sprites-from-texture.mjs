import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pngjs from "pngjs";

const { PNG } = pngjs;

// Cuts terrain sprite variants out of large AI-generated material textures (art-source/terrain).
// Every material borrows its alpha silhouettes from the common rock sprites, so all solid terrain
// overlaps and blends the same way in renderWorld; only the colour inside the silhouette changes.
// Crops are seeded, so rerunning with the same textures gives the same sprites.

const terrainRoot = join("apps", "client", "public", "assets", "terrain");
const silhouetteFolder = join(terrainRoot, "rock");
const spriteSize = 64;
const variantCount = 64;

// cropSize must be a multiple of spriteSize; larger crops fit more stones into one cell.
// silhouetteOffset shifts which rock outline each material variant uses so materials don't
// repeat the exact rock shapes next to each other.
const materials = [
  { folder: "rock", prefix: "rock", texture: "rock-texture-01.png", cropSize: 448, seed: 1, silhouetteOffset: 0 },
  { folder: "ferrite-ore", prefix: "ferrite-ore", texture: "ferrite-ore-texture-01.png", cropSize: 384, seed: 2, silhouetteOffset: 17 },
  { folder: "plasma-crystal", prefix: "plasma-crystal", texture: "plasma-crystal-texture-01.png", cropSize: 384, seed: 3, silhouetteOffset: 29 },
  { folder: "ancient-stone", prefix: "ancient-stone", texture: "ancient-stone-texture-01.png", cropSize: 384, seed: 4, silhouetteOffset: 41 },
  { folder: "unstable-crystal", prefix: "unstable-crystal", texture: "unstable-crystal-texture-01.png", cropSize: 384, seed: 5, silhouetteOffset: 53 }
];

const { values: args } = parseArgs({ options: { only: { type: "string" } } });
const selected = args.only ? materials.filter((material) => material.folder === args.only) : materials;
if (selected.length === 0) {
  throw new Error(`Unknown material folder "${args.only}". Known: ${materials.map((material) => material.folder).join(", ")}`);
}

// Read every silhouette before writing anything, because the rock folder is both a mask source and an output.
const silhouettes = Array.from({ length: variantCount }, (_, index) =>
  PNG.sync.read(readFileSync(spritePath(silhouetteFolder, "rock", index + 1)))
);

for (const material of selected) {
  buildMaterial(material);
}

function buildMaterial(material) {
  const { cropSize } = material;
  if (cropSize % spriteSize !== 0) {
    throw new Error(`cropSize for ${material.folder} must be a multiple of ${spriteSize}.`);
  }
  const blockSize = cropSize / spriteSize;
  const texturePath = join("art-source", "terrain", material.texture);
  const texture = PNG.sync.read(readFileSync(texturePath));
  if (texture.width < cropSize || texture.height < cropSize) {
    throw new Error(`${texturePath} must be at least ${cropSize}px square.`);
  }
  const rng = createRng(material.seed);

  for (let variant = 1; variant <= variantCount; variant += 1) {
    const silhouette = silhouettes[(variant - 1 + material.silhouetteOffset) % variantCount];
    // Draw the crop position first so the sequence depends only on the seed.
    const cropX = Math.floor(rng() * (texture.width - cropSize + 1));
    const cropY = Math.floor(rng() * (texture.height - cropSize + 1));
    const sprite = new PNG({ width: spriteSize, height: spriteSize });

    for (let y = 0; y < spriteSize; y += 1) {
      for (let x = 0; x < spriteSize; x += 1) {
        const [r, g, b] = averageBlock(texture, cropX + x * blockSize, cropY + y * blockSize, blockSize);
        const index = (y * spriteSize + x) * 4;
        sprite.data[index] = r;
        sprite.data[index + 1] = g;
        sprite.data[index + 2] = b;
        sprite.data[index + 3] = silhouette.data[index + 3];
      }
    }

    writeFileSync(spritePath(join(terrainRoot, material.folder), material.prefix, variant), PNG.sync.write(sprite));
  }

  console.log(`Rebuilt ${variantCount} ${material.prefix} sprites from ${texturePath}.`);
}

function spritePath(folder, prefix, variant) {
  return join(folder, `${prefix}-${String(variant).padStart(2, "0")}.png`);
}

// Box-filters one block of the texture down to a single sprite pixel.
function averageBlock(png, startX, startY, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = startY; y < startY + size; y += 1) {
    for (let x = startX; x < startX + size; x += 1) {
      const index = (y * png.width + x) * 4;
      r += png.data[index];
      g += png.data[index + 1];
      b += png.data[index + 2];
    }
  }
  const samples = size * size;
  return [Math.round(r / samples), Math.round(g / samples), Math.round(b / samples)];
}

// Small deterministic PRNG (mulberry32) so crops are stable between runs.
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
