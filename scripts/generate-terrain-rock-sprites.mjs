import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const outputRoot = join(process.cwd(), "apps", "client", "public", "assets", "terrain");
const canvasSize = 64;
const CRC_TABLE = buildCrcTable();

// Each terrain material gets its own sprite sheet while common rock keeps the original folder.
// The generated PNGs are deterministic so world cells keep stable art between builds.
const terrainSpriteSets = [
  {
    folder: "rock",
    prefix: "rock",
    preserveExisting: true,
    seedOffset: 0,
    outlinePalette: ["#162128", "#1a252d", "#202d36"].map(hexToRgb),
    fillPalette: ["#536872", "#5f757f", "#6b828b", "#778f97"].map(hexToRgb),
    shadowPalette: ["#2b3a45", "#31414d", "#364954"].map(hexToRgb),
    highlightPalette: ["#9fb6bc", "#afc4c8", "#bed1d5"].map(hexToRgb),
    crackColor: hexToRgb("#223039"),
    decorate: () => undefined
  },
  {
    folder: "ferrite-ore",
    prefix: "ferrite-ore",
    style: "markedBlock",
    mark: "oreRing",
    seedOffset: 19_001,
    outlinePalette: ["#251f21", "#30282a", "#3c3130"].map(hexToRgb),
    fillPalette: ["#615d57", "#706960", "#807569", "#918071"].map(hexToRgb),
    shadowPalette: ["#342f31", "#40383a", "#4a4140"].map(hexToRgb),
    highlightPalette: ["#baaa98", "#cbb9a5", "#ddc8ae"].map(hexToRgb),
    crackColor: hexToRgb("#2a2223"),
    accentColor: hexToRgb("#d88c55")
  },
  {
    folder: "plasma-crystal",
    prefix: "plasma-crystal",
    style: "markedBlock",
    mark: "crystalStar",
    seedOffset: 37_003,
    outlinePalette: ["#101c2b", "#14253a", "#182e45"].map(hexToRgb),
    fillPalette: ["#24384d", "#2b4760", "#345873", "#416b82"].map(hexToRgb),
    shadowPalette: ["#16263a", "#1c3048", "#243a55"].map(hexToRgb),
    highlightPalette: ["#90d6ff", "#a9e7ff", "#c8f3ff"].map(hexToRgb),
    crackColor: hexToRgb("#1a3147"),
    accentColor: hexToRgb("#77dbff")
  },
  {
    folder: "ancient-stone",
    prefix: "ancient-stone",
    style: "markedBlock",
    mark: "diagonalRunes",
    seedOffset: 53_009,
    outlinePalette: ["#1b2622", "#22302b", "#2b3934"].map(hexToRgb),
    fillPalette: ["#68776f", "#74867d", "#80958b", "#8ea49a"].map(hexToRgb),
    shadowPalette: ["#30413c", "#384c46", "#415750"].map(hexToRgb),
    highlightPalette: ["#a6bdb5", "#b9cbc4", "#c8d8d1"].map(hexToRgb),
    crackColor: hexToRgb("#23332f"),
    accentColor: hexToRgb("#d4ded6")
  },
  {
    folder: "unstable-crystal",
    prefix: "unstable-crystal",
    style: "markedBlock",
    mark: "implosionCracks",
    seedOffset: 71_011,
    outlinePalette: ["#0b2530", "#0e3342", "#124451"].map(hexToRgb),
    fillPalette: ["#1b5a69", "#227483", "#2a919a", "#40aeb1"].map(hexToRgb),
    shadowPalette: ["#103946", "#144a58", "#1b5d68"].map(hexToRgb),
    highlightPalette: ["#90fff8", "#b5fffb", "#ddfffd"].map(hexToRgb),
    crackColor: hexToRgb("#081c26"),
    accentColor: hexToRgb("#94fff8")
  }
];

for (const spriteSet of terrainSpriteSets) {
  const outputDir = join(outputRoot, spriteSet.folder);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  if (!spriteSet.preserveExisting) {
    cleanupOutputDir(outputDir, spriteSet.prefix);
  }

  for (let variant = 1; variant <= 64; variant += 1) {
    const outputPath = join(outputDir, `${spriteSet.prefix}-${String(variant).padStart(2, "0")}.png`);
    if (spriteSet.preserveExisting && existsSync(outputPath)) {
      continue;
    }

    const rng = createRng(variant * 17713 + spriteSet.seedOffset);
    let image;
    if (spriteSet.style === "markedBlock") {
      image = createMarkedBlockSprite(spriteSet, rng, variant);
    } else {
      image = createImage(canvasSize, canvasSize);
      const rocks = generateRockCluster(rng, spriteSet);
      for (const rock of rocks) {
        paintRock(image, rock, spriteSet);
      }
      spriteSet.decorate(image, rocks, rng, variant);
    }

    writeFileSync(outputPath, encodePng(image));
  }
}

