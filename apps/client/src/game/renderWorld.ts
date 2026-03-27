import { Graphics, Text, type Container } from "pixi.js";
import type { SnapshotMessage } from "@healer/shared";

export function renderHud(hud: HTMLElement, snapshot: SnapshotMessage): void {
  const inventoryEntries = Object.entries(snapshot.inventory)
    .map(([resource, amount]) => `${resource}: ${amount}`)
    .join("<br/>");
  hud.innerHTML = `
    <p class="panel-title">Mission HUD</p>
    <div>Map: ${snapshot.mapId}</div>
    <div>Players nearby: ${snapshot.players.length}</div>
    <div>Enemies nearby: ${snapshot.enemies.length}</div>
    <div>Foundries nearby: ${snapshot.foundries.length}</div>
    <div>Builder site nearby: ${snapshot.builderSiteNearby ? "yes" : "no"}</div>
    <div>Deeper path unlocked: ${snapshot.deeperPathUnlocked ? "yes" : "destroy the foundry"}</div>
    <div>${inventoryEntries}</div>
    <div>Controls: WASD move, left click weapon, right click mine, space repair, E interact</div>
  `;
}

export function renderWorld(worldLayer: Container, snapshot: SnapshotMessage): void {
  worldLayer.removeChildren();

  for (const chunk of snapshot.chunks) {
    const tileSize = 32;
    chunk.cells.forEach((cell, index) => {
      if (cell === 0) {
        return;
      }
      const localX = index % 8;
      const localY = Math.floor(index / 8);
      const x = (chunk.chunkX * 8 + localX) * tileSize;
      const y = (chunk.chunkY * 8 + localY) * tileSize;
      const graphic = new Graphics();
      graphic.rect(x, y, tileSize, tileSize).fill(cell === 1 ? 0x374a5d : 0x3d5665);
      worldLayer.addChild(graphic);
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
