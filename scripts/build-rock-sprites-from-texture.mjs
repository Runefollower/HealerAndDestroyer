import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pngjs from "pngjs";

const { PNG } = pngjs;

// Cuts the common rock terrain variants out of a large AI-generated rubble texture.
// Each variant keeps the alpha silhouette of the existing rock-NN.png so walls still overlap
// and blend the same way in renderWorld; only the colour inside the silhouette changes.
// Crops are seeded, so rerunning with the same texture gives the same sprites.

const { values: args } = parseArgs({
  options: {
    texture: { type: "string", default: join("art-source", "terrain", "rock-texture-01.png") },
    folder: { type: "string", default: join("apps", "client", "public", "assets", "terrain", "rock") },
    prefix: { type: "string", default: "rock" },
    count: { type: "string", default: "64" },
    crop: { type: "string", default: "448" },
    seed: { type: "string", default: "1" }
  }
});

const spriteSize = 64;
const cropSize = Number(args.crop);
const variantCount = Number(args.count);
if (cropSize % spriteSize !== 0) {
  throw new Error(`--crop must be a multiple of ${spriteSize} so each sprite pixel averages a whole block.`);
}
const blockSize = cropSize / spriteSize;

const texture = PNG.sync.read(readFileSync(args.texture));
if (texture.width < cropSize || texture.height < cropSize) {
  throw new Error(`Texture is ${texture.width}x${texture.height}; it must be at least ${cropSize}px square.`);
}

const rng = createRng(Number(args.seed));

for (let variant = 1; variant <= variantCount; variant += 1) {
  const spritePath = join(args.folder, `${args.prefix}-${String(variant).padStart(2, "0")}.png`);
  const silhouette = PNG.sync.read(readFileSync(spritePath));
  if (silhouette.width !== spriteSize || silhouette.height !== spriteSize) {
    throw new Error(`${spritePath} is not ${spriteSize}x${spriteSize}.`);
  }

  // Draw the crop position before reading pixels so the sequence depends only on the seed.
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

  writeFileSync(spritePath, PNG.sync.write(sprite));
}

console.log(`Rebuilt ${variantCount} ${args.prefix} sprites in ${args.folder} from ${args.texture}.`);

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
