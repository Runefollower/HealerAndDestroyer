import type { SnapshotMessage } from "@healer/shared";

// Chunk and tile sizes mirror the server terrain grid (see apps/server/src/simulation/mapGeneration.ts).
const chunkSizeTiles = 8;
const tileSizePx = 32;
// The minimap fits inside this CSS box; the map keeps its aspect ratio within it.
const minimapMaxWidthPx = 240;
const minimapMaxHeightPx = 200;
// Local mode shows a window of this many tiles around the ship (whole map if the map is smaller).
const localViewWidthTiles = 48;
const localViewHeightTiles = 40;

// M cycles local (around the ship) -> sector (whole map) -> hidden.
export type MinimapMode = "local" | "sector" | "hidden";
const minimapModeOrder: MinimapMode[] = ["local", "sector", "hidden"];

// Visibility values match TerrainVisibilityState on the snapshot: 0 unknown, 1 remembered, 2 visible.
const rememberedVisibility = 1;
const visibleVisibility = 2;

type Rgba = readonly [number, number, number, number];

// Unknown cells stay transparent so the panel background reads as unexplored space.
const unknownColor: Rgba = [0, 0, 0, 0];
// Open space is the readable "path" on the minimap; solid cells are drawn by material.
const visibleOpenColor: Rgba = [62, 112, 140, 255];
const rememberedOpenColor: Rgba = [34, 52, 66, 255];
const visibleSolidColors: Record<number, Rgba> = {
  1: [138, 128, 116, 255], // common rock
  2: [196, 128, 72, 255], // ferrite ore
  3: [168, 112, 230, 255], // plasma crystal
  4: [118, 150, 136, 255], // ancient stone
  5: [90, 230, 255, 255] // unstable crystal
};
const fallbackSolidColor: Rgba = [138, 128, 116, 255];
// Remembered cells are dimmed toward the background so live vision stands out.
const rememberedDimming = 0.42;

export interface MinimapTerrainImage {
  // mapId lets the caller cache one image per map and rebuild when the player changes maps.
  mapId: string;
  // originTileX/Y is the world tile at pixel (0, 0); generated maps start at 0 but this stays general.
  originTileX: number;
  originTileY: number;
  widthTiles: number;
  heightTiles: number;
  // pixels is RGBA, one pixel per terrain tile, row-major.
  pixels: Uint8ClampedArray<ArrayBuffer>;
  // Explored counts cover remembered plus currently visible cells.
  exploredCells: number;
  totalCells: number;
}