function cleanupOutputDir(outputDir, prefix) {
  for (const entry of readdirSync(outputDir)) {
    if (new RegExp(`^${escapeRegExp(prefix)}-\\d+\\.(png|svg)$`, "i").test(entry)) {
      unlinkSync(join(outputDir, entry));
    }
  }
}

function createImage(width, height) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  };
}

function createMarkedBlockSprite(spriteSet, rng, variant) {
  const image = createImage(canvasSize, canvasSize);
  const left = 8 + rng() * 2;
  const top = 8 + rng() * 2;
  const right = 56 - rng() * 2;
  const bottom = 56 - rng() * 2;
  const block = { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
  const points = createBlockPoints(block, rng);

  drawPolygon(image, offsetPoints(points, 1.8, 2.2), pickColor(rng, spriteSet.shadowPalette), 0.7, variant * 31);
  drawPolygon(image, points, pickColor(rng, spriteSet.outlinePalette), 0.98, variant * 43);
  drawPolygon(image, insetBlockPoints(points, block.centerX, block.centerY, 0.9), pickColor(rng, spriteSet.fillPalette), 0.96, variant * 59);
  paintBlockSurfaceNoise(image, block, spriteSet, variant);
  drawSoftEllipse(image, block.centerX - 9, block.centerY - 12, 18, 11, -0.55, pickColor(rng, spriteSet.highlightPalette), 0.12);

  if (spriteSet.mark === "oreRing") {
    paintOreRingMark(image, block, spriteSet, rng);
  } else if (spriteSet.mark === "crystalStar") {
    paintCrystalStarMark(image, block, spriteSet, rng);
  } else if (spriteSet.mark === "diagonalRunes") {
    paintDiagonalRuneMark(image, block, spriteSet, rng);
  } else if (spriteSet.mark === "implosionCracks") {
    paintImplosionCrackMark(image, block, spriteSet, rng);
  }

  return image;
}

function createBlockPoints(block, rng) {
  return [
    { x: block.left + rng() * 2, y: block.top + rng() * 1.5 },
    { x: block.right - rng() * 2, y: block.top + rng() * 2 },
    { x: block.right - rng() * 1.2, y: block.bottom - rng() * 2 },
    { x: block.left + rng() * 1.8, y: block.bottom - rng() * 1.2 }
  ];
}

function insetBlockPoints(points, centerX, centerY, scale) {
  return points.map((point) => ({
    x: centerX + (point.x - centerX) * scale,
    y: centerY + (point.y - centerY) * scale
  }));
}

function paintBlockSurfaceNoise(image, block, spriteSet, seed) {
  const baseColor = pickColor(createRng(seed * 97), spriteSet.fillPalette);
  for (let y = Math.floor(block.top) + 2; y <= Math.ceil(block.bottom) - 2; y += 1) {
    for (let x = Math.floor(block.left) + 2; x <= Math.ceil(block.right) - 2; x += 1) {
      const noise = sampleNoiseGrid(x, y, seed * 13);
      if (noise > 0.28) {
        blendPixel(image, x, y, baseColor.r, baseColor.g, baseColor.b, 0.05);
      }
    }
  }
}

function paintOreRingMark(image, block, spriteSet, rng) {
  const radius = 10 + rng() * 2.2;
  const centerX = block.centerX + (rng() - 0.5) * 3;
  const centerY = block.centerY + (rng() - 0.5) * 3;
  const darkRing = pickColor(rng, spriteSet.outlinePalette);
  const brightOre = spriteSet.accentColor;

  drawEllipseStroke(image, centerX, centerY, radius + 1.8, radius, 0, darkRing, 0.78, 2.4);
  drawEllipseStroke(image, centerX, centerY, radius - 0.4, radius - 2.2, 0, brightOre, 0.62, 1.35);
  drawSoftEllipse(image, centerX, centerY, 3.4, 3, 0, darkRing, 0.42);
  drawSoftEllipse(image, centerX + 1.5, centerY - 1.5, 2.6, 2.1, 0, pickColor(rng, spriteSet.highlightPalette), 0.42);
}

function paintCrystalStarMark(image, block, spriteSet, rng) {
  const centerX = block.centerX + (rng() - 0.5) * 3;
  const centerY = block.centerY + (rng() - 0.5) * 3;
  const shadow = pickColor(rng, spriteSet.shadowPalette);
  const highlight = pickColor(rng, spriteSet.highlightPalette);

  drawSoftEllipse(image, centerX, centerY, 18, 16, 0, spriteSet.accentColor, 0.16);
  for (let index = 0; index < 5; index += 1) {
    const angle = (Math.PI * 2 * index) / 5 + rng() * 0.16;
    const x = centerX + Math.cos(angle) * (4 + rng() * 2);
    const y = centerY + Math.sin(angle) * (4 + rng() * 2);
    drawCrystalShard(image, x, y, 4.8 + rng() * 1.7, 13 + rng() * 4, angle + Math.PI / 2, shadow, highlight, 0.9);
  }
  drawCrystalShard(image, centerX, centerY, 7, 15, rng() * Math.PI, shadow, highlight, 0.95);
}

function paintDiagonalRuneMark(image, block, spriteSet, rng) {
  const lineColor = pickColor(rng, spriteSet.outlinePalette);
  const highlightColor = spriteSet.accentColor;
  const slashCount = 3 + Math.floor(rng() * 2);

  for (let index = 0; index < slashCount; index += 1) {
    const x = block.left + 11 + index * 9 + rng() * 2;
    const y = block.top + 13 + rng() * 8;
    drawQuadraticStroke(image, x, y + 16, x + 4 + rng() * 3, y + 7, x + 13 + rng() * 3, y - 1, lineColor, 0.68, 1.8);
    drawQuadraticStroke(image, x + 1, y + 15, x + 5 + rng() * 3, y + 7, x + 13 + rng() * 3, y, highlightColor, 0.18, 0.95);
  }
}

function paintImplosionCrackMark(image, block, spriteSet, rng) {
  const centerX = block.centerX + (rng() - 0.5) * 2;
  const centerY = block.centerY + (rng() - 0.5) * 2;
  const crackColor = pickColor(rng, spriteSet.outlinePalette);

  drawSoftEllipse(image, centerX, centerY, 18, 16, 0, spriteSet.accentColor, 0.16);
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8 + (rng() - 0.5) * 0.35;
    const startRadius = 18 + rng() * 5;
    const endRadius = 4 + rng() * 3;
    const startX = centerX + Math.cos(angle) * startRadius;
    const startY = centerY + Math.sin(angle) * startRadius;
    const endX = centerX + Math.cos(angle + (rng() - 0.5) * 0.45) * endRadius;
    const endY = centerY + Math.sin(angle + (rng() - 0.5) * 0.45) * endRadius;
    drawQuadraticStroke(image, startX, startY, (startX + endX) / 2 + (rng() - 0.5) * 4, (startY + endY) / 2 + (rng() - 0.5) * 4, endX, endY, crackColor, 0.78, 2.2);
    drawQuadraticStroke(image, startX, startY, (startX + endX) / 2, (startY + endY) / 2, endX, endY, spriteSet.accentColor, 0.24, 1.1);
  }
  drawCrystalShard(image, centerX, centerY, 7, 17, rng() * Math.PI, pickColor(rng, spriteSet.shadowPalette), pickColor(rng, spriteSet.highlightPalette), 0.9);
}

