import { selectTerrainVariant, type ProjectileSnapshot, type SnapshotMessage } from "@healer/shared";
import { Container, Graphics, Sprite, Text, type Container as PixiContainer } from "pixi.js";
import { createPlayerShipDisplay } from "./playerShipAssets.js";
import { getTerrainTexture } from "./terrainAssets.js";
import { createEnemyDisplay, createFoundryDisplay, createSalvageDisplay, createStructureDisplay } from "./worldEntityAssets.js";

const terrainTileSize = 32;
const terrainSpriteSize = 46;
const terrainSpriteInset = (terrainSpriteSize - terrainTileSize) / 2;
const projectileHistory = new Map<string, { x: number; y: number; seenAt: number }>();
const projectileHistoryTtlMs = 1_500;
const terrainBurstLifetimeMs = 420;
const maxTerrainBursts = 24;
let previousTerrainSnapshot: { mapId: string; cells: Map<string, TerrainCellRecord> } | null = null;
const terrainBursts: TerrainBurst[] = [];

interface TerrainCellRecord {
  value: number;
  x: number;
  y: number;
}

interface TerrainBurst {
  x: number;
  y: number;
  createdAt: number;
  seed: number;
  tint: number;
}

export interface HudSelections {
  weapon: string;
  mining: string;
  support: string;
}

