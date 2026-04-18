import { getTerrainMaterialDefinition, isEmptyTerrainCell, selectTerrainVariant, type PlayerSnapshot, type ProjectileSnapshot, type SnapshotMessage } from "@healer/shared";
import { Container, Graphics, Sprite, Text, type Container as PixiContainer } from "pixi.js";
import { createPlayerShipDisplay } from "./playerShipAssets.js";
import { getTerrainTexture } from "./terrainAssets.js";
import { createEnemyDisplay, createFoundryDisplay, createSalvageDisplay, createStructureDisplay } from "./worldEntityAssets.js";

// Viewport padding keeps nearby off-screen objects ready as the camera moves between snapshots.
const viewportPadding = 160;
// Terrain tile size matches the server's terrain cell size in world-space pixels.
const terrainTileSize = 32;
// Terrain sprites are intentionally larger than a tile to overlap and soften grid edges.
const terrainSpriteSize = 46;
const terrainSpriteInset = (terrainSpriteSize - terrainTileSize) / 2;
// Projectile history stores previous positions so projectile effects can draw directional trails.
const projectileHistory = new Map<string, { x: number; y: number; seenAt: number }>();
const projectileHistoryTtlMs = 1_500;
// Terrain bursts are short-lived effects emitted when a previously visible cell disappears.
const terrainBurstLifetimeMs = 420;
const maxTerrainBursts = 24;
// Engine exhaust particles trail from thrusting ships and are retained between redraws.
const exhaustParticleLifetimeMs = 520;
const exhaustSpawnIntervalMs = 70;
const maxExhaustParticles = 72;
const minimumExhaustForwardSpeed = 10;
// previousTerrainSnapshot tracks visible terrain cells from the prior render for destruction effects.
let previousTerrainSnapshot: { mapId: string; cells: Map<string, TerrainCellRecord> } | null = null;
const terrainBursts: TerrainBurst[] = [];
const exhaustParticles: ExhaustParticle[] = [];
const lastExhaustSpawnByPlayer = new Map<string, number>();
const renderLayerStates = new WeakMap<PixiContainer, RenderLayerState>();

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
  terrainBursts: number;
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

interface TerrainBurst {
  // x/y are the world-space center where the burst effect should play.
  x: number;
  y: number;
  // createdAt is a performance timestamp used to fade the effect.
  createdAt: number;
  // seed gives each burst deterministic shard directions.
  seed: number;
  // tint is derived from the destroyed terrain material.
  tint: number;
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
  // dynamicLayer is rebuilt every render frame for moving entities and short-lived effects.
  dynamicLayer: Container;
  // playerLayer keeps player ship displays retained between frames to avoid allocation churn.
  playerLayer: Container;
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
      <div>Weapon slot: ${selections.weapon}</div>
      <div>Mining slot: ${selections.mining}</div>
      <div>Support slot: ${selections.support}</div>
      <div>${inventoryEntries}</div>
      <div>Controls: WASD move, Space fire, right click mine, left click repair, E interact</div>
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
  pruneProjectileHistory(snapshot.projectiles, now);
  const terrainRebuilt = refreshTerrainLayer(layers, snapshot, paddedViewport, now);
  pruneTerrainBursts(now);
  pruneExhaustParticles(now);
  pruneExhaustSpawnTimers(snapshot);
  clearLayer(layers.dynamicLayer);