function generateRockCluster(rng, spriteSet) {
  const radii = [
    12.5 + rng() * 4,
    11.5 + rng() * 3.5,
    10.5 + rng() * 3,
    9.5 + rng() * 3,
    8.5 + rng() * 2.6,
    8 + rng() * 2.4,
    7.5 + rng() * 2.2,
    7 + rng() * 2,
    6.2 + rng() * 1.8,
    5.7 + rng() * 1.7,
    5.1 + rng() * 1.5,
    4.7 + rng() * 1.3,
    4.2 + rng() * 1.1,
    3.8 + rng() * 1,
    3.4 + rng() * 0.9
  ].sort((left, right) => right - left);

  const rocks = createSeedRocks(rng, spriteSet);
  for (let index = 0; index < radii.length; index += 1) {
    const radius = radii[index];
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const candidate = {
        x: 6 + rng() * 52,
        y: 6 + rng() * 52,
        radiusX: radius * (0.9 + rng() * 0.26),
        radiusY: radius * (0.82 + rng() * 0.24),
        rotation: -1.2 + rng() * 2.4,
        fillColor: pickColor(rng, spriteSet.fillPalette),
        shadowColor: pickColor(rng, spriteSet.shadowPalette),
        outlineColor: pickColor(rng, spriteSet.outlinePalette),
        highlightColor: pickColor(rng, spriteSet.highlightPalette),
        seed: Math.floor(rng() * 1_000_000)
      };

      const score = placementScore(candidate, rocks);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
      if (score < 5) {
        break;
      }
    }

    if (best) {
      rocks.push(best);
    }
  }

  normalizeCluster(rocks);
  addPerimeterFillers(rocks, rng, spriteSet);
  normalizeCluster(rocks);
  return rocks.sort((left, right) => (left.y + left.radiusY) - (right.y + right.radiusY));
}

