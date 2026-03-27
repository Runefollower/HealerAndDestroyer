import { getModuleDefinition } from "@healer/content";
import { Application, Container } from "pixi.js";
import type { InstalledModule, ServerMessage } from "@healer/shared";
import { attachInputListeners, createInputState } from "./input.js";
import { NetworkClient } from "./networkClient.js";
import { renderBuilderState } from "./renderBuilder.js";
import { renderHud, renderWorld } from "./renderWorld.js";
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
  let clockOffsetMs = 0;

  attachInputListeners(input);
  window.addEventListener("mousemove", (event) => {
    mouseWorld = { x: event.clientX, y: event.clientY };
  });
  hud.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const toggleButton = target.closest<HTMLElement>("[data-action='toggle-hud']");
    if (!toggleButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    store.hudMinimized = !store.hudMinimized;
    if (store.latestSnapshot) {
      renderHud(hud, store.latestSnapshot, store.hudMinimized);
    }
  });

  network.onServerMessage((message) => {
    const nextOffset = handleServerMessage(network, builder, hud, worldLayer, store, message, clockOffsetMs);
    if (typeof nextOffset === "number") {
      clockOffsetMs = nextOffset;
    }
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

    const snapshot = store.latestSnapshot;
    if (snapshot) {
      const weaponModule = findFirstModuleByCapability(snapshot.selfModules, "weapon");
      if (input.firePrimary && weaponModule && tick % 8 === 0) {
        network.send({
          type: "fireWeapon",
          weaponHardpointId: weaponModule.hardpointId,
          targetWorld: mouseWorld,
          tick
        });
      }

      const miningModule = findFirstModuleByCapability(snapshot.selfModules, "mining");
      if (input.activateUtility && miningModule && tick % 6 === 0) {
        network.send({
          type: "activateModule",
          moduleId: miningModule.moduleId,
          targetWorld: mouseWorld,
          tick
        });
      }

      const supportModule = findFirstModuleByCapability(snapshot.selfModules, "support");
      const selfEntity = snapshot.players.find((player) => player.playerId === snapshot.selfPlayerId);
      if (input.activateSupport && supportModule && selfEntity && tick % 10 === 0) {
        network.send({
          type: "activateModule",
          moduleId: supportModule.moduleId,
          targetEntityId: selfEntity.id,
          tick
        });
      }
    }

    if (store.builderState && builder.classList.contains("visible")) {
      renderBuilderState(network, builder, store.builderState, clockOffsetMs);
      const hasBuildingShips = store.builderState.ships.some((ship) => ship.ship.status === "building");
      if (hasBuildingShips && tick % 30 === 0) {
        network.send({ type: "interact" });
      }
    }
  });
}

function handleServerMessage(
  network: NetworkClient,
  builder: HTMLElement,
  hud: HTMLElement,
  worldLayer: Container,
  store: ReturnType<typeof createClientStore>,
  message: ServerMessage,
  clockOffsetMs: number
): number | undefined {
  if (message.type === "builderState") {
    store.builderState = message;
    const nextOffset = message.serverTime - Date.now();
    renderBuilderState(network, builder, message, nextOffset);
    return nextOffset;
  }

  if (message.type === "snapshot") {
    store.latestSnapshot = message;
    renderHud(hud, message, store.hudMinimized);
    renderWorld(worldLayer, message);
    builder.classList.toggle("visible", message.builderSiteNearby || !!store.builderState);
  }

  return clockOffsetMs;
}

function findFirstModuleByCapability(modules: InstalledModule[], capability: "weapon" | "mining" | "support") {
  return modules.find((installedModule) => getModuleDefinition(installedModule.moduleId).capabilities.includes(capability));
}