  // Add terrain destruction bursts after terrain so the effects sit above the cells.
  for (const burst of terrainBursts) {
    if (!isPointInViewport(burst.x, burst.y, paddedViewport)) {
      continue;
    }
    const burstDisplay = createTerrainBurstEffect(burst, now);
    layers.dynamicLayer.addChild(burstDisplay);
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
    // Update projectile history after drawing so the next frame can infer trail direction.
    const fx = createProjectileEffect(projectile, now);
    layers.dynamicLayer.addChild(fx);
    projectileHistory.set(projectile.id, {
      x: projectile.position.x,
      y: projectile.position.y,
      seenAt: now
    });
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
    terrainBursts: terrainBursts.length
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
  worldLayer.addChild(terrainLayer, dynamicLayer, playerLayer, fogLayer);

  const created = {
    terrainLayer,
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
  spawnTerrainBursts(snapshot.mapId, terrainCells, now);
  syncTerrainLayer(layers, snapshot.mapId, terrainCells);
  clearLayer(layers.fogLayer);

  const fogOverlay = createVisibilityOverlay(snapshot, viewport);
  if (fogOverlay) {
    layers.fogLayer.addChild(fogOverlay);
  }

  previousTerrainSnapshot = {
    mapId: snapshot.mapId,
    cells: terrainCells
  };
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
    existing.sprite.destroy({ children: true, texture: false, textureSource: false });
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
  record.ship.destroy({ children: true, texture: false, textureSource: false });
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
    child.destroy({ children: true, texture: false, textureSource: false });
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

// Compares the last terrain cell map to the next one and spawns bursts where cells disappeared.
function spawnTerrainBursts(mapId: string, nextCells: Map<string, TerrainCellRecord>, now: number): void {
  if (!previousTerrainSnapshot || previousTerrainSnapshot.mapId !== mapId) {
    return;
  }

  for (const [cellKey, previousCell] of previousTerrainSnapshot.cells.entries()) {
    if (nextCells.has(cellKey)) {
      continue;
    }

    terrainBursts.push({
      x: previousCell.x,
      y: previousCell.y,
      createdAt: now,
      seed: hashString(`${mapId}:${cellKey}:${now}`),
      tint: terrainBurstTint(previousCell.value)
    });
  }
}

// Removes expired terrain bursts and caps retained effects for performance/readability.
function pruneTerrainBursts(now: number): void {
  const nextBursts = terrainBursts.filter((burst) => now - burst.createdAt <= terrainBurstLifetimeMs);
  terrainBursts.length = 0;
  terrainBursts.push(...nextBursts.slice(-maxTerrainBursts));
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

// Chooses burst tint by terrain material value.
function terrainBurstTint(cellValue: number): number {
  return getTerrainMaterialDefinition(cellValue).burstTint;
}

// Creates the Pixi container for one terrain destruction burst.
function createTerrainBurstEffect(burst: TerrainBurst, now: number): Container {
  // age/fade normalize effect animation over its lifetime.
  const age = Math.min(1, (now - burst.createdAt) / terrainBurstLifetimeMs);
  const fade = 1 - age;
  const container = new Container();
  container.position.set(burst.x, burst.y);

  const shock = new Graphics();
  shock.circle(0, 0, 8 + age * 16).stroke({ color: burst.tint, width: Math.max(1, 3 * fade), alpha: 0.45 * fade });
  container.addChild(shock);

  const dust = new Graphics();
  dust.circle(0, 0, 4 + age * 10).fill(burst.tint);
  dust.alpha = 0.12 * fade;
  container.addChild(dust);

  // Shards fan outward from the destroyed terrain cell using deterministic pseudo-random angles.
  for (let index = 0; index < 6; index += 1) {
    const shardSeed = burst.seed + index * 83;
    const angle = ((shardSeed % 360) * Math.PI) / 180;
    const distance = 4 + age * (10 + (shardSeed % 9));
    const shard = new Graphics();
    shard.roundRect(-2.2, -1.1, 4.4, 2.2, 1).fill(burst.tint);
    shard.alpha = 0.75 * fade;
    shard.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.75);
    shard.rotation = angle + age * 2.2;
    container.addChild(shard);
  }

  return container;
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

// Creates the Pixi projectile glow/trail effect from current and previous projectile positions.
function createProjectileEffect(projectile: ProjectileSnapshot, now: number): Container {
  // Previous position gives a real travel angle; fallback angle keeps stationary new projectiles visible.
  const previous = projectileHistory.get(projectile.id);
  const deltaX = projectile.position.x - (previous?.x ?? projectile.position.x);
  const deltaY = projectile.position.y - (previous?.y ?? projectile.position.y);
  const travelDistance = Math.hypot(deltaX, deltaY);
  const fallbackAngle = ((hashString(projectile.id) % 360) * Math.PI) / 180;
  const angle = travelDistance > 0.5 ? Math.atan2(deltaY, deltaX) : fallbackAngle;
  const pulse = 0.5 + 0.5 * Math.sin(now / 80 + hashString(projectile.id) * 0.03);
  const trailLength = Math.max(10, Math.min(30, travelDistance * 2.4 + 10));

  // The projectile is drawn in local space and rotated to align with travel direction.
  const container = new Container();
  container.position.set(projectile.position.x, projectile.position.y);
  container.rotation = angle;

  const outerGlow = new Graphics();
  outerGlow.ellipse(-trailLength * 0.42, 0, trailLength * 0.6, 4.6 + pulse * 1.2).fill(0x2aa8ff);
  outerGlow.alpha = 0.15 + pulse * 0.08;
  container.addChild(outerGlow);

  const innerStreak = new Graphics();
  innerStreak.ellipse(-trailLength * 0.3, 0, trailLength * 0.34, 1.5 + pulse * 0.5).fill(0xeefaff);
  innerStreak.alpha = 0.88;
  container.addChild(innerStreak);

  const coreGlow = new Graphics();
  coreGlow.circle(0, 0, 6 + pulse * 1.6).fill(0x4bcfff);
  coreGlow.alpha = 0.18 + pulse * 0.08;
  container.addChild(coreGlow);

  const core = new Graphics();
  core.circle(0, 0, 2.5 + pulse * 0.7).fill(0xf8fdff);
  core.alpha = 0.98;
  container.addChild(core);

  return container;
}

// Deletes stale projectile history entries once projectiles leave the snapshot or age out.
function pruneProjectileHistory(projectiles: ProjectileSnapshot[], now: number): void {
  const activeIds = new Set(projectiles.map((projectile) => projectile.id));
  for (const [projectileId, entry] of projectileHistory.entries()) {
    if (!activeIds.has(projectileId) || now - entry.seenAt > projectileHistoryTtlMs) {
      projectileHistory.delete(projectileId);
    }
  }
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

// Produces the current objective sentence from progression and visible foundry state.
function describeObjective(snapshot: SnapshotMessage): string {
  const activeFoundry = snapshot.foundries.find((foundry) => foundry.active);
  if (!snapshot.deeperPathUnlocked) {
    if (activeFoundry) {
      return "Destroy the active enemy foundry to unlock the deeper route.";
    }
    return "Push through the root sector and locate the foundry objective.";
  }

  if (snapshot.mapId === "map-root") {
    return "The deeper route is open. Move to the gate and descend when ready.";
  }

  return "Hold the deeper cavern, gather salvage, and keep the fleet supplied.";
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