function createSeedRocks(rng, spriteSet) {
  const cornerInset = 9.5;
  const edgeInset = 7.4;
  const cornerPositions = [
    { x: cornerInset, y: cornerInset },
    { x: canvasSize - 1 - cornerInset, y: cornerInset },
    { x: cornerInset, y: canvasSize - 1 - cornerInset },
    { x: canvasSize - 1 - cornerInset, y: canvasSize - 1 - cornerInset }
  ];
  const edgePositions = [
    { x: (canvasSize - 1) / 2, y: edgeInset },
    { x: canvasSize - 1 - edgeInset, y: (canvasSize - 1) / 2 },
    { x: (canvasSize - 1) / 2, y: canvasSize - 1 - edgeInset },
    { x: edgeInset, y: (canvasSize - 1) / 2 }
  ];

  const cornerRocks = cornerPositions.map((position) => {
    const radius = 10.1 + rng() * 2.8;
    return createSeedRock(rng, spriteSet, position.x, position.y, radius, 1.2);
  });

  const edgeRocks = edgePositions.map((position) => {
    const radius = 7.2 + rng() * 2.1;
    return createSeedRock(rng, spriteSet, position.x, position.y, radius, 1);
  });

  return [...cornerRocks, ...edgeRocks];
}

function createSeedRock(rng, spriteSet, x, y, radius, jitter) {
  return {
    x: x + (rng() - 0.5) * jitter,
    y: y + (rng() - 0.5) * jitter,
    radiusX: radius * (0.92 + rng() * 0.18),
    radiusY: radius * (0.86 + rng() * 0.16),
    rotation: -1.2 + rng() * 2.4,
    fillColor: pickColor(rng, spriteSet.fillPalette),
    shadowColor: pickColor(rng, spriteSet.shadowPalette),
    outlineColor: pickColor(rng, spriteSet.outlinePalette),
    highlightColor: pickColor(rng, spriteSet.highlightPalette),
    seed: Math.floor(rng() * 1_000_000)
  };
}

function placementScore(candidate, placedRocks) {
  let score = 0;
  let nearestGap = Number.POSITIVE_INFINITY;

  for (const rock of placedRocks) {
    const dx = candidate.x - rock.x;
    const dy = candidate.y - rock.y;
    const distance = Math.hypot(dx, dy);
    const candidateSize = (candidate.radiusX + candidate.radiusY) * 0.5;
    const rockSize = (rock.radiusX + rock.radiusY) * 0.5;
    const preferredDistance = (candidateSize + rockSize) * 0.84;
    const minDistance = (candidateSize + rockSize) * 0.58;

    if (distance < minDistance) {
      const overlap = minDistance - distance;
      score += overlap * overlap * 8;
    } else {
      const gap = Math.abs(distance - preferredDistance);
      score += gap * gap * 0.18;
      nearestGap = Math.min(nearestGap, gap);
    }
  }

  if (placedRocks.length > 0) {
    score += nearestGap * 1.6;
  }

  const centerDistance = Math.hypot(candidate.x - 32, candidate.y - 32);
  score += centerDistance * 0.18;
  score += boundaryPenalty(candidate);
  return score;
}

function boundaryPenalty(candidate) {
  let penalty = 0;
  penalty += Math.max(0, (candidate.radiusX + 1) - candidate.x) * 2;
  penalty += Math.max(0, candidate.x + candidate.radiusX - 63) * 2;
  penalty += Math.max(0, (candidate.radiusY + 1) - candidate.y) * 2;
  penalty += Math.max(0, candidate.y + candidate.radiusY - 63) * 2;
  return penalty;
}

function normalizeCluster(rocks) {
  if (!rocks.length) {
    return;
  }

  const bounds = getRockBounds(rocks);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const shiftX = 32 - centerX;
  const shiftY = 32 - centerY;

  for (const rock of rocks) {
    rock.x += shiftX;
    rock.y += shiftY;
  }
}

