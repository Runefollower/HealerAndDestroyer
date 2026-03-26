import { Application, Container, Graphics, Text } from "pixi.js";
import { hullDefinitions, moduleDefinitions } from "@healer/content";
import type { ServerMessage, SnapshotMessage } from "@healer/shared";
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

  window.addEventListener("builder-send", (event) => {
    network.sendBuilderAction((event as CustomEvent<ServerMessage & { targetId: string }>).detail);
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
    <div>${inventoryEntries}</div>
    <div>Controls: WASD move, mouse aim/fire, E interact</div>
  `;
}

function renderBuilderState(network: NetworkClient, builder: HTMLElement, message: Extract<ServerMessage, { type: "builderState" }>): void {
  const hullButtons = hullDefinitions
    .map((hull) => `<button data-action="build" data-target="${hull.id}">Build ${hull.name}</button>`)
    .join("");
  const moduleButtons = moduleDefinitions
    .slice(0, 3)
    .map((module) => `<button data-action="craft" data-target="${module.id}">Craft ${module.name}</button>`)
    .join("");
  const ships = Object.values(message.availableShips)
    .map(
      (ship) => `
        <div class="ship-card">
          <strong>${ship.name}</strong><br/>
          Hull: ${ship.hullId}<br/>
          Status: ${ship.status}<br/>
          <button data-action="swap" data-target="${ship.id}">Swap To This Ship</button>
        </div>
      `
    )
    .join("");

  builder.innerHTML = `
    <p class="panel-title">Builder Site</p>
    <div>${moduleButtons}</div>
    <div style="margin-top: 10px">${hullButtons}</div>
    <div style="margin-top: 14px">${ships}</div>
  `;

  builder.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      const targetId = button.getAttribute("data-target");
      if (!action || !targetId) {
        return;
      }

      if (action === "craft") {
        network.sendBuilderAction({ type: "builderAction", action: "craftModule", targetId });
      } else if (action === "build") {
        network.sendBuilderAction({ type: "builderAction", action: "startShipBuild", targetId });
      } else {
        network.sendBuilderAction({ type: "builderAction", action: "swapShip", targetId });
      }
    });
  });
}

function renderWorld(worldLayer: Container, snapshot: SnapshotMessage): void {
  worldLayer.removeChildren();

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

