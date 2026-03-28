import { getModuleDefinition } from "@healer/content";
import { Application, Container } from "pixi.js";
import type { InstalledModule, ServerMessage } from "@healer/shared";
import { attachInputListeners, createInputState } from "./input.js";
import { NetworkClient } from "./networkClient.js";
import { refreshBuilderTimers, renderBuilderState } from "./renderBuilder.js";
import { renderHud, renderWorld } from "./renderWorld.js";
import { createClientStore, type UiToast } from "./store.js";

export async function bootstrapClient(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0 });
  document.getElementById("app")!.appendChild(app.canvas);

  const worldLayer = new Container();
  app.stage.addChild(worldLayer);

  const hud = document.getElementById("hud")!;
  const builder = document.getElementById("builder")!;
  const notifications = document.getElementById("notifications")!;
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
  builder.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  builder.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });
  builder.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.action;
    const targetId = button.dataset.target;
    const shipId = button.dataset.ship;
    const hardpointId = button.dataset.hardpoint;
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

  network.onServerMessage((message) => {
    const nextOffset = handleServerMessage(network, builder, hud, notifications, worldLayer, store, message, clockOffsetMs);
    if (typeof nextOffset === "number") {
      clockOffsetMs = nextOffset;
    }
  });

  window.addEventListener("builder-interact", () => {
    const nearby = !!store.latestSnapshot?.builderSiteNearby;
    if (!nearby) {
      return;
    }

    store.builderOpen = !store.builderOpen;
    if (!store.builderOpen) {
      store.builderState = null;
      syncBuilderVisibility(builder, store);
      return;
    }

    builder.innerHTML = `
      <p class="panel-title">Builder Site</p>
      <div class="muted-copy">Syncing builder state...</div>
    `;
    syncBuilderVisibility(builder, store);
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

    if (store.builderOpen && store.builderState && builder.classList.contains("visible")) {
      refreshBuilderTimers(builder, store.builderState, clockOffsetMs);
    }

    const now = Date.now();
    const nextToasts = store.toasts.filter((toast) => toast.expiresAt > now);
    if (nextToasts.length !== store.toasts.length) {
      store.toasts = nextToasts;
    }
    renderToasts(notifications, store.toasts);
  });
}

function handleServerMessage(
  network: NetworkClient,
  builder: HTMLElement,
  hud: HTMLElement,
  notifications: HTMLElement,
  worldLayer: Container,
  store: ReturnType<typeof createClientStore>,
  message: ServerMessage,
  clockOffsetMs: number
): number | undefined {
  if (message.type === "builderState") {
    store.builderState = message;
    const nextOffset = message.serverTime - Date.now();
    if (store.builderOpen) {
      renderBuilderState(builder, message, nextOffset);
    }
    syncBuilderVisibility(builder, store);
    return nextOffset;
  }

  if (message.type === "shipBuildCompleted") {
    store.toasts = [
      {
        id: `${message.shipId}-${message.serverTime}`,
        title: "Ship Construction Complete",
        body: `${message.shipName} is ready in storage. Return to the builder site to swap or fit modules.`,
        expiresAt: Date.now() + 7000
      },
      ...store.toasts
    ].slice(0, 3);
    renderToasts(notifications, store.toasts);

    if (store.builderOpen && store.latestSnapshot?.builderSiteNearby) {
      network.send({ type: "interact" });
    }
    return clockOffsetMs;
  }

  if (message.type === "snapshot") {
    store.latestSnapshot = message;
    renderHud(hud, message, store.hudMinimized);
    renderWorld(worldLayer, message);
    if (!message.builderSiteNearby) {
      store.builderOpen = false;
      store.builderState = null;
    }
    syncBuilderVisibility(builder, store);
  }

  return clockOffsetMs;
}

function syncBuilderVisibility(builder: HTMLElement, store: ReturnType<typeof createClientStore>): void {
  const nearby = !!store.latestSnapshot?.builderSiteNearby;
  const visible = nearby && store.builderOpen;
  builder.classList.toggle("visible", visible);
  if (!visible) {
    builder.innerHTML = "";
  }
}

function renderToasts(container: HTMLElement, toasts: UiToast[]): void {
  container.innerHTML = toasts
    .map(
      (toast) => `
        <div class="toast">
          <p class="toast-title">${toast.title}</p>
          <p class="toast-body">${toast.body}</p>
        </div>
      `
    )
    .join("");
}

function findFirstModuleByCapability(modules: InstalledModule[], capability: "weapon" | "mining" | "support") {
  return modules.find((installedModule) => getModuleDefinition(installedModule.moduleId).capabilities.includes(capability));
}
