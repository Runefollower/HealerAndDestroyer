import { getTerrainMaterialDefinition, isEmptyTerrainCell, selectTerrainVariant, type ProjectileSnapshot, type SnapshotMessage } from "@healer/shared";
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
// previousTerrainSnapshot tracks visible terrain cells from the prior render for destruction effects.
let previousTerrainSnapshot: { mapId: string; cells: Map<string, TerrainCellRecord> } | null = null;
const terrainBursts: TerrainBurst[] = [];

export interface WorldViewport {
  // x/y are the top-left world coordinates currently visible through the camera.
  x: number;
  y: number;
  // width/height are the current screen dimensions in pixels.
  width: number;
  height: number;
}

interface TerrainCellRecord {
  // value is the terrain material value from the snapshot cell.
  value: number;
  // x/y are the world-space center of the terrain cell.
  x: number;
  y: number;
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
export function renderWorld(worldLayer: PixiContainer, snapshot: SnapshotMessage, viewport: WorldViewport): void {
  // Transient visual state is updated before clearing the layer for a fresh snapshot render.
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const paddedViewport = padViewport(viewport, viewportPadding);
  pruneProjectileHistory(snapshot.projectiles, now);
  const terrainCells = buildTerrainCellMap(snapshot, paddedViewport);
  spawnTerrainBursts(snapshot.mapId, terrainCells, now);
  pruneTerrainBursts(now);
  clearWorldLayer(worldLayer);

  // Draw visible and remembered terrain cells before entities.
  for (const chunk of snapshot.chunks) {
    chunk.cells.forEach((cell, index) => {
      const cellVisibility = chunk.visibility[index] ?? 0;
      if (cellVisibility === 0 || isEmptyTerrainCell(cell)) {
        return;
      }
      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const x = (chunk.chunkX * 8 + localX) * terrainTileSize;
      const y = (chunk.chunkY * 8 + localY) * terrainTileSize;
      if (!isRectInViewport(x - terrainSpriteInset, y - terrainSpriteInset, terrainSpriteSize, terrainSpriteSize, paddedViewport)) {
        return;
      }
      const variant = selectTerrainVariant({
        mapId: snapshot.mapId,
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        cellIndex: index,
        cellType: cell
      });
      const sprite = new Sprite(getTerrainTexture(cell, variant));
      sprite.position.set(x - terrainSpriteInset, y - terrainSpriteInset);
      sprite.width = terrainSpriteSize;
      sprite.height = terrainSpriteSize;
      const material = getTerrainMaterialDefinition(cell);
      sprite.alpha = material.renderAlpha;
      if (material.tint !== undefined) {
        sprite.tint = material.tint;
      }
      if (cellVisibility === 1) {
        // Remembered cells are tinted and dimmed to distinguish fog-of-war memory from live vision.
        sprite.tint = material.rememberedTint;
        sprite.alpha *= 0.7;
      }
      worldLayer.addChild(sprite);
    });
  }

  // Add terrain destruction bursts after terrain so the effects sit above the cells.
  for (const burst of terrainBursts) {
    if (!isPointInViewport(burst.x, burst.y, paddedViewport)) {
      continue;
    }
    const burstDisplay = createTerrainBurstEffect(burst, now);
    worldLayer.addChild(burstDisplay);
  }

  // Structures and foundries render before mobile entities so ships/enemies remain readable.
  for (const structure of snapshot.structures) {
    if (!isPointInViewport(structure.position.x, structure.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createStructureDisplay(structure.structureTypeId);
    sprite.position.set(structure.position.x, structure.position.y);
    worldLayer.addChild(sprite);
  }

  for (const foundry of snapshot.foundries) {
    if (!isPointInViewport(foundry.position.x, foundry.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createFoundryDisplay(foundry.active);
    sprite.position.set(foundry.position.x, foundry.position.y);
    worldLayer.addChild(sprite);

    // Foundry status labels expose objective health without requiring a separate HUD entry.
    const statusLabel = new Text({
      text: foundry.active ? `Foundry ${foundry.health} HP` : "Foundry Down",
      style: { fontSize: 12, fill: foundry.active ? 0xffd7cf : 0xb6c0cc }
    });
    statusLabel.position.set(foundry.position.x - 30, foundry.position.y - 52);
    worldLayer.addChild(statusLabel);
  }

  // Drops, enemies, projectiles, and players are all already visibility-filtered by the server.
  for (const drop of snapshot.drops) {
    if (!isPointInViewport(drop.position.x, drop.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createSalvageDisplay(drop.resources);
    sprite.position.set(drop.position.x, drop.position.y);
    worldLayer.addChild(sprite);
  }

  for (const enemy of snapshot.enemies) {
    if (!isPointInViewport(enemy.position.x, enemy.position.y, paddedViewport)) {
      continue;
    }
    const sprite = createEnemyDisplay(enemy.enemyTypeId);
    sprite.position.set(enemy.position.x, enemy.position.y);
    sprite.rotation = enemy.rotation;
    worldLayer.addChild(sprite);
  }

  for (const projectile of snapshot.projectiles) {
    if (!isPointInViewport(projectile.position.x, projectile.position.y, paddedViewport)) {
      continue;
    }
    // Update projectile history after drawing so the next frame can infer trail direction.
    const fx = createProjectileEffect(projectile, now);
    worldLayer.addChild(fx);
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
    // Self ships use stronger accenting than allied ships.
    const isSelf = player.playerId === snapshot.selfPlayerId;
    const ship = createPlayerShipDisplay(player.hullId, player.modules, player.shipId, isSelf);
    ship.position.set(player.position.x, player.position.y);
    ship.rotation = player.rotation;
    worldLayer.addChild(ship);

    // Hull bar is drawn as simple Pixi geometry to keep the world layer self-contained.
    const hullRatio = Math.max(0, Math.min(1, player.hull / Math.max(1, player.maxHull)));
    const hullBack = new Graphics();
    hullBack.rect(player.position.x - 16, player.position.y + 20, 32, 4).fill(0x071018);
    hullBack.alpha = 0.9;
    worldLayer.addChild(hullBack);

    const hullFill = new Graphics();
    hullFill.rect(player.position.x - 16, player.position.y + 20, Math.max(2, 32 * hullRatio), 4).fill(isSelf ? 0x73f3ca : 0xbecbda);
    hullFill.alpha = 0.92;
    worldLayer.addChild(hullFill);

    const label = new Text({
      text: isSelf ? "You" : "Ally",
      style: { fontSize: 12, fill: 0xe9f2ff }
    });
    label.position.set(player.position.x - 12, player.position.y - 30);
    worldLayer.addChild(label);
  }

  // Fog overlay is last so hidden/remembered tiles sit visually above terrain and entities.
  const fogOverlay = createVisibilityOverlay(snapshot, paddedViewport);
  if (fogOverlay) {
    worldLayer.addChild(fogOverlay);
  }

  // Store the terrain state after rendering so the next snapshot can detect removed cells.
  previousTerrainSnapshot = {
    mapId: snapshot.mapId,
    cells: terrainCells
  };
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

// Clears the old snapshot display objects so Text/Graphics GPU resources do not accumulate over time.
function clearWorldLayer(worldLayer: PixiContainer): void {
  const removedChildren = worldLayer.removeChildren();
  for (const child of removedChildren) {
    child.destroy({ children: true, texture: false, textureSource: false });
  }
}

// Builds a keyed map of currently non-empty terrain cells for destruction-effect diffing.
function buildTerrainCellMap(snapshot: SnapshotMessage, viewport: WorldViewport): Map<string, TerrainCellRecord> {
  const cells = new Map<string, TerrainCellRecord>();
  for (const chunk of snapshot.chunks) {
    chunk.cells.forEach((cell, index) => {
      if (isEmptyTerrainCell(cell)) {
        return;
      }
      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const x = (chunk.chunkX * 8 + localX) * terrainTileSize + terrainTileSize / 2;
      const y = (chunk.chunkY * 8 + localY) * terrainTileSize + terrainTileSize / 2;
      if (!isPointInViewport(x, y, viewport)) {
        return;
      }
      cells.set(`${chunk.chunkX}:${chunk.chunkY}:${index}`, {
        value: cell,
        x,
        y
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