function addPerimeterFillers(rocks, rng, spriteSet) {
  const targetInset = 2;
  const bounds = getRockBounds(rocks);
  const leftGap = bounds.minX - targetInset;
  const rightGap = (canvasSize - 1 - targetInset) - bounds.maxX;
  const topGap = bounds.minY - targetInset;
  const bottomGap = (canvasSize - 1 - targetInset) - bounds.maxY;

  if (leftGap > 0.75) {
    rocks.push(createEdgeRock(rng, spriteSet, targetInset + 3.8 + rng() * 1.4, clamp(22 + rng() * 20, 8, 56), 3.8 + Math.min(2.2, leftGap * 0.35)));
  }
  if (rightGap > 0.75) {
    rocks.push(createEdgeRock(rng, spriteSet, canvasSize - 1 - targetInset - (3.8 + rng() * 1.4), clamp(22 + rng() * 20, 8, 56), 3.8 + Math.min(2.2, rightGap * 0.35)));
  }
  if (topGap > 0.75) {
    rocks.push(createEdgeRock(rng, spriteSet, clamp(22 + rng() * 20, 8, 56), targetInset + 3.8 + rng() * 1.4, 3.8 + Math.min(2.2, topGap * 0.35)));
  }
  if (bottomGap > 0.75) {
    rocks.push(createEdgeRock(rng, spriteSet, clamp(22 + rng() * 20, 8, 56), canvasSize - 1 - targetInset - (3.8 + rng() * 1.4), 3.8 + Math.min(2.2, bottomGap * 0.35)));
  }

  if (leftGap > 1.5 && topGap > 1.5) {
    rocks.push(createEdgeRock(rng, spriteSet, targetInset + 3.2, targetInset + 3.2, 3.4 + rng() * 1.1));
  }
  if (rightGap > 1.5 && topGap > 1.5) {
    rocks.push(createEdgeRock(rng, spriteSet, canvasSize - 1 - targetInset - 3.2, targetInset + 3.2, 3.4 + rng() * 1.1));
  }
  if (leftGap > 1.5 && bottomGap > 1.5) {
    rocks.push(createEdgeRock(rng, spriteSet, targetInset + 3.2, canvasSize - 1 - targetInset - 3.2, 3.4 + rng() * 1.1));
  }
  if (rightGap > 1.5 && bottomGap > 1.5) {
    rocks.push(createEdgeRock(rng, spriteSet, canvasSize - 1 - targetInset - 3.2, canvasSize - 1 - targetInset - 3.2, 3.4 + rng() * 1.1));
  }
}

function createEdgeRock(rng, spriteSet, x, y, radius) {
  return {
    x,
    y,
    radiusX: radius * (0.92 + rng() * 0.18),
    radiusY: radius * (0.84 + rng() * 0.18),
    rotation: -1.2 + rng() * 2.4,
    fillColor: pickColor(rng, spriteSet.fillPalette),
    shadowColor: pickColor(rng, spriteSet.shadowPalette),
    outlineColor: pickColor(rng, spriteSet.outlinePalette),
    highlightColor: pickColor(rng, spriteSet.highlightPalette),
    seed: Math.floor(rng() * 1_000_000)
  };
}

function getRockBounds(rocks) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rock of rocks) {
    minX = Math.min(minX, rock.x - rock.radiusX);
    minY = Math.min(minY, rock.y - rock.radiusY);
    maxX = Math.max(maxX, rock.x + rock.radiusX);
    maxY = Math.max(maxY, rock.y + rock.radiusY);
  }

  return { minX, minY, maxX, maxY };
}

function paintRock(image, rock, spriteSet) {
  const outlinePoints = createRockPolygon(rock.x, rock.y, rock.radiusX * 1.12, rock.radiusY * 1.12, rock.rotation, 7, rock.seed + 11);
  const shadowPoints = offsetPoints(createRockPolygon(rock.x, rock.y, rock.radiusX * 1.04, rock.radiusY * 1.04, rock.rotation, 7, rock.seed + 17), 1.5, 1.8);
  const facePoints = createRockPolygon(rock.x, rock.y, rock.radiusX, rock.radiusY, rock.rotation, 7, rock.seed + 23);

  drawPolygon(image, outlinePoints, rock.outlineColor, 0.98, rock.seed + 31);
  drawPolygon(image, shadowPoints, rock.shadowColor, 0.58, rock.seed + 43);
  drawPolygon(image, facePoints, rock.fillColor, 0.98, rock.seed + 59);
  drawSoftEllipse(image, rock.x - rock.radiusX * 0.18, rock.y - rock.radiusY * 0.24, rock.radiusX * 0.4, rock.radiusY * 0.28, rock.rotation, rock.highlightColor, 0.22);
  drawSoftEllipse(image, rock.x + rock.radiusX * 0.16, rock.y + rock.radiusY * 0.18, rock.radiusX * 0.42, rock.radiusY * 0.32, rock.rotation, rock.outlineColor, 0.12);
  paintRockCracks(image, rock, spriteSet);
}