// Builds a one-pixel-per-tile RGBA image of the player's unknown, remembered, and visible terrain.
// The snapshot already carries every chunk filtered through the player's per-map terrain memory,
// so the minimap reveals nothing the main view does not.
export function buildMinimapTerrainImage(snapshot: Pick<SnapshotMessage, "mapId" | "chunks">): MinimapTerrainImage {
  let minChunkX = Infinity;
  let minChunkY = Infinity;
  let maxChunkX = -Infinity;
  let maxChunkY = -Infinity;
  for (const chunk of snapshot.chunks) {
    minChunkX = Math.min(minChunkX, chunk.chunkX);
    minChunkY = Math.min(minChunkY, chunk.chunkY);
    maxChunkX = Math.max(maxChunkX, chunk.chunkX);
    maxChunkY = Math.max(maxChunkY, chunk.chunkY);
  }

  if (!Number.isFinite(minChunkX)) {
    return {
      mapId: snapshot.mapId,
      originTileX: 0,
      originTileY: 0,
      widthTiles: 0,
      heightTiles: 0,
      pixels: new Uint8ClampedArray(0),
      exploredCells: 0,
      totalCells: 0
    };
  }

  const widthTiles = (maxChunkX - minChunkX + 1) * chunkSizeTiles;
  const heightTiles = (maxChunkY - minChunkY + 1) * chunkSizeTiles;
  const pixels = new Uint8ClampedArray(widthTiles * heightTiles * 4);
  let exploredCells = 0;
  let totalCells = 0;

  for (const chunk of snapshot.chunks) {
    const baseX = (chunk.chunkX - minChunkX) * chunkSizeTiles;
    const baseY = (chunk.chunkY - minChunkY) * chunkSizeTiles;
    for (let index = 0; index < chunk.cells.length; index += 1) {
      const visibility = chunk.visibility[index] ?? 0;
      const color = colorForCell(chunk.cells[index] ?? 0, visibility);
      const x = baseX + (index % chunkSizeTiles);
      const y = baseY + Math.floor(index / chunkSizeTiles);
      const offset = (y * widthTiles + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
      totalCells += 1;
      if (visibility >= rememberedVisibility) {
        exploredCells += 1;
      }
    }
  }

  return {
    mapId: snapshot.mapId,
    originTileX: minChunkX * chunkSizeTiles,
    originTileY: minChunkY * chunkSizeTiles,
    widthTiles,
    heightTiles,
    pixels,
    exploredCells,
    totalCells
  };
}

// Picks the minimap color for one terrain cell given its visibility state.
export function colorForCell(cellType: number, visibility: number): Rgba {
  if (visibility < rememberedVisibility) {
    return unknownColor;
  }

  const isOpen = cellType === 0;
  if (visibility >= visibleVisibility) {
    return isOpen ? visibleOpenColor : visibleSolidColors[cellType] ?? fallbackSolidColor;
  }

  if (isOpen) {
    return rememberedOpenColor;
  }
  const live = visibleSolidColors[cellType] ?? fallbackSolidColor;
  return [
    Math.round(live[0] * rememberedDimming),
    Math.round(live[1] * rememberedDimming),
    Math.round(live[2] * rememberedDimming),
    255
  ];
}

// Fits a map of the given tile size into the minimap box, returning CSS pixels per tile.
export function computeMinimapScale(widthTiles: number, heightTiles: number): number {
  if (widthTiles <= 0 || heightTiles <= 0) {
    return 1;
  }
  return Math.min(minimapMaxWidthPx / widthTiles, minimapMaxHeightPx / heightTiles);
}

export interface MinimapViewRect {
  // x/y/width/height are in tiles relative to the terrain image origin.
  x: number;
  y: number;
  width: number;
  height: number;
}

// Chooses which part of the terrain image to show. Local mode centers on the ship and clamps to the map edge.
export function computeMinimapView(
  mode: MinimapMode,
  terrain: Pick<MinimapTerrainImage, "originTileX" | "originTileY" | "widthTiles" | "heightTiles">,
  selfPosition: { x: number; y: number } | null
): MinimapViewRect {
  if (mode !== "local" || !selfPosition) {
    return { x: 0, y: 0, width: terrain.widthTiles, height: terrain.heightTiles };
  }

  const width = Math.min(localViewWidthTiles, terrain.widthTiles);
  const height = Math.min(localViewHeightTiles, terrain.heightTiles);
  const centerX = selfPosition.x / tileSizePx - terrain.originTileX;
  const centerY = selfPosition.y / tileSizePx - terrain.originTileY;
  return {
    x: clamp(centerX - width / 2, 0, terrain.widthTiles - width),
    y: clamp(centerY - height / 2, 0, terrain.heightTiles - height),
    width,
    height
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// MinimapOverlay owns the HTML canvas panel. Terrain is rebuilt only when a new snapshot arrives;
// markers are redrawn every frame from the predicted render snapshot so the self marker moves smoothly.
export class MinimapOverlay {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly summary: HTMLElement;
  private readonly hint: HTMLElement;
  // terrainCanvas holds the 1px-per-tile terrain image so per-frame drawing is a single scaled blit.
  private readonly terrainCanvas: HTMLCanvasElement;
  private terrain: MinimapTerrainImage | null = null;
  private terrainSnapshotTick = -1;
  private mode: MinimapMode = "local";

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = `
      <div class="minimap-header">
        <p class="panel-title">Map</p>
        <span class="minimap-summary"></span>
      </div>
      <canvas class="minimap-canvas"></canvas>
      <div class="minimap-hint"></div>
    `;
    this.canvas = this.root.querySelector("canvas")!;
    this.context = this.canvas.getContext("2d")!;
    this.summary = this.root.querySelector(".minimap-summary")!;
    this.hint = this.root.querySelector(".minimap-hint")!;
    this.terrainCanvas = document.createElement("canvas");
    this.syncVisibility();
  }

  // Advances local -> sector -> hidden -> local.
  cycleMode(): void {
    const next = (minimapModeOrder.indexOf(this.mode) + 1) % minimapModeOrder.length;
    this.mode = minimapModeOrder[next];
    this.syncVisibility();
  }

  // hidden lets other panels (the builder) temporarily take the same screen corner.
  setSuppressed(suppressed: boolean): void {
    this.root.classList.toggle("suppressed", suppressed);
  }

  // Rebuilds the terrain image when the authoritative snapshot changes.
  updateTerrain(snapshot: SnapshotMessage): void {
    if (snapshot.tick === this.terrainSnapshotTick && this.terrain?.mapId === snapshot.mapId) {
      return;
    }
    this.terrainSnapshotTick = snapshot.tick;
    const image = buildMinimapTerrainImage(snapshot);
    this.terrain = image;
    if (image.widthTiles === 0) {
      return;
    }

    if (this.terrainCanvas.width !== image.widthTiles || this.terrainCanvas.height !== image.heightTiles) {
      this.terrainCanvas.width = image.widthTiles;
      this.terrainCanvas.height = image.heightTiles;
    }
    const terrainContext = this.terrainCanvas.getContext("2d")!;
    terrainContext.putImageData(new ImageData(image.pixels, image.widthTiles, image.heightTiles), 0, 0);

    const explored = image.totalCells === 0 ? 0 : Math.round((image.exploredCells / image.totalCells) * 100);
    this.summary.textContent = `${snapshot.mapId} · ${explored}% explored`;
  }

  // Draws terrain plus entity markers. Entities are already visibility-filtered by the server.
  render(snapshot: SnapshotMessage): void {
    if (this.mode === "hidden" || !this.terrain || this.terrain.widthTiles === 0) {
      return;
    }

    const terrain = this.terrain;
    const self = snapshot.players.find((player) => player.playerId === snapshot.selfPlayerId);
    const view = computeMinimapView(this.mode, terrain, self?.position ?? null);
    const scale = computeMinimapScale(view.width, view.height);
    const cssWidth = Math.round(view.width * scale);
    const cssHeight = Math.round(view.height * scale);
    const pixelRatio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(cssWidth * pixelRatio);
    const backingHeight = Math.round(cssHeight * pixelRatio);
    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
    }

    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, backingWidth, backingHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(this.terrainCanvas, view.x, view.y, view.width, view.height, 0, 0, backingWidth, backingHeight);

    // From here on, draw in tile units so marker code matches the terrain image.
    const tileToCanvas = scale * pixelRatio;
    const viewWorldTileX = terrain.originTileX + view.x;
    const viewWorldTileY = terrain.originTileY + view.y;
    context.setTransform(tileToCanvas, 0, 0, tileToCanvas, -viewWorldTileX * tileToCanvas, -viewWorldTileY * tileToCanvas);
    // Markers keep a readable on-screen size regardless of zoom.
    const markerRadius = 2.4 / scale;

    for (const structure of snapshot.structures) {
      drawSquare(context, structure.position, markerRadius, "#7fc8ff");
    }
    for (const foundry of snapshot.foundries) {
      drawSquare(context, foundry.position, markerRadius * 1.3, foundry.active ? "#ff8a3d" : "#7a5a44");
    }
    for (const enemy of snapshot.enemies) {
      drawDot(context, enemy.position, markerRadius, "#ff4d5e");
    }
    for (const player of snapshot.players) {
      if (player.playerId === snapshot.selfPlayerId) {
        continue;
      }
      drawDot(context, player.position, markerRadius, "#6fead0");
    }

    if (self) {
      drawSelfMarker(context, self.position, self.rotation, markerRadius * 1.7);
    }
  }

  private syncVisibility(): void {
    this.root.classList.toggle("hidden", this.mode === "hidden");
    this.hint.textContent = this.mode === "local" ? "Local · M for sector" : "Sector · M to hide";
  }
}

function toTile(position: { x: number; y: number }): { x: number; y: number } {
  return { x: position.x / tileSizePx, y: position.y / tileSizePx };
}

function drawDot(context: CanvasRenderingContext2D, position: { x: number; y: number }, radius: number, color: string): void {
  const tile = toTile(position);
  context.fillStyle = color;
  context.beginPath();
  context.arc(tile.x, tile.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawSquare(context: CanvasRenderingContext2D, position: { x: number; y: number }, radius: number, color: string): void {
  const tile = toTile(position);
  context.fillStyle = color;
  context.fillRect(tile.x - radius, tile.y - radius, radius * 2, radius * 2);
}

// The local ship is an arrow pointing along its rotation (0 = facing +x, matching world rendering).
function drawSelfMarker(context: CanvasRenderingContext2D, position: { x: number; y: number }, rotation: number, size: number): void {
  const tile = toTile(position);
  context.save();
  context.translate(tile.x, tile.y);
  context.rotate(rotation);
  context.beginPath();
  context.moveTo(size, 0);
  context.lineTo(-size * 0.7, size * 0.65);
  context.lineTo(-size * 0.35, 0);
  context.lineTo(-size * 0.7, -size * 0.65);
  context.closePath();
  context.fillStyle = "#ffffff";
  context.fill();
  context.lineWidth = size * 0.25;
  context.strokeStyle = "#0b1a24";
  context.stroke();
  context.restore();
}