export function renderHud(hud: HTMLElement, snapshot: SnapshotMessage, minimized: boolean, selections: HudSelections): void {
  const inventoryEntries = Object.entries(snapshot.inventory)
    .map(([resource, amount]) => `${resource}: ${amount}`)
    .join("<br/>");
  const objective = describeObjective(snapshot);
  const foundryStatus = describeFoundryStatus(snapshot);

  hud.classList.toggle("minimized", minimized);

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

export function renderWorld(worldLayer: PixiContainer, snapshot: SnapshotMessage): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  pruneProjectileHistory(snapshot.projectiles, now);
  const terrainCells = buildTerrainCellMap(snapshot);
  spawnTerrainBursts(snapshot.mapId, terrainCells, now);
  pruneTerrainBursts(now);
  worldLayer.removeChildren();

  for (const chunk of snapshot.chunks) {
    chunk.cells.forEach((cell, index) => {
      const cellVisibility = chunk.visibility[index] ?? 0;
      if (cellVisibility === 0 || cell === 0) {
        return;
      }
      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const x = (chunk.chunkX * 8 + localX) * terrainTileSize;
      const y = (chunk.chunkY * 8 + localY) * terrainTileSize;
      const variant = selectTerrainVariant({
        mapId: snapshot.mapId,
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        cellIndex: index,
        cellType: cell
      });
      const sprite = new Sprite(getTerrainTexture(variant));
      sprite.position.set(x - terrainSpriteInset, y - terrainSpriteInset);
      sprite.width = terrainSpriteSize;
      sprite.height = terrainSpriteSize;
      sprite.alpha = cell === 1 ? 0.99 : 0.95;
      if (cell === 2) {
        sprite.tint = 0xc4d7e6;
      }
      if (cell >= 3) {
        sprite.tint = 0xb7ccd8;
      }
      if (cellVisibility === 1) {
        sprite.tint = cell === 2 ? 0x8fa3b2 : 0x7f8a95;
        sprite.alpha *= 0.7;
      }
      worldLayer.addChild(sprite);
    });
  }

  for (const burst of terrainBursts) {
    const burstDisplay = createTerrainBurstEffect(burst, now);
    worldLayer.addChild(burstDisplay);
  }

  for (const structure of snapshot.structures) {
    const sprite = createStructureDisplay(structure.structureTypeId);
    sprite.position.set(structure.position.x, structure.position.y);
    worldLayer.addChild(sprite);
  }

  for (const foundry of snapshot.foundries) {
    const sprite = createFoundryDisplay(foundry.active);
    sprite.position.set(foundry.position.x, foundry.position.y);
    worldLayer.addChild(sprite);

    const statusLabel = new Text({
      text: foundry.active ? `Foundry ${foundry.health} HP` : "Foundry Down",
      style: { fontSize: 12, fill: foundry.active ? 0xffd7cf : 0xb6c0cc }
    });
    statusLabel.position.set(foundry.position.x - 30, foundry.position.y - 52);
    worldLayer.addChild(statusLabel);
  }

  for (const drop of snapshot.drops) {
    const sprite = createSalvageDisplay(drop.resources);
    sprite.position.set(drop.position.x, drop.position.y);
    worldLayer.addChild(sprite);
  }

  for (const enemy of snapshot.enemies) {
    const sprite = createEnemyDisplay(enemy.enemyTypeId);
    sprite.position.set(enemy.position.x, enemy.position.y);
    sprite.rotation = enemy.rotation;
    worldLayer.addChild(sprite);
  }

  for (const projectile of snapshot.projectiles) {
    const fx = createProjectileEffect(projectile, now);
    worldLayer.addChild(fx);
    projectileHistory.set(projectile.id, {
      x: projectile.position.x,
      y: projectile.position.y,
      seenAt: now
    });
  }

  for (const player of snapshot.players) {
    const isSelf = player.playerId === snapshot.selfPlayerId;
    const ship = createPlayerShipDisplay(player.hullId, player.modules, player.shipId, isSelf);
    ship.position.set(player.position.x, player.position.y);
    ship.rotation = player.rotation;
    worldLayer.addChild(ship);

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

  const fogOverlay = createVisibilityOverlay(snapshot);
  if (fogOverlay) {
    worldLayer.addChild(fogOverlay);
  }

  previousTerrainSnapshot = {
    mapId: snapshot.mapId,
    cells: terrainCells
  };
}

function buildTerrainCellMap(snapshot: SnapshotMessage): Map<string, TerrainCellRecord> {
  const cells = new Map<string, TerrainCellRecord>();
  for (const chunk of snapshot.chunks) {
    chunk.cells.forEach((cell, index) => {
      if (cell === 0) {
        return;
      }
      const localX = index % 8;
      const localY = Math.floor(index / 8);
      cells.set(`${chunk.chunkX}:${chunk.chunkY}:${index}`, {
        value: cell,
        x: (chunk.chunkX * 8 + localX) * terrainTileSize + terrainTileSize / 2,
        y: (chunk.chunkY * 8 + localY) * terrainTileSize + terrainTileSize / 2
      });
    });
  }
  return cells;
}

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

function pruneTerrainBursts(now: number): void {
  const nextBursts = terrainBursts.filter((burst) => now - burst.createdAt <= terrainBurstLifetimeMs);
  terrainBursts.length = 0;
  terrainBursts.push(...nextBursts.slice(-maxTerrainBursts));
}

function terrainBurstTint(cellValue: number): number {
  if (cellValue === 2) {
    return 0x9ad7ff;
  }
  if (cellValue >= 3) {
    return 0xc6d8e6;
  }
  return 0xb9a48a;
}

function createTerrainBurstEffect(burst: TerrainBurst, now: number): Container {
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

function createProjectileEffect(projectile: ProjectileSnapshot, now: number): Container {
  const previous = projectileHistory.get(projectile.id);
  const deltaX = projectile.position.x - (previous?.x ?? projectile.position.x);
  const deltaY = projectile.position.y - (previous?.y ?? projectile.position.y);
  const travelDistance = Math.hypot(deltaX, deltaY);
  const fallbackAngle = ((hashString(projectile.id) % 360) * Math.PI) / 180;
  const angle = travelDistance > 0.5 ? Math.atan2(deltaY, deltaX) : fallbackAngle;
  const pulse = 0.5 + 0.5 * Math.sin(now / 80 + hashString(projectile.id) * 0.03);
  const trailLength = Math.max(10, Math.min(30, travelDistance * 2.4 + 10));

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

function pruneProjectileHistory(projectiles: ProjectileSnapshot[], now: number): void {
  const activeIds = new Set(projectiles.map((projectile) => projectile.id));
  for (const [projectileId, entry] of projectileHistory.entries()) {
    if (!activeIds.has(projectileId) || now - entry.seenAt > projectileHistoryTtlMs) {
      projectileHistory.delete(projectileId);
    }
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function createVisibilityOverlay(snapshot: SnapshotMessage): Container | null {
  const hiddenFog = new Graphics();
  const memoryFog = new Graphics();
  let hasHiddenTiles = false;
  let hasRememberedTiles = false;

  for (const chunk of snapshot.chunks) {
    chunk.visibility.forEach((cellVisibility, index) => {
      if (cellVisibility === 2) {
        return;
      }

      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const x = (chunk.chunkX * 8 + localX) * terrainTileSize;
      const y = (chunk.chunkY * 8 + localY) * terrainTileSize;
      if (cellVisibility === 1) {
        memoryFog.rect(x, y, terrainTileSize, terrainTileSize).fill(0x0b1218);
        hasRememberedTiles = true;
        return;
      }

      hiddenFog.rect(x, y, terrainTileSize, terrainTileSize).fill(0x02060b);
      hasHiddenTiles = true;
    });
  }

  if (!hasHiddenTiles && !hasRememberedTiles) {
    return null;
  }

  const container = new Container();
  if (hasRememberedTiles) {
    memoryFog.alpha = 0.42;
    container.addChild(memoryFog);
  }
  if (hasHiddenTiles) {
    hiddenFog.alpha = 0.9;
    container.addChild(hiddenFog);
  }
  return container;
}

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