function paintRockCracks(image, rock, spriteSet) {
  const crackCount = rock.radiusX > 10 ? 2 : 1;
  const crackRng = createRng(rock.seed * 13 + 7);
  for (let index = 0; index < crackCount; index += 1) {
    const startX = rock.x + (crackRng() - 0.5) * rock.radiusX * 0.9;
    const startY = rock.y + (crackRng() - 0.5) * rock.radiusY * 0.9;
    const midX = startX + (crackRng() - 0.5) * rock.radiusX * 0.55;
    const midY = startY + (crackRng() - 0.5) * rock.radiusY * 0.55;
    const endX = midX + (crackRng() - 0.5) * rock.radiusX * 0.45;
    const endY = midY + (crackRng() - 0.5) * rock.radiusY * 0.45;
    drawQuadraticStroke(image, startX, startY, midX, midY, endX, endY, spriteSet.crackColor, 0.18, Math.max(0.8, rock.radiusX * 0.08));
  }
}

function paintFerriteVeins(image, rocks, rng) {
  const veinColor = hexToRgb("#d08b55");
  const brightOre = hexToRgb("#f0c08a");
  const darkOre = hexToRgb("#6f3f34");
  for (let index = 0; index < 7; index += 1) {
    const rock = rocks[Math.floor(rng() * rocks.length)];
    const startX = rock.x + (rng() - 0.5) * rock.radiusX * 0.9;
    const startY = rock.y + (rng() - 0.5) * rock.radiusY * 0.9;
    const midX = startX + (rng() - 0.5) * rock.radiusX * 0.9;
    const midY = startY + (rng() - 0.5) * rock.radiusY * 0.9;
    const endX = midX + (rng() - 0.5) * rock.radiusX * 0.7;
    const endY = midY + (rng() - 0.5) * rock.radiusY * 0.7;
    drawQuadraticStroke(image, startX, startY, midX, midY, endX, endY, darkOre, 0.22, 1.8);
    drawQuadraticStroke(image, startX, startY, midX, midY, endX, endY, veinColor, 0.32, 1);
  }
  for (let index = 0; index < 10; index += 1) {
    const rock = rocks[Math.floor(rng() * rocks.length)];
    drawSoftEllipse(
      image,
      rock.x + (rng() - 0.5) * rock.radiusX * 1.1,
      rock.y + (rng() - 0.5) * rock.radiusY * 1.1,
      1.2 + rng() * 1.3,
      0.8 + rng() * 1,
      rng() * Math.PI,
      brightOre,
      0.3
    );
  }
}

function paintPlasmaCrystals(image, rocks, rng) {
  const glow = hexToRgb("#4dd8ff");
  const crystalFill = hexToRgb("#9be8ff");
  const crystalShadow = hexToRgb("#2372a5");
  for (let index = 0; index < 8; index += 1) {
    const rock = rocks[Math.floor(rng() * rocks.length)];
    const x = rock.x + (rng() - 0.5) * rock.radiusX * 1.05;
    const y = rock.y + (rng() - 0.5) * rock.radiusY * 1.05;
    drawSoftEllipse(image, x, y, 5.5 + rng() * 2.5, 3.5 + rng() * 2, rng() * Math.PI, glow, 0.18);
    drawCrystalShard(image, x, y, 3.5 + rng() * 2.8, 7 + rng() * 5, rng() * Math.PI, crystalShadow, crystalFill, 0.72);
  }
  for (let index = 0; index < 5; index += 1) {
    const rock = rocks[Math.floor(rng() * rocks.length)];
    drawQuadraticStroke(
      image,
      rock.x - rock.radiusX * 0.35,
      rock.y + (rng() - 0.5) * rock.radiusY,
      rock.x + (rng() - 0.5) * rock.radiusX,
      rock.y + (rng() - 0.5) * rock.radiusY,
      rock.x + rock.radiusX * 0.35,
      rock.y + (rng() - 0.5) * rock.radiusY,
      glow,
      0.22,
      1.2
    );
  }
}

function paintAncientEtchings(image, rocks, rng) {
  const etchedShadow = hexToRgb("#263834");
  const mossGlow = hexToRgb("#9ad0bf");
  for (let index = 0; index < 12; index += 1) {
    const rock = rocks[Math.floor(rng() * rocks.length)];
    const x = rock.x + (rng() - 0.5) * rock.radiusX * 0.9;
    const y = rock.y + (rng() - 0.5) * rock.radiusY * 0.9;
    const length = 4 + rng() * 5;
    const angle = (Math.PI / 4) * Math.floor(rng() * 4);
    const bend = angle + (rng() - 0.5) * 0.9;
    drawQuadraticStroke(
      image,
      x,
      y,
      x + Math.cos(bend) * length * 0.45,
      y + Math.sin(bend) * length * 0.45,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
      etchedShadow,
      0.26,
      1.1
    );
  }
  for (let index = 0; index < 6; index += 1) {
    const rock = rocks[Math.floor(rng() * rocks.length)];
    drawSoftEllipse(
      image,
      rock.x + (rng() - 0.5) * rock.radiusX,
      rock.y + (rng() - 0.5) * rock.radiusY,
      2 + rng() * 2.4,
      1 + rng() * 1.4,
      rng() * Math.PI,
      mossGlow,
      0.16
    );
  }
}

