import { Application, Container, Graphics, Text } from "pixi.js";
import { getHullDefinition, hullDefinitions, moduleDefinitions } from "@healer/content";
import type { BuilderStateMessage, ServerMessage, SnapshotMessage } from "@healer/shared";
import { attachInputListeners, createInputState } from "./input.js";
import { NetworkClient } from "./networkClient.js";
import { createClientStore } from "./store.js";

export async function bootstrapClient(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0 });
  document.getElementById("app")!.appendChild(app.canvas);

  const worldLayer = new Container();
  app.stage.addChild(worldLayer);

  const hud = document.getElementById("hud")!;
  const builder = document.getElementById("builder")!;
  const input = createInputState();
  const network = new NetworkClient();
  const store = createClientStore();
  let tick = 0;
  let mouseWorld = { x: 0, y: 0 };

  attachInputListeners(input);
  window.addEventListener("mousemove", (event) => {
    mouseWorld = { x: event.clientX, y: event.clientY };
  });

  network.onServerMessage((message) => {
    handleServerMessage(network, builder, hud, worldLayer, store, message);
  });

  window.addEventListener("builder-interact", () => {
    network.send({ type: "interact" });
  });

  await network.connect(`pilot-${Math.floor(Math.random() * 10000)}`);

  app.ticker.add(() => {
    tick += 1;
    network.send({
      type: "moveInput",
      thrustForward: input.thrustForward,
      thrustReverse: input.thrustReverse,
      rotateLeft: input.rotateLeft,
      rotateRight: input.rotateRight,
      aimWorld: mouseWorld,
      tick
    });

    if (input.firePrimary && tick % 8 === 0) {
      network.send({
        type: "fireWeapon",
        weaponHardpointId: "pulse-cannon",
        targetWorld: mouseWorld,
        tick
      });
    }
  });
}

function handleServerMessage(
  network: NetworkClient,
  builder: HTMLElement,
  hud: HTMLElement,
  worldLayer: Container,
  store: ReturnType<typeof createClientStore>,
  message: ServerMessage
): void {
  if (message.type === "builderState") {
    store.builderState = message;
    renderBuilderState(network, builder, message);
  }

  if (message.type === "snapshot") {
    store.latestSnapshot = message;
    renderHud(hud, message);
    renderWorld(worldLayer, message);
    builder.classList.toggle("visible", message.builderSiteNearby || !!store.builderState);
  }
}

function renderHud(hud: HTMLElement, snapshot: SnapshotMessage): void {
  const inventoryEntries = Object.entries(snapshot.inventory)
    .map(([resource, amount]) => `${resource}: ${amount}`)
    .join("<br/>");
  hud.innerHTML = `
    <p class="panel-title">Mission HUD</p>
    <div>Map: ${snapshot.mapId}</div>
    <div>Players nearby: ${snapshot.players.length}</div>
    <div>Enemies nearby: ${snapshot.enemies.length}</div>
    <div>Builder site nearby: ${snapshot.builderSiteNearby ? "yes" : "no"}</div>
    <div>Terrain chunks: ${snapshot.chunks.length}</div>
    <div>${inventoryEntries}</div>
    <div>Controls: WASD move, mouse aim/fire, E interact</div>
  `;
}

function renderBuilderState(network: NetworkClient, builder: HTMLElement, message: BuilderStateMessage): void {
  const hullButtons = hullDefinitions
    .map((hull) => `<button data-action="build" data-target="${hull.id}">Build ${hull.name}</button>`)
    .join("");
  const moduleButtons = moduleDefinitions
    .map((module) => `<button data-action="craft" data-target="${module.id}">Craft ${module.name}</button>`)
    .join("");

  const craftedModuleSummary = message.craftedModules.length
    ? message.craftedModules.map((entry) => `<div>${entry.moduleId}: ${entry.quantity}</div>`).join("")
    : "<div>No crafted modules in storage.</div>";

  const ships = Object.values(message.availableShips)
    .map((ship) => {
      const hull = getHullDefinition(ship.hullId);
      const installedByHardpoint = new Map(ship.modules.map((module) => [module.hardpointId, module]));
      const hardpoints = hull.hardpoints
        .map((hardpoint) => {
          const installed = installedByHardpoint.get(hardpoint.id);
          const compatibleModules = message.craftedModules.filter((stack) => {
            const definition = moduleDefinitions.find((module) => module.id === stack.moduleId);
            return definition?.slotType === hardpoint.type;
          });
          const installButtons = compatibleModules
            .map(
              (stack) =>
                `<button data-action="install" data-ship="${ship.id}" data-hardpoint="${hardpoint.id}" data-target="${stack.moduleId}">Install ${stack.moduleId}</button>`
            )
            .join("");
          const removeButton = installed
            ? `<button data-action="remove" data-ship="${ship.id}" data-hardpoint="${hardpoint.id}" data-target="${installed.moduleId}">Remove ${installed.moduleId}</button>`
            : "<span>Empty</span>";
          return `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)">
              <strong>${hardpoint.id}</strong> (${hardpoint.type})<br/>
              ${installed ? `Installed: ${installed.moduleId}<br/>` : "Installed: none<br/>"}
              ${installButtons || ""}
              ${removeButton}
            </div>
          `;
        })
        .join("");
      return `
        <div class="ship-card">
          <strong>${ship.name}</strong>${ship.id === message.activeShipId ? " (Active)" : ""}<br/>
          Hull: ${ship.hullId}<br/>
          Status: ${ship.status}<br/>
          <button data-action="swap" data-target="${ship.id}">Swap To This Ship</button>
          ${hardpoints}
        </div>
      `;
    })
    .join("");

  builder.innerHTML = `
    <p class="panel-title">Builder Site</p>
    <div><strong>Crafted Modules</strong>${craftedModuleSummary}</div>
    <div style="margin-top: 10px">${moduleButtons}</div>
    <div style="margin-top: 10px">${hullButtons}</div>
    <div style="margin-top: 14px">${ships}</div>
  `;

  builder.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      const targetId = button.getAttribute("data-target");
      const shipId = button.getAttribute("data-ship") ?? undefined;
      const hardpointId = button.getAttribute("data-hardpoint") ?? undefined;
      if (!action || !targetId) {
        return;
      }

      if (action === "craft") {
        network.sendBuilderAction({ type: "builderAction", action: "craftModule", targetId });
      } else if (action === "build") {
        network.sendBuilderAction({ type: "builderAction", action: "startShipBuild", targetId });
      } else if (action === "swap") {
        network.sendBuilderAction({ type: "builderAction", action: "swapShip", targetId });
      } else if (action === "install") {
        network.sendBuilderAction({ type: "builderAction", action: "installModule", targetId, shipId, hardpointId });
      } else if (action === "remove") {
        network.sendBuilderAction({ type: "builderAction", action: "removeModule", targetId, shipId, hardpointId });
      }
    });
  });
}

function renderWorld(worldLayer: Container, snapshot: SnapshotMessage): void {
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
    graphic.rect(structure.position.x - 18, structure.position.y - 18, 36, 36).fill(structure.structureTypeId === "builder-site" ? 0x73f3ca : 0xff7e6b);
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
