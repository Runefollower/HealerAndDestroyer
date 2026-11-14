import {
  getTerrainMaterialDefinition,
  isEmptyTerrainCell,
  selectTerrainVariant,
  type ExitSnapshot,
  type PlayerSnapshot,
  type ProjectileSnapshot,
  type SnapshotMessage
} from "@healer/shared";
import { Container, Graphics, Sprite, Text, type Container as PixiContainer, type DestroyOptions } from "pixi.js";
import { createPlayerShipDisplay } from "./playerShipAssets.js";
import { getTerrainTexture } from "./terrainAssets.js";
import { createEnemyDisplay, createFoundryDisplay, createSalvageDisplay, createStructureDisplay } from "./worldEntityAssets.js";
import { WorldEffects, type ActiveEffect } from "./worldEffects.js";

// Viewport padding keeps nearby off-screen objects ready as the camera moves between snapshots.
const viewportPadding = 160;
// Terrain tile size matches the server's terrain cell size in world-space pixels.
const terrainTileSize = 32;
// Terrain sprites are intentionally larger than a tile to overlap and soften grid edges.
const terrainSpriteSize = 46;
const terrainSpriteInset = (terrainSpriteSize - terrainTileSize) / 2;
// Engine exhaust particles trail from thrusting ships and are retained between redraws.
const exhaustParticleLifetimeMs = 520;
const exhaustSpawnIntervalMs = 70;
const maxExhaustParticles = 72;
const minimumExhaustForwardSpeed = 10;
// worldEffects plays the server's dust/explosion events (§12) once each, with a cap on active effects.
const worldEffects = new WorldEffects();
const exhaustParticles: ExhaustParticle[] = [];
const lastExhaustSpawnByPlayer = new Map<string, number>();
const renderLayerStates = new WeakMap<PixiContainer, RenderLayerState>();
// Destroy options for per-frame display objects. Shared textures are kept, but each Graphics' owned
// GraphicsContext must be freed explicitly: Pixi v8 only destroys it for an options object when
// `context: true` is set, otherwise its geometry lingers until Pixi's idle GC (~60-90s) and the heap
// grows by several MB per second while playing.
export const transientDisplayDestroyOptions: DestroyOptions = { children: true, texture: false, textureSource: false, context: true };

export interface WorldViewport {
  // x/y are the top-left world coordinates currently visible through the camera.
  x: number;
  y: number;
  // width/height are the current screen dimensions in pixels.
  width: number;
  height: number;
}

export interface WorldRenderEffects {
  // selfThrustForward is local-only input, so only the current player's ship can use it exactly.
  selfThrustForward?: boolean;
  // secondsSinceTick converts a server tick into seconds ago, so late effect events start part-way through.
  secondsSinceTick?: (tick: number) => number;
}

export interface WorldRenderStats {
  // terrainRebuilt shows whether this frame rebuilt the retained terrain/fog layers.
  terrainRebuilt: boolean;
  // terrainSprites is the retained terrain sprite count after any rebuild.
  terrainSprites: number;
  // dynamicObjects is the number of display objects rebuilt this frame.
  dynamicObjects: number;
  // fogObjects is the retained fog overlay object count.
  fogObjects: number;
  // short-lived effect counts help catch particle/burst runaway.
  exhaustParticles: number;
  effects: number;
}

interface TerrainCellRecord {
  // value is the terrain material value from the snapshot cell.
  value: number;
  // x/y are the world-space center of the terrain cell.
  x: number;
  y: number;
  // spriteX/spriteY are the top-left render coordinates for the oversized terrain sprite.
  spriteX: number;
  spriteY: number;
  // visibility controls live-vs-remembered terrain styling.
  visibility: number;
  // variant selects the deterministic texture variation for this cell.
  variant: number;
  // renderKey changes when the retained sprite needs its texture or style refreshed.
  renderKey: string;
}

interface TerrainSpriteRecord {
  // renderKey mirrors TerrainCellRecord.renderKey so unchanged cells can be skipped cheaply.
  renderKey: string;
  // sprite is retained between terrain refreshes to avoid mass allocation/destruction hitches.
  sprite: Sprite;
}

interface ExhaustParticle {
  // x/y are the current world-space particle origin.
  x: number;
  y: number;
  // velocity moves particles away from the engine between server snapshots.
  velocity: { x: number; y: number };
  // createdAt is a performance timestamp used to grow and fade the particle.
  createdAt: number;
  // seed controls deterministic flicker, size, and color selection.
  seed: number;
  // intensity reflects how strongly the ship is moving along its facing direction.
  intensity: number;
}

interface RenderLayerState {
  // terrainLayer holds static terrain sprites rebuilt only when authoritative terrain changes.
  terrainLayer: Container;
  // groundEffects is one retained Graphics, cleared and redrawn each frame, for dust and rock bursts.
  groundEffects: Graphics;
  // dynamicLayer is rebuilt every render frame for moving entities and short-lived effects.
  dynamicLayer: Container;
  // playerLayer keeps player ship displays retained between frames to avoid allocation churn.
  playerLayer: Container;
  // airEffects is one retained Graphics above ships for explosions, so a dying ship's blast covers it.
  airEffects: Graphics;
  // fogLayer sits above dynamic objects and is rebuilt with terrain visibility.
  fogLayer: Container;
  // terrainKey records the authoritative snapshot/viewport state used for the cached terrain.
  terrainKey: string | null;
  // terrainMapId detects map transitions so stale terrain sprites can be dropped in one batch.
  terrainMapId: string | null;
  // terrainSprites stores retained terrain display objects keyed by chunk/cell position.
  terrainSprites: Map<string, TerrainSpriteRecord>;
  // playerDisplays stores retained ship/bar/label display objects keyed by player entity id.
  playerDisplays: Map<string, PlayerDisplayRecord>;
}

