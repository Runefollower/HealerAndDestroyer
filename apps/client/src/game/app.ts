import { getModuleDefinition } from "@healer/content";
import { Application, Container } from "pixi.js";
import type { InstalledModule, ServerMessage, SnapshotMessage } from "@healer/shared";
import { attachInputListeners, createInputState } from "./input.js";
import { NetworkClient } from "./networkClient.js";
import { refreshBuilderTimers, renderBuilderState } from "./renderBuilder.js";
import { renderHud, renderWorld, type HudSelections } from "./renderWorld.js";
import { createClientStore, type ClientStore, type ModuleSelectionCapability, type UiToast } from "./store.js";
import { preloadTerrainTextures } from "./terrainAssets.js";

export async function bootstrapClient(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0 });
  await preloadTerrainTextures();
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
  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    if (event.key === "1") {
      cycleSelectedModule(store, "weapon");
      renderHudForStore(hud, store);
    }
    if (event.key === "2") {
      cycleSelectedModule(store, "mining");
      renderHudForStore(hud, store);
    }
    if (event.key === "3") {
      cycleSelectedModule(store, "support");
      renderHudForStore(hud, store);
    }
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
    renderHudForStore(hud, store);
  });
  builder.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  builder.addEventListener("pointerup", (event) => {
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
      const weaponModule = getSelectedModuleByCapability(snapshot.selfModules, "weapon", store.selectedModuleHardpoints.weapon);
      if (input.firePrimary && weaponModule && tick % 8 === 0) {
        network.send({
          type: "fireWeapon",
          weaponHardpointId: weaponModule.hardpointId,
          targetWorld: mouseWorld,
          tick
        });
      }

      const miningModule = getSelectedModuleByCapability(snapshot.selfModules, "mining", store.selectedModuleHardpoints.mining);
      if (input.activateUtility && miningModule && tick % 6 === 0) {
        network.send({
          type: "activateModule",
          moduleId: miningModule.hardpointId,
          targetWorld: mouseWorld,
          tick
        });
      }

      const supportModule = getSelectedModuleByCapability(snapshot.selfModules, "support", store.selectedModuleHardpoints.support);
      const selfEntity = snapshot.players.find((player) => player.playerId === snapshot.selfPlayerId);
      if (input.activateSupport && supportModule && selfEntity && tick % 10 === 0) {
        network.send({
          type: "activateModule",
          moduleId: supportModule.hardpointId,
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
  store: ClientStore,
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
        expiresAt: Date.now() + 7000,
        tone: "success"
      },
      ...store.toasts
    ].slice(0, 4);
    renderToasts(notifications, store.toasts);

    if (store.builderOpen && store.latestSnapshot?.builderSiteNearby) {
      network.send({ type: "interact" });
    }
    return clockOffsetMs;
  }

  if (message.type === "actionFeedback") {
    store.toasts = [
      {
        id: `${message.code}-${message.serverTime}`,
        title: message.title,
        body: message.detail,
        expiresAt: Date.now() + (message.level === "warning" ? 3600 : 2600),
        tone: message.level === "warning" ? "warning" : "info"
      },
      ...store.toasts
    ].slice(0, 4);
    renderToasts(notifications, store.toasts);
    return clockOffsetMs;
  }

  if (message.type === "snapshot") {
    store.latestSnapshot = message;
    reconcileSelectedModules(store, message.selfModules);
    renderHudForStore(hud, store);
    renderWorld(worldLayer, message);
    if (!message.builderSiteNearby) {
      store.builderOpen = false;
      store.builderState = null;
    }
    syncBuilderVisibility(builder, store);
  }

  return clockOffsetMs;
}

function syncBuilderVisibility(builder: HTMLElement, store: ClientStore): void {
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
        <div class="toast ${toast.tone}">
          <p class="toast-title">${toast.title}</p>
          <p class="toast-body">${toast.body}</p>
        </div>
      `
    )
    .join("");
}

function renderHudForStore(hud: HTMLElement, store: ClientStore): void {
  if (!store.latestSnapshot) {
    return;
  }

  renderHud(hud, store.latestSnapshot, store.hudMinimized, describeSelectedModules(store.latestSnapshot, store));
}

function describeSelectedModules(snapshot: SnapshotMessage, store: ClientStore): HudSelections {
  return {
    weapon: formatSelectedModule(getSelectedModuleByCapability(snapshot.selfModules, "weapon", store.selectedModuleHardpoints.weapon)),
    mining: formatSelectedModule(getSelectedModuleByCapability(snapshot.selfModules, "mining", store.selectedModuleHardpoints.mining)),
    support: formatSelectedModule(getSelectedModuleByCapability(snapshot.selfModules, "support", store.selectedModuleHardpoints.support))
  };
}

function formatSelectedModule(module: InstalledModule | undefined): string {
  if (!module) {
    return "offline";
  }

  const definition = getModuleDefinition(module.moduleId);
  return `${definition.name} (${module.hardpointId})`;
}

function getSelectedModuleByCapability(
  modules: InstalledModule[],
  capability: ModuleSelectionCapability,
  selectedHardpointId: string | null
): InstalledModule | undefined {
  const matchingModules = modules.filter((installedModule) => getModuleDefinition(installedModule.moduleId).capabilities.includes(capability));
  if (!matchingModules.length) {
    return undefined;
  }

  return matchingModules.find((installedModule) => installedModule.hardpointId === selectedHardpointId) ?? matchingModules[0];
}

function reconcileSelectedModules(store: ClientStore, modules: InstalledModule[]): void {
  for (const capability of ["weapon", "mining", "support"] as const) {
    const matchingModules = modules.filter((installedModule) => getModuleDefinition(installedModule.moduleId).capabilities.includes(capability));
    const selectedHardpointId = store.selectedModuleHardpoints[capability];
    if (!matchingModules.length) {
      store.selectedModuleHardpoints[capability] = null;
      continue;
    }
    if (!selectedHardpointId || !matchingModules.some((installedModule) => installedModule.hardpointId === selectedHardpointId)) {
      store.selectedModuleHardpoints[capability] = matchingModules[0].hardpointId;
    }
  }
}

function cycleSelectedModule(store: ClientStore, capability: ModuleSelectionCapability): void {
  const snapshot = store.latestSnapshot;
  if (!snapshot) {
    return;
  }

  const matchingModules = snapshot.selfModules.filter((installedModule) => getModuleDefinition(installedModule.moduleId).capabilities.includes(capability));
  if (matchingModules.length < 2) {
    return;
  }

  const currentHardpointId = store.selectedModuleHardpoints[capability];
  const currentIndex = matchingModules.findIndex((installedModule) => installedModule.hardpointId === currentHardpointId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % matchingModules.length : 0;
  store.selectedModuleHardpoints[capability] = matchingModules[nextIndex].hardpointId;
}