function paintUnstableCore(image, rocks, rng, variant) {
  const centerRock = rocks.reduce((best, rock) => {
    const bestDistance = Math.hypot(best.x - 32, best.y - 32);
    const rockDistance = Math.hypot(rock.x - 32, rock.y - 32);
    return rockDistance < bestDistance ? rock : best;
  }, rocks[0]);
  const pulse = 0.75 + (variant % 5) * 0.04;
  const glow = hexToRgb("#69fff6");
  const whiteHot = hexToRgb("#e9fffd");
  const shardShadow = hexToRgb("#147d8c");

  drawSoftEllipse(image, 32, 32, 21, 19, 0, glow, 0.2 * pulse);
  for (let index = 0; index < 9; index += 1) {
    const angle = (Math.PI * 2 * index) / 9 + rng() * 0.35;
    const distance = 3 + rng() * 12;
    const x = centerRock.x + Math.cos(angle) * distance;
    const y = centerRock.y + Math.sin(angle) * distance;
    drawCrystalShard(image, x, y, 3 + rng() * 2.5, 9 + rng() * 6, angle, shardShadow, whiteHot, 0.78);
    drawQuadraticStroke(image, 32, 32, (32 + x) / 2, (32 + y) / 2, x, y, glow, 0.23, 1.1);
  }
}

function drawCrystalShard(image, centerX, centerY, width, height, rotation, shadowColor, fillColor, opacity) {
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  const localPoints = [
    { x: 0, y: -height * 0.55 },
    { x: width * 0.48, y: -height * 0.05 },
    { x: width * 0.2, y: height * 0.46 },
    { x: -width * 0.42, y: height * 0.38 },
    { x: -width * 0.5, y: -height * 0.06 }
  ];
  const points = localPoints.map((point) => ({
    x: centerX + point.x * cos - point.y * sin,
    y: centerY + point.x * sin + point.y * cos
  }));
  const insetPoints = localPoints.map((point) => ({
    x: centerX + point.x * 0.64 * cos - point.y * 0.64 * sin,
    y: centerY + point.x * 0.64 * sin + point.y * 0.64 * cos
  }));
  drawPolygon(image, points, shadowColor, opacity, Math.floor(centerX * 97 + centerY * 53));
  drawPolygon(image, insetPoints, fillColor, opacity * 0.7, Math.floor(centerX * 41 + centerY * 83));
}

function createRockPolygon(centerX, centerY, radiusX, radiusY, rotation, pointCount, seed) {
  const rng = createRng(seed >>> 0);
  const points = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const angle = (Math.PI * 2 * pointIndex) / pointCount + (rng() - 0.5) * 0.38;
    const radialScale = 0.76 + rng() * 0.34;
    const notch = pointIndex % 2 === 0 ? 1 : 0.9 + rng() * 0.12;
    const localX = Math.cos(angle) * radiusX * radialScale * notch;
    const localY = Math.sin(angle) * radiusY * radialScale * notch;
    const rotatedX = localX * Math.cos(rotation) - localY * Math.sin(rotation);
    const rotatedY = localX * Math.sin(rotation) + localY * Math.cos(rotation);
    points.push({ x: centerX + rotatedX, y: centerY + rotatedY });
  }
  return points;
}

function offsetPoints(points, offsetX, offsetY) {
  return points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
}

function drawPolygon(image, points, color, opacity, noiseSeed) {
  const bounds = getPointBounds(image, points, 2);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!pointInPolygon(px, py, points)) {
        continue;
      }

      const edgeDistance = Math.min(distanceToPolygonEdges(px, py, points), 2.4);
      const edgeAlpha = clamp(edgeDistance / 1.05, 0, 1);
      const shade = 0.94 + sampleNoiseGrid(x, y, noiseSeed) * 0.12;
      blendPixel(image, x, y, color.r * shade, color.g * shade, color.b * shade, opacity * edgeAlpha);
    }
  }
}

function drawQuadraticStroke(image, startX, startY, controlX, controlY, endX, endY, color, opacity, width) {
  const steps = 18;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const inverse = 1 - t;
    const x = inverse * inverse * startX + 2 * inverse * t * controlX + t * t * endX;
    const y = inverse * inverse * startY + 2 * inverse * t * controlY + t * t * endY;
    drawSoftEllipse(image, x, y, width, width * 0.72, 0, color, opacity * 0.92);
  }
}