interface PlayerDisplayRecord {
  // visualKey changes when a ship swap/refit changes the retained ship art.
  visualKey: string;
  // ship is the layered sprite/graphics display for the hull and mounted visual parts.
  ship: Container;
  // hullBack and hullFill are retained health bar graphics updated in place.
  hullBack: Graphics;
  hullFill: Graphics;
  // label is retained so Text objects are not created every frame.
  label: Text;
}

export interface HudSelections {
  // Labels for the currently selected module hardpoints in each capability group.
  weapon: string;
  mining: string;
  support: string;
}

// Renders the HTML mission HUD from the latest visibility-filtered snapshot.
export function renderHud(hud: HTMLElement, snapshot: SnapshotMessage, minimized: boolean, selections: HudSelections): void {
  // Inventory arrives as a resource map and is flattened into simple HUD copy.
  const inventoryEntries = Object.entries(snapshot.inventory)
    .map(([resource, amount]) => `${resource}: ${amount}`)
    .join("<br/>");
  const objective = describeObjective(snapshot);
  const foundryStatus = describeFoundryStatus(snapshot);

  hud.classList.toggle("minimized", minimized);

  // Minimized mode keeps the objective visible while hiding the detailed status panel.
  if (minimized) {
    hud.innerHTML = `
      <div class="hud-header">
        <p class="panel-title">Mission HUD</p>
        <button class="hud-toggle" type="button" data-action="toggle-hud">Expand</button>
      </div>
      <div>Map: ${snapshot.mapId}</div>
      <div class="muted-copy">${objective}</div>
    `;
    return;
  }

  hud.innerHTML = `
    <div class="hud-header">
      <p class="panel-title">Mission HUD</p>
      <button class="hud-toggle" type="button" data-action="toggle-hud">Minimize</button>
    </div>
    <div class="hud-body">
      <div><strong>Objective:</strong> ${objective}</div>
      <div>${foundryStatus}</div>
      <div>Map: ${snapshot.mapId}</div>
      <div>Players nearby: ${snapshot.players.length}</div>
      <div>Enemies nearby: ${snapshot.enemies.length}</div>
      <div>Foundries nearby: ${snapshot.foundries.length}</div>
      <div>Builder site nearby: ${snapshot.builderSiteNearby ? "yes" : "no"}</div>
      <div>Deeper path unlocked: ${snapshot.deeperPathUnlocked ? "yes" : "destroy the foundry"}</div>
      <div>Exit nearby: ${describeNearbyExit(snapshot)}</div>
      <div>Weapon slot: ${selections.weapon}</div>
      <div>Mining slot: ${selections.mining}</div>
      <div>Support slot: ${selections.support}</div>
      <div>${inventoryEntries}</div>
      <div>Controls: WASD move, Space fire, right click mine, left click repair, E interact or travel, M map</div>
      <div>Selection: 1 cycle weapon, 2 cycle mining, 3 cycle support</div>
    </div>
  `;
}

