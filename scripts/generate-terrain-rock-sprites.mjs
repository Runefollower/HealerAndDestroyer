import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const outputDir = join(process.cwd(), "apps", "client", "public", "assets", "terrain", "rock");
const canvasSize = 64;
const outlinePalette = ["#162128", "#1a252d", "#202d36"].map(hexToRgb);
const fillPalette = ["#536872", "#5f757f", "#6b828b", "#778f97"].map(hexToRgb);
const shadowPalette = ["#2b3a45", "#31414d", "#364954"].map(hexToRgb);
const highlightPalette = ["#9fb6bc", "#afc4c8", "#bed1d5"].map(hexToRgb);
const crackColor = hexToRgb("#223039");
const CRC_TABLE = buildCrcTable();

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

cleanupOutputDir();

for (let variant = 1; variant <= 64; variant += 1) {
  const rng = createRng(variant * 17713);
  const image = createImage(canvasSize, canvasSize);
  const rocks = generateRockCluster(rng);

  for (const rock of rocks) {
    paintRock(image, rock);
  }

  writeFileSync(join(outputDir, `rock-${String(variant).padStart(2, "0")}.png`), encodePng(image));
}

function cleanupOutputDir() {
  for (const entry of readdirSync(outputDir)) {
    if (/^rock-\d+\.(png|svg)$/i.test(entry)) {
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

function generateRockCluster(rng) {
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

  const rocks = createSeedRocks(rng);
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
        fillColor: pickColor(rng, fillPalette),
        shadowColor: pickColor(rng, shadowPalette),
        outlineColor: pickColor(rng, outlinePalette),
        highlightColor: pickColor(rng, highlightPalette),
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
  addPerimeterFillers(rocks, rng);
  normalizeCluster(rocks);
  return rocks.sort((left, right) => (left.y + left.radiusY) - (right.y + right.radiusY));
}

function createSeedRocks(rng) {
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
    return createSeedRock(rng, position.x, position.y, radius, 1.2);
  });

  const edgeRocks = edgePositions.map((position) => {
    const radius = 7.2 + rng() * 2.1;
    return createSeedRock(rng, position.x, position.y, radius, 1);
  });

  return [...cornerRocks, ...edgeRocks];
}

function createSeedRock(rng, x, y, radius, jitter) {
  return {
    x: x + (rng() - 0.5) * jitter,
    y: y + (rng() - 0.5) * jitter,
    radiusX: radius * (0.92 + rng() * 0.18),
    radiusY: radius * (0.86 + rng() * 0.16),
    rotation: -1.2 + rng() * 2.4,
    fillColor: pickColor(rng, fillPalette),
    shadowColor: pickColor(rng, shadowPalette),
    outlineColor: pickColor(rng, outlinePalette),
    highlightColor: pickColor(rng, highlightPalette),
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

function addPerimeterFillers(rocks, rng) {
  const targetInset = 2;
  const bounds = getRockBounds(rocks);
  const leftGap = bounds.minX - targetInset;
  const rightGap = (canvasSize - 1 - targetInset) - bounds.maxX;
  const topGap = bounds.minY - targetInset;
  const bottomGap = (canvasSize - 1 - targetInset) - bounds.maxY;

  if (leftGap > 0.75) {
    rocks.push(createEdgeRock(rng, targetInset + 3.8 + rng() * 1.4, clamp(22 + rng() * 20, 8, 56), 3.8 + Math.min(2.2, leftGap * 0.35)));
  }
  if (rightGap > 0.75) {
    rocks.push(createEdgeRock(rng, canvasSize - 1 - targetInset - (3.8 + rng() * 1.4), clamp(22 + rng() * 20, 8, 56), 3.8 + Math.min(2.2, rightGap * 0.35)));
  }
  if (topGap > 0.75) {
    rocks.push(createEdgeRock(rng, clamp(22 + rng() * 20, 8, 56), targetInset + 3.8 + rng() * 1.4, 3.8 + Math.min(2.2, topGap * 0.35)));
  }
  if (bottomGap > 0.75) {
    rocks.push(createEdgeRock(rng, clamp(22 + rng() * 20, 8, 56), canvasSize - 1 - targetInset - (3.8 + rng() * 1.4), 3.8 + Math.min(2.2, bottomGap * 0.35)));
  }

  if (leftGap > 1.5 && topGap > 1.5) {
    rocks.push(createEdgeRock(rng, targetInset + 3.2, targetInset + 3.2, 3.4 + rng() * 1.1));
  }
  if (rightGap > 1.5 && topGap > 1.5) {
    rocks.push(createEdgeRock(rng, canvasSize - 1 - targetInset - 3.2, targetInset + 3.2, 3.4 + rng() * 1.1));
  }
  if (leftGap > 1.5 && bottomGap > 1.5) {
    rocks.push(createEdgeRock(rng, targetInset + 3.2, canvasSize - 1 - targetInset - 3.2, 3.4 + rng() * 1.1));
  }
  if (rightGap > 1.5 && bottomGap > 1.5) {
    rocks.push(createEdgeRock(rng, canvasSize - 1 - targetInset - 3.2, canvasSize - 1 - targetInset - 3.2, 3.4 + rng() * 1.1));
  }
}

function createEdgeRock(rng, x, y, radius) {
  return {
    x,
    y,
    radiusX: radius * (0.92 + rng() * 0.18),
    radiusY: radius * (0.84 + rng() * 0.18),
    rotation: -1.2 + rng() * 2.4,
    fillColor: pickColor(rng, fillPalette),
    shadowColor: pickColor(rng, shadowPalette),
    outlineColor: pickColor(rng, outlinePalette),
    highlightColor: pickColor(rng, highlightPalette),
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

function paintRock(image, rock) {
  const outlinePoints = createRockPolygon(rock.x, rock.y, rock.radiusX * 1.12, rock.radiusY * 1.12, rock.rotation, 7, rock.seed + 11);
  const shadowPoints = offsetPoints(createRockPolygon(rock.x, rock.y, rock.radiusX * 1.04, rock.radiusY * 1.04, rock.rotation, 7, rock.seed + 17), 1.5, 1.8);
  const facePoints = createRockPolygon(rock.x, rock.y, rock.radiusX, rock.radiusY, rock.rotation, 7, rock.seed + 23);

  drawPolygon(image, outlinePoints, rock.outlineColor, 0.98, rock.seed + 31);
  drawPolygon(image, shadowPoints, rock.shadowColor, 0.58, rock.seed + 43);
  drawPolygon(image, facePoints, rock.fillColor, 0.98, rock.seed + 59);
  drawSoftEllipse(image, rock.x - rock.radiusX * 0.18, rock.y - rock.radiusY * 0.24, rock.radiusX * 0.4, rock.radiusY * 0.28, rock.rotation, rock.highlightColor, 0.22);
  drawSoftEllipse(image, rock.x + rock.radiusX * 0.16, rock.y + rock.radiusY * 0.18, rock.radiusX * 0.42, rock.radiusY * 0.32, rock.rotation, rock.outlineColor, 0.12);
  paintRockCracks(image, rock);
}

function paintRockCracks(image, rock) {
  const crackCount = rock.radiusX > 10 ? 2 : 1;
  const crackRng = createRng(rock.seed * 13 + 7);
  for (let index = 0; index < crackCount; index += 1) {
    const startX = rock.x + (crackRng() - 0.5) * rock.radiusX * 0.9;
    const startY = rock.y + (crackRng() - 0.5) * rock.radiusY * 0.9;
    const midX = startX + (crackRng() - 0.5) * rock.radiusX * 0.55;
    const midY = startY + (crackRng() - 0.5) * rock.radiusY * 0.55;
    const endX = midX + (crackRng() - 0.5) * rock.radiusX * 0.45;
    const endY = midY + (crackRng() - 0.5) * rock.radiusY * 0.45;
    drawQuadraticStroke(image, startX, startY, midX, midY, endX, endY, crackColor, 0.18, Math.max(0.8, rock.radiusX * 0.08));
  }
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




