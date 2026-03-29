import { selectTerrainVariant, type SnapshotMessage } from "@healer/shared";
import { Graphics, Sprite, Text, type Container } from "pixi.js";
import { getTerrainTexture } from "./terrainAssets.js";

const terrainTileSize = 32;
const terrainSpriteSize = 46;
const terrainSpriteInset = (terrainSpriteSize - terrainTileSize) / 2;

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
      <div>Controls: WASD move, left click weapon, right click mine, space repair, E interact</div>
      <div>Selection: 1 cycle weapon, 2 cycle mining, 3 cycle support</div>
    </div>
  `;
}

export function renderWorld(worldLayer: Container, snapshot: SnapshotMessage): void {
  worldLayer.removeChildren();

  for (const chunk of snapshot.chunks) {
    chunk.cells.forEach((cell, index) => {
      if (cell === 0) {
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
      worldLayer.addChild(sprite);
    });
  }

  for (const structure of snapshot.structures) {
    const graphic = new Graphics();
    graphic.rect(structure.position.x - 18, structure.position.y - 18, 36, 36).fill(structure.structureTypeId === "builder-site" ? 0x73f3ca : 0x8896a8);
    worldLayer.addChild(graphic);
  }

  for (const foundry of snapshot.foundries) {
    const graphic = new Graphics();
    graphic.rect(foundry.position.x - 22, foundry.position.y - 22, 44, 44).fill(foundry.active ? 0xff7e6b : 0x5d6775);
    worldLayer.addChild(graphic);

    const statusLabel = new Text({
      text: foundry.active ? `Foundry ${foundry.health} HP` : "Foundry Down",
      style: { fontSize: 12, fill: foundry.active ? 0xffd7cf : 0xb6c0cc }
    });
    statusLabel.position.set(foundry.position.x - 30, foundry.position.y - 38);
    worldLayer.addChild(statusLabel);
  }

  for (const drop of snapshot.drops) {
    const graphic = new Graphics();
    graphic.circle(drop.position.x, drop.position.y, 5).fill(0xffd86f);
    worldLayer.addChild(graphic);
  }

  for (const enemy of snapshot.enemies) {
    const graphic = new Graphics();
    graphic.circle(enemy.position.x, enemy.position.y, 10).fill(0xff5252);
    worldLayer.addChild(graphic);
  }

  for (const player of snapshot.players) {
    const graphic = new Graphics();
    graphic.roundRect(player.position.x - 14, player.position.y - 10, 28, 20, 6).fill(player.playerId === snapshot.selfPlayerId ? 0x49c6ff : 0x9ea7b8);
    worldLayer.addChild(graphic);

    const label = new Text({
      text: player.playerId === snapshot.selfPlayerId ? "You" : "Ally",
      style: { fontSize: 12, fill: 0xe9f2ff }
    });
    label.position.set(player.position.x - 12, player.position.y - 28);
    worldLayer.addChild(label);
  }
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