// Redraws the visible Pixi world layer from one server snapshot.
export function renderWorld(worldLayer: PixiContainer, snapshot: SnapshotMessage, viewport: WorldViewport, effects: WorldRenderEffects = {}): WorldRenderStats {
  // Transient visual state is updated before refreshing cached/static and dynamic render layers.
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const paddedViewport = padViewport(viewport, viewportPadding);
  const layers = getRenderLayerState(worldLayer);
  const terrainRebuilt = refreshTerrainLayer(layers, snapshot, paddedViewport, now);
  worldEffects.ingest(snapshot.mapId, snapshot.effects ?? [], now, effects.secondsSinceTick);
  worldEffects.prune(now);
  pruneExhaustParticles(now);
  pruneExhaustSpawnTimers(snapshot);
  clearLayer(layers.dynamicLayer);

  // Effects redraw into two retained Graphics (no per-frame allocation): dust and rock bursts just above
  // the terrain, explosions above ships and enemies.
  layers.groundEffects.clear();
  layers.airEffects.clear();
  for (const effect of worldEffects.active) {
    if (isPointInViewport(effect.x, effect.y, padViewport(paddedViewport, effect.radius * 2))) {
      drawWorldEffect(effect.kind === "explosion" ? layers.airEffects : layers.groundEffects, effect, now);
    }
  }

  // Structures and foundries render before mobile entities so ships/enemies remain readable.
  for (const structure of snapshot.structures) {
    if (!isPointInViewport(structure.position.x, structure.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createStructureDisplay(structure.structureTypeId);
    sprite.position.set(structure.position.x, structure.position.y);
    layers.dynamicLayer.addChild(sprite);
  }

  for (const exit of snapshot.exits) {
    if (!isPointInViewport(exit.position.x, exit.position.y, paddedViewport)) {
      continue;
    }
    layers.dynamicLayer.addChild(createExitDisplay(exit, exit.connectionId === snapshot.nearbyExitId, now));
  }

  for (const foundry of snapshot.foundries) {
    if (!isPointInViewport(foundry.position.x, foundry.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createFoundryDisplay(foundry.active);
    sprite.position.set(foundry.position.x, foundry.position.y);
    layers.dynamicLayer.addChild(sprite);

    // Foundry status labels expose objective health without requiring a separate HUD entry.
    const statusLabel = new Text({
      text: foundry.active ? `Foundry ${foundry.health} HP` : "Foundry Down",
      style: { fontSize: 12, fill: foundry.active ? 0xffd7cf : 0xb6c0cc }
    });
    statusLabel.position.set(foundry.position.x - 30, foundry.position.y - 52);
    layers.dynamicLayer.addChild(statusLabel);
  }

  // Drops, enemies, projectiles, and players are all already visibility-filtered by the server.
  for (const drop of snapshot.drops) {
    if (!isPointInViewport(drop.position.x, drop.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createSalvageDisplay(drop.resources);
    sprite.position.set(drop.position.x, drop.position.y);
    sprite.rotation = drop.rotation ?? 0;
    layers.dynamicLayer.addChild(sprite);
  }

  for (const enemy of snapshot.enemies) {
    if (!isPointInViewport(enemy.position.x, enemy.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createEnemyDisplay(enemy.enemyTypeId);
    sprite.position.set(enemy.position.x, enemy.position.y);
    sprite.rotation = enemy.rotation;
    layers.dynamicLayer.addChild(sprite);
  }

  for (const projectile of snapshot.projectiles) {
    if (!isPointInViewport(projectile.position.x, projectile.position.y, paddedViewport)) {
      continue;
    }
    layers.dynamicLayer.addChild(createProjectileEffect(projectile, now));
  }

  for (const player of snapshot.players) {
    if (!isPointInViewport(player.position.x, player.position.y, paddedViewport)) {
      continue;
    }
    spawnEngineExhaust(player, now, player.playerId === snapshot.selfPlayerId && effects.selfThrustForward === true);
  }

  // Exhaust sits below the ship art so hulls and engine sprites remain crisp.
  for (const particle of exhaustParticles) {
    if (!isPointInViewport(particle.x, particle.y, paddedViewport)) {
      continue;
    }
    layers.dynamicLayer.addChild(createEngineExhaustParticle(particle, now));
  }

  renderPlayerLayer(layers, snapshot, paddedViewport);

  return {
    terrainRebuilt,
    terrainSprites: layers.terrainLayer.children.length,
    dynamicObjects: layers.dynamicLayer.children.length + layers.playerLayer.children.length,
    fogObjects: layers.fogLayer.children.length,
    exhaustParticles: exhaustParticles.length,
    effects: worldEffects.active.length
  };
}

// Creates or returns the retained child layers owned by this world container.
function getRenderLayerState(worldLayer: PixiContainer): RenderLayerState {
  const existing = renderLayerStates.get(worldLayer);
  if (existing) {
    return existing;
  }

  clearLayer(worldLayer);
  const terrainLayer = new Container();
  const dynamicLayer = new Container();
  const playerLayer = new Container();
  const fogLayer = new Container();
  const groundEffects = new Graphics();
  const airEffects = new Graphics();
  worldLayer.addChild(terrainLayer, groundEffects, dynamicLayer, playerLayer, airEffects, fogLayer);

  const created = {
    terrainLayer,
    groundEffects,
    airEffects,
    dynamicLayer,
    playerLayer,
    fogLayer,
    terrainKey: null,
    terrainMapId: null,
    terrainSprites: new Map<string, TerrainSpriteRecord>(),
    playerDisplays: new Map<string, PlayerDisplayRecord>()
  };
  renderLayerStates.set(worldLayer, created);
  return created;
}

// Rebuilds expensive static terrain/fog only when the authoritative snapshot changes.
function refreshTerrainLayer(layers: RenderLayerState, snapshot: SnapshotMessage, viewport: WorldViewport, now: number): boolean {
  const terrainKey = createTerrainRenderKey(snapshot);
  if (layers.terrainKey === terrainKey) {
    return false;
  }

  const terrainCells = buildTerrainCellMap(snapshot, viewport);
  syncTerrainLayer(layers, snapshot.mapId, terrainCells);
  clearLayer(layers.fogLayer);

  const fogOverlay = createVisibilityOverlay(snapshot, viewport);
  if (fogOverlay) {
    layers.fogLayer.addChild(fogOverlay);
  }

  layers.terrainKey = terrainKey;
  return true;
}

// Snapshot tick changes only when fresh server state arrives, avoiding per-frame terrain churn.
function createTerrainRenderKey(snapshot: SnapshotMessage): string {
  return `${snapshot.mapId}:${snapshot.tick}`;
}

// Draws visible and remembered terrain cells into a retained static layer.
function syncTerrainLayer(layers: RenderLayerState, mapId: string, cells: Map<string, TerrainCellRecord>): void {
  if (layers.terrainMapId !== mapId) {
    clearLayer(layers.terrainLayer);
    layers.terrainSprites.clear();
    layers.terrainMapId = mapId;
  }

  const nextKeys = new Set(cells.keys());
  for (const [cellKey, existing] of layers.terrainSprites.entries()) {
    if (nextKeys.has(cellKey)) {
      continue;
    }
    existing.sprite.parent?.removeChild(existing.sprite);
    existing.sprite.destroy(transientDisplayDestroyOptions);
    layers.terrainSprites.delete(cellKey);
  }

  for (const [cellKey, cell] of cells.entries()) {
    const existing = layers.terrainSprites.get(cellKey);
    if (existing && existing.renderKey === cell.renderKey) {
      existing.sprite.position.set(cell.spriteX, cell.spriteY);
      continue;
    }

    if (existing) {
      applyTerrainSpriteCell(existing.sprite, cell);
      existing.renderKey = cell.renderKey;
      continue;
    }

    const sprite = new Sprite(getTerrainTexture(cell.value, cell.variant));
    sprite.width = terrainSpriteSize;
    sprite.height = terrainSpriteSize;
    applyTerrainSpriteCell(sprite, cell);
    layers.terrainLayer.addChild(sprite);
    layers.terrainSprites.set(cellKey, {
      renderKey: cell.renderKey,
      sprite
    });
  }
}

function applyTerrainSpriteCell(sprite: Sprite, cell: TerrainCellRecord): void {
  sprite.texture = getTerrainTexture(cell.value, cell.variant);
  sprite.position.set(cell.spriteX, cell.spriteY);
  const material = getTerrainMaterialDefinition(cell.value);
  sprite.tint = material.tint ?? 0xffffff;
  sprite.alpha = material.renderAlpha;
  if (cell.visibility === 1) {
    // Remembered cells are tinted and dimmed to distinguish fog-of-war memory from live vision.
    sprite.tint = material.rememberedTint;
    sprite.alpha *= 0.7;
  }
}

// Updates retained player displays in place so normal motion does not allocate new ship/label objects.
function renderPlayerLayer(layers: RenderLayerState, snapshot: SnapshotMessage, viewport: WorldViewport): void {
  const visiblePlayerIds = new Set<string>();

  for (const player of snapshot.players) {
    if (!isPointInViewport(player.position.x, player.position.y, viewport)) {
      continue;
    }

    visiblePlayerIds.add(player.id);
    const isSelf = player.playerId === snapshot.selfPlayerId;
    const visualKey = createPlayerVisualKey(player, isSelf);
    let record = layers.playerDisplays.get(player.id);
    if (!record || record.visualKey !== visualKey) {
      if (record) {
        destroyPlayerDisplayRecord(record);
        layers.playerDisplays.delete(player.id);
      }
      record = createPlayerDisplayRecord(player, isSelf, visualKey);
      layers.playerDisplays.set(player.id, record);
      layers.playerLayer.addChild(record.ship, record.hullBack, record.hullFill, record.label);
    }

    updatePlayerDisplayRecord(record, player, isSelf);
  }

  for (const [playerId, record] of layers.playerDisplays.entries()) {
    if (visiblePlayerIds.has(playerId)) {
      continue;
    }
    destroyPlayerDisplayRecord(record);
    layers.playerDisplays.delete(playerId);
  }
}

function createPlayerDisplayRecord(player: PlayerSnapshot, isSelf: boolean, visualKey: string): PlayerDisplayRecord {
  const ship = createPlayerShipDisplay(player.hullId, player.modules, player.shipId, isSelf);
  const hullBack = new Graphics();
  const hullFill = new Graphics();
  const label = new Text({
    text: isSelf ? "You" : "Ally",
    style: { fontSize: 12, fill: 0xe9f2ff }
  });
  hullBack.alpha = 0.9;
  hullFill.alpha = 0.92;
  return {
    visualKey,
    ship,
    hullBack,
    hullFill,
    label
  };
}

function updatePlayerDisplayRecord(record: PlayerDisplayRecord, player: PlayerSnapshot, isSelf: boolean): void {
  record.ship.position.set(player.position.x, player.position.y);
  record.ship.rotation = player.rotation;

  const hullRatio = Math.max(0, Math.min(1, player.hull / Math.max(1, player.maxHull)));
  record.hullBack.clear();
  record.hullBack.rect(player.position.x - 16, player.position.y + 20, 32, 4).fill(0x071018);

  record.hullFill.clear();
  record.hullFill.rect(player.position.x - 16, player.position.y + 20, Math.max(2, 32 * hullRatio), 4).fill(isSelf ? 0x73f3ca : 0xbecbda);

  record.label.text = isSelf ? "You" : "Ally";
  record.label.position.set(player.position.x - 12, player.position.y - 30);
}

function destroyPlayerDisplayRecord(record: PlayerDisplayRecord): void {
  record.ship.parent?.removeChild(record.ship);
  record.hullBack.parent?.removeChild(record.hullBack);
  record.hullFill.parent?.removeChild(record.hullFill);
  record.label.parent?.removeChild(record.label);
  record.ship.destroy(transientDisplayDestroyOptions);
  record.hullBack.destroy();
  record.hullFill.destroy();
  record.label.destroy();
}

function createPlayerVisualKey(player: PlayerSnapshot, isSelf: boolean): string {
  const moduleKey = player.modules
    .map((module) => `${module.hardpointId}:${module.moduleId}`)
    .sort()
    .join("|");
  return `${player.shipId}:${player.hullId}:${isSelf ? "self" : "other"}:${moduleKey}`;
}

// Expands the viewport by a fixed padding so culling does not pop at the screen edge.
function padViewport(viewport: WorldViewport, padding: number): WorldViewport {
  return {
    x: viewport.x - padding,
    y: viewport.y - padding,
    width: viewport.width + padding * 2,
    height: viewport.height + padding * 2
  };
}

// Checks whether a world-space point falls within the current padded viewport.
function isPointInViewport(x: number, y: number, viewport: WorldViewport): boolean {
  return x >= viewport.x && y >= viewport.y && x <= viewport.x + viewport.width && y <= viewport.y + viewport.height;
}

// Checks whether a world-space rectangle intersects the current padded viewport.
function isRectInViewport(x: number, y: number, width: number, height: number, viewport: WorldViewport): boolean {
  return x + width >= viewport.x && y + height >= viewport.y && x <= viewport.x + viewport.width && y <= viewport.y + viewport.height;
}

// Clears a layer's display objects so Text/Graphics GPU resources do not accumulate over time.
function clearLayer(layer: PixiContainer): void {
  const removedChildren = layer.removeChildren();
  for (const child of removedChildren) {
    child.destroy(transientDisplayDestroyOptions);
  }
}

// Builds a keyed map of currently non-empty terrain cells for destruction effects and sprite reuse.
function buildTerrainCellMap(snapshot: SnapshotMessage, viewport: WorldViewport): Map<string, TerrainCellRecord> {
  const cells = new Map<string, TerrainCellRecord>();
  for (const chunk of snapshot.chunks) {
    chunk.cells.forEach((cell, index) => {
      const cellVisibility = chunk.visibility[index] ?? 0;
      if (cellVisibility === 0 || isEmptyTerrainCell(cell)) {
        return;
      }
      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const tileX = (chunk.chunkX * 8 + localX) * terrainTileSize;
      const tileY = (chunk.chunkY * 8 + localY) * terrainTileSize;
      const spriteX = tileX - terrainSpriteInset;
      const spriteY = tileY - terrainSpriteInset;
      if (!isRectInViewport(spriteX, spriteY, terrainSpriteSize, terrainSpriteSize, viewport)) {
        return;
      }
      const variant = selectTerrainVariant({
        mapId: snapshot.mapId,
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        cellIndex: index,
        cellType: cell
      });
      cells.set(`${chunk.chunkX}:${chunk.chunkY}:${index}`, {
        value: cell,
        x: tileX + terrainTileSize / 2,
        y: tileY + terrainTileSize / 2,
        spriteX,
        spriteY,
        visibility: cellVisibility,
        variant,
        renderKey: `${cell}:${cellVisibility}:${variant}`
      });
    });
  }
  return cells;
}

// Removes old exhaust particles and advances surviving particles between authoritative snapshots.
function pruneExhaustParticles(now: number): void {
  const nextParticles = exhaustParticles.filter((particle) => {
    if (now - particle.createdAt > exhaustParticleLifetimeMs) {
      return false;
    }
    particle.x += particle.velocity.x * (1 / 60);
    particle.y += particle.velocity.y * (1 / 60);
    particle.velocity.x *= 0.985;
    particle.velocity.y *= 0.985;
    return true;
  });
  exhaustParticles.length = 0;
  exhaustParticles.push(...nextParticles.slice(-maxExhaustParticles));
}

// Drops exhaust timer entries for ships no longer present in the visibility-filtered snapshot.
function pruneExhaustSpawnTimers(snapshot: SnapshotMessage): void {
  const visiblePlayerIds = new Set(snapshot.players.map((player) => player.id));
  for (const playerId of lastExhaustSpawnByPlayer.keys()) {
    if (!visiblePlayerIds.has(playerId)) {
      lastExhaustSpawnByPlayer.delete(playerId);
    }
  }
}

// Draws one effect frame into a shared Graphics. Each kind is a handful of circles and shards whose
// directions come from the effect's seed, so every frame of one effect is consistent.
function drawWorldEffect(graphics: Graphics, effect: ActiveEffect, now: number): void {
  const age = Math.min(1, Math.max(0, (now - effect.startedAt) / effect.lifetimeMs));
  switch (effect.kind) {
    case "dust":
      drawDustCloud(graphics, effect, age);
      return;
    case "rockBurst":
      drawRockBurst(graphics, effect, age);
      return;
    case "explosion":
      drawExplosion(graphics, effect, age);
      return;
  }
}

// Mining finished: soft puffs billow out from the cell and settle, with a little grit thrown sideways.
function drawDustCloud(graphics: Graphics, effect: ActiveEffect, age: number): void {
  const ease = 1 - (1 - age) ** 3;
  const fade = (1 - age) ** 1.4;
  const reach = effect.radius * 0.9;
  const puffColor = mixColor(effect.tint, 0x8a7c6c, 0.45);
  for (let index = 0; index < 8; index += 1) {
    const seed = effect.seed + index * 131;
    const angle = effectRandom(seed) * Math.PI * 2;
    const travel = reach * (0.35 + 0.65 * effectRandom(seed + 7)) * ease;
    const size = effect.radius * (0.28 + 0.22 * effectRandom(seed + 13)) * (0.6 + 0.8 * ease);
    graphics
      .circle(effect.x + Math.cos(angle) * travel, effect.y + Math.sin(angle) * travel - age * 4, size)
      .fill({ color: puffColor, alpha: 0.32 * fade });
  }
  graphics.circle(effect.x, effect.y, effect.radius * (0.4 + 0.5 * ease)).fill({ color: puffColor, alpha: 0.22 * fade });
  for (let index = 0; index < 6; index += 1) {
    const seed = effect.seed + index * 977;
    const angle = effectRandom(seed) * Math.PI * 2;
    const travel = effect.radius * (0.6 + 0.9 * effectRandom(seed + 3)) * ease;
    graphics
      .circle(effect.x + Math.cos(angle) * travel, effect.y + Math.sin(angle) * travel, 1.3)
      .fill({ color: effect.tint, alpha: 0.8 * (1 - age) });
  }
}

// Weapon fire broke a block: a quick shock ring and rock shards flung outward (the old terrain burst).
function drawRockBurst(graphics: Graphics, effect: ActiveEffect, age: number): void {
  const fade = 1 - age;
  graphics
    .circle(effect.x, effect.y, 8 + age * 16)
    .stroke({ color: effect.tint, width: Math.max(1, 3 * fade), alpha: 0.45 * fade });
  graphics.circle(effect.x, effect.y, 4 + age * 10).fill({ color: effect.tint, alpha: 0.12 * fade });
  for (let index = 0; index < 7; index += 1) {
    const seed = effect.seed + index * 83;
    const angle = effectRandom(seed) * Math.PI * 2;
    const travel = 4 + age * (12 + 10 * effectRandom(seed + 5));
    drawShard(graphics, effect.x + Math.cos(angle) * travel, effect.y + Math.sin(angle) * travel, angle + age * 5, 2.4, effect.tint, 0.8 * fade);
  }
}

// Something blew up: a white flash, an expanding fireball, a shockwave out to the blast radius, embers,
// and darker smoke that lingers after the fire is gone. The tint colours the shockwave and embers.
function drawExplosion(graphics: Graphics, effect: ActiveEffect, age: number): void {
  const radius = effect.radius;
  const ease = 1 - (1 - age) ** 3;

  // Smoke first so the fire draws over it.
  for (let index = 0; index < 7; index += 1) {
    const seed = effect.seed + index * 211;
    const angle = effectRandom(seed) * Math.PI * 2;
    const travel = radius * (0.25 + 0.45 * effectRandom(seed + 1)) * ease;
    const size = radius * (0.22 + 0.18 * effectRandom(seed + 2)) * (0.5 + ease);
    const smokeAlpha = 0.38 * Math.min(1, age * 4) * (1 - age);
    graphics
      .circle(effect.x + Math.cos(angle) * travel, effect.y + Math.sin(angle) * travel, size)
      .fill({ color: 0x2e2a2a, alpha: smokeAlpha });
  }

  // Fireball: grows fast, burns out by about 60% of the lifetime.
  const fire = Math.max(0, 1 - age / 0.6);
  if (fire > 0) {
    // Each layer is a cluster of offset lobes rather than one circle, so the fireball reads as billowing
    // flame instead of a bullseye. The effect tint bleeds into the outer flame (cyan for crystals).
    const fireRadius = radius * (0.25 + 0.4 * ease);
    const layers: Array<[number, number, number]> = [
      [mixColor(0xff6a2a, effect.tint, 0.3), 0.62, 0.45],
      [mixColor(0xffb347, effect.tint, 0.15), 0.42, 0.6],
      [0xfff1c4, 0.24, 0.8]
    ];
    for (const [layerIndex, [color, lobeScale, alpha]] of layers.entries()) {
      for (let lobe = 0; lobe < 5; lobe += 1) {
        const seed = effect.seed + layerIndex * 1009 + lobe * 37;
        const angle = effectRandom(seed) * Math.PI * 2;
        const offset = fireRadius * (0.15 + 0.3 * effectRandom(seed + 1)) * (1 - layerIndex * 0.35);
        const lobeRadius = fireRadius * lobeScale * (0.8 + 0.4 * effectRandom(seed + 2));
        graphics
          .circle(effect.x + Math.cos(angle) * offset, effect.y + Math.sin(angle) * offset, lobeRadius)
          .fill({ color, alpha: alpha * fire * (layerIndex === 2 ? fire : 1) });
      }
    }
  }

  // Initial flash.
  const flash = Math.max(0, 1 - age / 0.15);
  if (flash > 0) {
    graphics.circle(effect.x, effect.y, radius * 0.55).fill({ color: 0xffffff, alpha: 0.6 * flash });
  }

  // Shockwave ring out to the full blast radius.
  const ringFade = 1 - age;
  graphics
    .circle(effect.x, effect.y, radius * (0.3 + 0.75 * ease))
    .stroke({ color: mixColor(effect.tint, 0xffffff, 0.35), width: Math.max(1, 4 * ringFade), alpha: 0.55 * ringFade });

  // Embers and debris shards.
  for (let index = 0; index < 12; index += 1) {
    const seed = effect.seed + index * 59;
    const angle = effectRandom(seed) * Math.PI * 2;
    const travel = radius * (0.35 + 0.85 * effectRandom(seed + 3)) * ease;
    const px = effect.x + Math.cos(angle) * travel;
    const py = effect.y + Math.sin(angle) * travel;
    if (index % 3 === 0) {
      drawShard(graphics, px, py, angle + age * 6, 2.6, 0x5b524a, 0.9 * (1 - age));
    } else {
      graphics.circle(px, py, 1.6 * (1 - age) + 0.6).fill({ color: index % 2 ? 0xffd27a : effect.tint, alpha: 0.95 * (1 - age) });
    }
  }
}

// A small rotated rectangle drawn as a polygon so many shards share one Graphics.
function drawShard(graphics: Graphics, x: number, y: number, rotation: number, size: number, color: number, alpha: number): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const halfW = size;
  const halfH = size * 0.5;
  const points = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH]
  ].flatMap(([dx, dy]) => [x + dx * cos - dy * sin, y + dx * sin + dy * cos]);
  graphics.poly(points).fill({ color, alpha });
}

// Well-mixed hash to [0, 1) (murmur3 finalizer). Effect particles use neighbouring seeds, which a
// single xorshift round maps to nearly the same value, so they need a stronger mix.
function effectRandom(seed: number): number {
  let value = seed >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

// Linear blend of two 0xRRGGBB colours.
function mixColor(from: number, to: number, amount: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

// Emits a small plume behind ships that are moving forward along their facing direction.
function spawnEngineExhaust(player: PlayerSnapshot, now: number, forceForwardThrust = false): void {
  if (!hasEngineModule(player)) {
    return;
  }
  const lastSpawnAt = lastExhaustSpawnByPlayer.get(player.id) ?? 0;
  if (now - lastSpawnAt < exhaustSpawnIntervalMs) {
    return;
  }

  const facing = {
    x: Math.cos(player.rotation),
    y: Math.sin(player.rotation)
  };
  const inferredForwardSpeed = player.velocity.x * facing.x + player.velocity.y * facing.y;
  const forwardSpeed = forceForwardThrust ? Math.max(inferredForwardSpeed, 42) : inferredForwardSpeed;
  if (forwardSpeed < minimumExhaustForwardSpeed) {
    return;
  }

  lastExhaustSpawnByPlayer.set(player.id, now);
  const speedIntensity = Math.min(1, forwardSpeed / 85);
  const seed = hashString(`${player.id}:${Math.floor(now / exhaustSpawnIntervalMs)}:${Math.round(player.position.x)}:${Math.round(player.position.y)}`);
  const particleCount = 1 + Math.floor(speedIntensity);
  const side = { x: -facing.y, y: facing.x };

  for (let index = 0; index < particleCount; index += 1) {
    const particleSeed = seed + index * 97;
    const jitter = randomSigned(particleSeed) * 5.5;
    const rearDistance = 30 + randomUnit(particleSeed + 11) * 5;
    const plumeSpeed = 34 + speedIntensity * 52 + randomUnit(particleSeed + 23) * 20;
    const sideVelocity = randomSigned(particleSeed + 31) * (10 + speedIntensity * 12);

    exhaustParticles.push({
      x: player.position.x - facing.x * rearDistance + side.x * jitter,
      y: player.position.y - facing.y * rearDistance + side.y * jitter,
      velocity: {
        x: -facing.x * plumeSpeed + side.x * sideVelocity + player.velocity.x * 0.08,
        y: -facing.y * plumeSpeed + side.y * sideVelocity + player.velocity.y * 0.08
      },
      createdAt: now,
      seed: particleSeed,
      intensity: speedIntensity
    });
  }

  if (exhaustParticles.length > maxExhaustParticles) {
    exhaustParticles.splice(0, exhaustParticles.length - maxExhaustParticles);
  }
}

// Creates one exhaust ember/smoke mote with a hot core that fades into blue vapor.
function createEngineExhaustParticle(particle: ExhaustParticle, now: number): Container {
  const age = Math.min(1, (now - particle.createdAt) / exhaustParticleLifetimeMs);
  const fade = 1 - age;
  const flicker = 0.5 + randomUnit(particle.seed + Math.floor(now / 35)) * 0.5;
  const size = (2.8 + randomUnit(particle.seed + 7) * 2.2 + particle.intensity * 3.2) * (0.55 + age * 1.15);
  const container = new Container();
  container.position.set(particle.x, particle.y);

  const smoke = new Graphics();
  smoke.ellipse(0, 0, size * 1.9, size * 1.1).fill(age > 0.45 ? 0x6d7d8f : 0x258ad9);
  smoke.alpha = (age > 0.45 ? 0.14 : 0.2) * fade * particle.intensity;
  container.addChild(smoke);

  const glow = new Graphics();
  glow.circle(0, 0, size * 1.1).fill(0x28cfff);
  glow.alpha = 0.18 * fade * flicker;
  container.addChild(glow);

  const core = new Graphics();
  core.circle(0, 0, Math.max(1, size * 0.38)).fill(age < 0.35 ? 0xf8fbff : 0x82e9ff);
  core.alpha = 0.72 * fade * flicker;
  container.addChild(core);

  return container;
}

// Checks for an installed engine without importing client-only visual catalog data.
function hasEngineModule(player: PlayerSnapshot): boolean {
  return player.modules.some((module) => module.hardpointId.toLowerCase().includes("engine") || module.moduleId.toLowerCase().includes("thruster"));
}

// Creates the Pixi projectile glow/trail effect, aligned with the projectile's authoritative velocity.
function createProjectileEffect(projectile: ProjectileSnapshot, now: number): Container {
  // Velocity gives a stable travel angle every frame. Inferring it from frame-to-frame movement flickered,
  // because most render frames reuse the same snapshot position and fell back to a random angle.
  const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
  const fallbackAngle = ((hashString(projectile.id) % 360) * Math.PI) / 180;
  const angle = speed > 1 ? Math.atan2(projectile.velocity.y, projectile.velocity.x) : fallbackAngle;
  const pulse = 0.5 + 0.5 * Math.sin(now / 80 + hashString(projectile.id) * 0.03);
  // Trail length matches 1/10 s of travel, the look the old per-snapshot delta produced at 10 Hz snapshots.
  const trailLength = Math.max(10, Math.min(30, (speed / 10) * 2.4 + 10));
  // Enemy fire is drawn in hot red/orange so incoming bolts read differently from the player's blue pulses.
  const palette = projectile.hostile
    ? { outer: 0xff4a2a, streak: 0xffe2c8, glow: 0xff7a3a, core: 0xfff4e8 }
    : { outer: 0x2aa8ff, streak: 0xeefaff, glow: 0x4bcfff, core: 0xf8fdff };

  // The projectile is drawn in local space and rotated to align with travel direction.
  const container = new Container();
  container.position.set(projectile.position.x, projectile.position.y);
  container.rotation = angle;

  const outerGlow = new Graphics();
  outerGlow.ellipse(-trailLength * 0.42, 0, trailLength * 0.6, 4.6 + pulse * 1.2).fill(palette.outer);
  outerGlow.alpha = 0.15 + pulse * 0.08;
  container.addChild(outerGlow);

  const innerStreak = new Graphics();
  innerStreak.ellipse(-trailLength * 0.3, 0, trailLength * 0.34, 1.5 + pulse * 0.5).fill(palette.streak);
  innerStreak.alpha = 0.88;
  container.addChild(innerStreak);

  const coreGlow = new Graphics();
  coreGlow.circle(0, 0, 6 + pulse * 1.6).fill(palette.glow);
  coreGlow.alpha = 0.18 + pulse * 0.08;
  container.addChild(coreGlow);

  const core = new Graphics();
  core.circle(0, 0, 2.5 + pulse * 0.7).fill(palette.core);
  core.alpha = 0.98;
  container.addChild(core);

  return container;
}

// Produces a deterministic unsigned hash for effect variation.
function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function randomUnit(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0xffffffff;
}

function randomSigned(seed: number): number {
  return randomUnit(seed) * 2 - 1;
}

// Creates fog-of-war overlay geometry for remembered terrain cells.
function createVisibilityOverlay(snapshot: SnapshotMessage, viewport: WorldViewport): Container | null {
  const memoryFog = new Graphics();
  let hasRememberedTiles = false;

  // Hidden/unexplored tiles are not drawn; the dark game background already represents unknown space.
  for (const chunk of snapshot.chunks) {
    chunk.visibility.forEach((cellVisibility, index) => {
      if (cellVisibility !== 1) {
        return;
      }

      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const x = (chunk.chunkX * 8 + localX) * terrainTileSize;
      const y = (chunk.chunkY * 8 + localY) * terrainTileSize;
      if (!isRectInViewport(x, y, terrainTileSize, terrainTileSize, viewport)) {
        return;
      }
      memoryFog.rect(x, y, terrainTileSize, terrainTileSize).fill(0x0b1218);
      hasRememberedTiles = true;
    });
  }

  if (!hasRememberedTiles) {
    return null;
  }

  const container = new Container();
  memoryFog.alpha = 0.42;
  container.addChild(memoryFog);
  return container;
}

// Exit marker colors: locked (red), uncharted deeper exit (amber), charted deeper exit (cyan), way back up (green).
const exitColors = { locked: 0xff6b5b, uncharted: 0xffc857, charted: 0x5bd7ff, ascend: 0x7ee08a };

// Returns the short label shown on an exit marker.
export function describeExit(exit: ExitSnapshot): string {
  if (exit.direction === "ascend") {
    return "Way back up";
  }
  if (exit.locked) {
    return "Exit locked";
  }
  return exit.discovered ? "Descend" : "Uncharted depths";
}

// Draws a pulsing ring at a map exit, with its label and the interact prompt when the ship is in range.
function createExitDisplay(exit: ExitSnapshot, nearby: boolean, now: number): Container {
  const color =
    exit.direction === "ascend" ? exitColors.ascend : exit.locked ? exitColors.locked : exit.discovered ? exitColors.charted : exitColors.uncharted;
  const pulse = 0.5 + 0.5 * Math.sin(now / 380);
  const container = new Container();
  container.position.set(exit.position.x, exit.position.y);

  const ring = new Graphics();
  ring.circle(0, 0, 22).fill({ color, alpha: 0.12 + 0.1 * pulse });
  ring.circle(0, 0, 22).stroke({ color, width: 2, alpha: 0.85 });
  ring.circle(0, 0, 13 + 4 * pulse).stroke({ color, width: 1.5, alpha: 0.6 });
  container.addChild(ring);

  const label = new Text({
    text: nearby && !exit.locked ? `${describeExit(exit)} [E]` : describeExit(exit),
    style: { fontSize: 12, fill: color }
  });
  label.anchor.set(0.5, 1);
  // Sits above the ship's own name label when the ship is parked on the exit.
  label.position.set(0, -40);
  container.addChild(label);
  return container;
}

// Produces the current objective sentence from progression and visible foundry state.
function describeObjective(snapshot: SnapshotMessage): string {
  const activeFoundry = snapshot.foundries.find((foundry) => foundry.active);
  if (!snapshot.deeperPathUnlocked) {
    if (activeFoundry) {
      return "Destroy the active enemy foundry to unlock the deeper route.";
    }
    if (snapshot.mapId !== "map-root") {
      return "A foundry seals the way deeper. Find it and destroy it.";
    }
    return "Push through the root sector and locate the foundry objective.";
  }

  if (snapshot.mapId === "map-root") {
    return "The deeper route is open. Fly to the exit and press E to descend.";
  }

  const deeperExit = snapshot.exits.find((exit) => exit.direction === "descend");
  if (deeperExit && !deeperExit.discovered) {
    return "An uncharted exit leads deeper. Fly to it and press E to chart a new cavern.";
  }
  return "Hold the cavern, gather salvage, and push deeper when the fleet is ready.";
}

// Produces the HUD line for the exit the ship is close enough to use, if any.
function describeNearbyExit(snapshot: SnapshotMessage): string {
  const exit = snapshot.exits.find((entry) => entry.connectionId === snapshot.nearbyExitId);
  return exit ? `${describeExit(exit)}${exit.locked ? "" : " (press E)"}` : "no";
}

// Produces foundry health/defender status copy for the HUD.
function describeFoundryStatus(snapshot: SnapshotMessage): string {
  const activeFoundry = snapshot.foundries.find((foundry) => foundry.active);
  if (activeFoundry) {
    return `Foundry integrity: ${activeFoundry.health} | defenders: ${activeFoundry.activeEnemyCount}/${activeFoundry.spawnCap}`;
  }
  if (snapshot.foundries.length > 0) {
    return "Foundry status: destroyed";
  }
  return "Foundry status: none on this map";
}
