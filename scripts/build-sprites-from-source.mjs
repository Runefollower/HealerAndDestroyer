import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import pngjs from "pngjs";

const { PNG } = pngjs;

// Turns the transparent, high-resolution source art in art-source/sprites into game sprites.
// For each manifest entry it rotates the art so it faces +x (the game's forward direction),
// trims empty space, and fits it centered into width x height (times the manifest scale),
// keeping the aspect ratio. Rendering code still sizes sprites by the same world-space width/height.

const { values: args } = parseArgs({
  options: {
    manifest: { type: "string", default: "art-source/sprites/manifest.json" },
    only: { type: "string" }
  }
});

const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
const scale = manifest.scale ?? 1;
const entries = args.only ? manifest.sprites.filter((entry) => entry.id === args.only) : manifest.sprites;

for (const entry of entries) {
  const source = PNG.sync.read(readFileSync(entry.source));
  const rotated = rotate(source, entry.rotate ?? 0);
  const trimmed = trim(rotated, 8);
  const output = fitContain(trimmed, Math.round(entry.width * scale), Math.round(entry.height * scale));
  mkdirSync(dirname(entry.output), { recursive: true });
  writeFileSync(entry.output, PNG.sync.write(output));
  console.log(`Built ${entry.output} (${output.width}x${output.height})`);
}

// Rotates by a multiple of 90 degrees; positive values turn clockwise.
function rotate(png, degrees) {
  const turns = (((degrees / 90) % 4) + 4) % 4;
  if (!Number.isInteger(turns)) {
    throw new Error(`rotate must be a multiple of 90, got ${degrees}`);
  }
  let current = png;
  for (let turn = 0; turn < turns; turn += 1) {
    const next = new PNG({ width: current.height, height: current.width });
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        // Clockwise: source (x, y) lands at (height - 1 - y, x).
        copyPixel(current, x, y, next, current.height - 1 - y, x);
      }
    }
    current = next;
  }
  return current;
}

// Crops to the bounding box of pixels whose alpha exceeds the threshold.
function trim(png, alphaThreshold) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    throw new Error("Source art is fully transparent.");
  }
  const cropped = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });
  for (let y = 0; y < cropped.height; y += 1) {
    for (let x = 0; x < cropped.width; x += 1) {
      copyPixel(png, minX + x, minY + y, cropped, x, y);
    }
  }
  return cropped;
}

// Area-averages the art into a centered box of the target size, using premultiplied alpha
// so transparent edges do not bleed dark fringes.
function fitContain(png, targetWidth, targetHeight) {
  const ratio = Math.min(targetWidth / png.width, targetHeight / png.height);
  const drawWidth = png.width * ratio;
  const drawHeight = png.height * ratio;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;
  const output = new PNG({ width: targetWidth, height: targetHeight });

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      // Footprint of this output pixel in source coordinates.
      const sx0 = (x - offsetX) / ratio;
      const sx1 = (x + 1 - offsetX) / ratio;
      const sy0 = (y - offsetY) / ratio;
      const sy1 = (y + 1 - offsetY) / ratio;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) {
        const coverY = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
          const coverX = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const weight = coverX * coverY;
          if (weight <= 0) continue;
          area += weight;
          if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) continue;
          const index = (sy * png.width + sx) * 4;
          const alpha = png.data[index + 3] / 255;
          r += png.data[index] * alpha * weight;
          g += png.data[index + 1] * alpha * weight;
          b += png.data[index + 2] * alpha * weight;
          a += alpha * weight;
        }
      }
      const outIndex = (y * targetWidth + x) * 4;
      if (a > 0) {
        output.data[outIndex] = Math.round(r / a);
        output.data[outIndex + 1] = Math.round(g / a);
        output.data[outIndex + 2] = Math.round(b / a);
        output.data[outIndex + 3] = Math.round((a / area) * 255);
      }
    }
  }
  return output;
}

function copyPixel(from, fromX, fromY, to, toX, toY) {
  const source = (fromY * from.width + fromX) * 4;
  const target = (toY * to.width + toX) * 4;
  to.data[target] = from.data[source];
  to.data[target + 1] = from.data[source + 1];
  to.data[target + 2] = from.data[source + 2];
  to.data[target + 3] = from.data[source + 3];
}