function drawEllipseStroke(image, centerX, centerY, radiusX, radiusY, rotation, color, opacity, width) {
  const steps = 52;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let step = 0; step <= steps; step += 1) {
    const angle = (Math.PI * 2 * step) / steps;
    const localX = Math.cos(angle) * radiusX;
    const localY = Math.sin(angle) * radiusY;
    const x = centerX + localX * cos - localY * sin;
    const y = centerY + localX * sin + localY * cos;
    drawSoftEllipse(image, x, y, width, width * 0.75, rotation + angle, color, opacity);
  }
}

function drawSoftEllipse(image, centerX, centerY, radiusX, radiusY, rotation, color, opacity) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const bounds = {
    minX: Math.max(0, Math.floor(centerX - radiusX - 2)),
    maxX: Math.min(image.width - 1, Math.ceil(centerX + radiusX + 2)),
    minY: Math.max(0, Math.floor(centerY - radiusY - 2)),
    maxY: Math.min(image.height - 1, Math.ceil(centerY + radiusY + 2))
  };

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const normalized = Math.sqrt((localX * localX) / (radiusX * radiusX) + (localY * localY) / (radiusY * radiusY));
      if (normalized > 1.15) {
        continue;
      }

      const intensity = smoothstep(1.15, 0.2, normalized);
      blendPixel(image, x, y, color.r, color.g, color.b, opacity * intensity);
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const prior = points[previous];
    const intersects = ((current.y > y) !== (prior.y > y))
      && (x < ((prior.x - current.x) * (y - current.y)) / (prior.y - current.y) + current.x);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygonEdges(x, y, points) {
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    minDistance = Math.min(minDistance, distanceToSegment(x, y, start.x, start.y, end.x, end.y));
  }
  return minDistance;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abX = bx - ax;
  const abY = by - ay;
  const lengthSquared = abX * abX + abY * abY;
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const projection = clamp(((px - ax) * abX + (py - ay) * abY) / lengthSquared, 0, 1);
  const closestX = ax + abX * projection;
  const closestY = ay + abY * projection;
  return Math.hypot(px - closestX, py - closestY);
}

function getPointBounds(image, points, padding) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.max(0, Math.floor(Math.min(...xs) - padding)),
    maxX: Math.min(image.width - 1, Math.ceil(Math.max(...xs) + padding)),
    minY: Math.max(0, Math.floor(Math.min(...ys) - padding)),
    maxY: Math.min(image.height - 1, Math.ceil(Math.max(...ys) + padding))
  };
}

function sampleNoiseGrid(x, y, seed) {
  let state = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1442695041)) >>> 0;
  state = (state ^ (state >>> 13)) >>> 0;
  state = Math.imul(state, 1274126177) >>> 0;
  return state / 0xffffffff - 0.5;
}

function blendPixel(image, x, y, red, green, blue, alpha) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || alpha <= 0) {
    return;
  }

  const index = (y * image.width + x) * 4;
  const sourceAlpha = clamp(alpha, 0, 1);
  const destinationAlpha = image.data[index + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) {
    return;
  }

  image.data[index] = Math.round((((red / 255) * sourceAlpha) + ((image.data[index] / 255) * destinationAlpha * (1 - sourceAlpha))) / outputAlpha * 255);
  image.data[index + 1] = Math.round((((green / 255) * sourceAlpha) + ((image.data[index + 1] / 255) * destinationAlpha * (1 - sourceAlpha))) / outputAlpha * 255);
  image.data[index + 2] = Math.round((((blue / 255) * sourceAlpha) + ((image.data[index + 2] / 255) * destinationAlpha * (1 - sourceAlpha))) / outputAlpha * 255);
  image.data[index + 3] = Math.round(outputAlpha * 255);
}

function setPixel(image, x, y, red, green, blue, alpha) {
  const index = (y * image.width + x) * 4;
  image.data[index] = clamp(Math.round(red), 0, 255);
  image.data[index + 1] = clamp(Math.round(green), 0, 255);
  image.data[index + 2] = clamp(Math.round(blue), 0, 255);
  image.data[index + 3] = clamp(Math.round(alpha), 0, 255);
}

function mixColor(from, to, amount) {
  return {
    r: lerp(from.r, to.r, amount),
    g: lerp(from.g, to.g, amount),
    b: lerp(from.b, to.b, amount)
  };
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);

  for (let y = 0; y < image.height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    const sourceOffset = y * stride;
    for (let byteIndex = 0; byteIndex < stride; byteIndex += 1) {
      raw[rowOffset + 1 + byteIndex] = image.data[sourceOffset + byteIndex];
    }
  }

  const compressed = deflateSync(raw);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createChunk("IHDR", header),
    createChunk("IDAT", compressed),
    createChunk("IEND", Buffer.alloc(0))
  ]);
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pickColor(rng, palette) {
  return palette[Math.floor(rng() * palette.length)] ?? palette[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hexToRgb(value) {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16)
  };
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
