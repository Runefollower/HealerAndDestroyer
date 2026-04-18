import { getModuleDefinition } from "@healer/content";
import { Application, Container } from "pixi.js";
import type { InstalledModule, ServerMessage, SnapshotMessage } from "@healer/shared";
import { attachInputListeners, createInputState, type InputState } from "./input.js";
import { NetworkClient } from "./networkClient.js";
import { predictSnapshotForRender } from "./predictSnapshot.js";
import { createShipDesignAction, refreshBuilderTimers, renderBuilderState, updateBuilderDraft } from "./renderBuilder.js";
import { renderHud, renderWorld, type HudSelections, type WorldRenderStats } from "./renderWorld.js";
import { createClientStore, type ClientStore, type ModuleSelectionCapability, type UiToast } from "./store.js";
import { preloadPlayerShipTextures } from "./playerShipAssets.js";
import { preloadTerrainTextures } from "./terrainAssets.js";
import { preloadWorldEntityTextures } from "./worldEntityAssets.js";

interface ClientDiagnostics {
  // lastFrameTime stores the previous ticker timestamp for frame delta diagnostics.
  lastFrameTime: number | null;
  // frameMs and maxFrameMs show current and rolling hitch cost.
  frameMs: number;
  maxFrameMs: number;
  // renderMs measures camera plus Pixi world render work for the latest frame.
  renderMs: number;
  // callbackMs measures this client's ticker callback work for the latest frame.
  callbackMs: number;
  // predictMs measures client snapshot prediction cost for the latest frame.
  predictMs: number;
  // snapshotAgeMs shows how stale the authoritative base snapshot is.
  snapshotAgeMs: number;
  // lastSnapshotTick identifies the current server snapshot base.
  lastSnapshotTick: number | null;
  // renderStats are returned by renderWorld and include layer/object counts.
  renderStats: WorldRenderStats | null;
  // lastHitch freezes diagnostics from the most recent long frame.
  lastHitch: HitchDiagnostics | null;
}

interface HitchDiagnostics {
  // capturedAt is a short local time string for the most recent hitch.
  capturedAt: string;
  frameMs: number;
  callbackMs: number;
  renderMs: number;
  predictMs: number;
  snapshotAgeMs: number;
  lastSnapshotTick: number | null;
  renderStats: WorldRenderStats | null;
}

const hitchFrameThresholdMs = 80;

// Boots the Pixi client, wires DOM UI, connects to the server, and starts the frame loop.
export async function bootstrapClient(): Promise<void> {
  // Pixi owns the game canvas while HTML elements own HUD, builder, notifications, and FPS display.
  const app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0 });
  // Preload visual assets before the first snapshot so world rendering does not flash missing textures.
  await Promise.all([preloadTerrainTextures(), preloadPlayerShipTextures(), preloadWorldEntityTextures()]);
  document.getElementById("app")!.appendChild(app.canvas);

  // worldLayer is moved by the camera while the stage remains pinned to the screen.
  const worldLayer = new Container();
  app.stage.addChild(worldLayer);

  const hud = document.getElementById("hud")!;
  const builder = document.getElementById("builder")!;
  const notifications = document.getElementById("notifications")!;
  const framerate = document.getElementById("framerate")!;
  const input = createInputState();
  const network = new NetworkClient();
  const store = createClientStore();
  // tick is the local frame/input counter sent to the authoritative server with client actions.
  let tick = 0;
  // mouseScreen tracks the latest browser-space pointer position for world-targeted mining.
  let mouseScreen = { x: app.screen.width / 2, y: app.screen.height / 2 };
  // clockOffsetMs estimates server time minus local time for builder countdown display.
  let clockOffsetMs = 0;
  // frameTimes stores recent performance timestamps for the toggleable FPS overlay.
  const frameTimes: number[] = [];
  const diagnostics: ClientDiagnostics = createClientDiagnostics();

  attachInputListeners(input);
  // Pointer position is converted to world space each frame after camera movement.
  window.addEventListener("mousemove", (event) => {
    mouseScreen = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    // Number keys cycle selected module hardpoints by gameplay capability.
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
    if (event.key === "0") {
      // 0 toggles the local frame-rate overlay without involving the server.
      store.fpsVisible = !store.fpsVisible;
      renderFrameRate(framerate, store.fpsVisible, frameTimes, diagnostics);
    }
  });
  hud.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    // HUD minimize/expand is a local UI preference.
    const toggleButton = target.closest<HTMLElement>("[data-action='toggle-hud']");
    if (!toggleButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    store.hudMinimized = !store.hudMinimized;
    renderHudForStore(hud, store);
  });
  // Builder pointer events should not fall through into world click actions.
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

    // Builder buttons encode their server action payload in data attributes.
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
    if (!action) {
      return;
    }

    if (action.startsWith("design-")) {
      if (!store.builderState) {
        return;
      }
      const inventory = store.latestSnapshot?.inventory ?? {};
      if (action === "design-submit") {
        const designAction = createShipDesignAction(store.builderDraft, store.builderState, inventory);
        if (designAction) {
          network.sendBuilderAction(designAction);
        }
        return;
      }
      const draftAction = action.replace("design-", "") as Parameters<typeof updateBuilderDraft>[3];
      store.builderDraft = updateBuilderDraft(store.builderDraft, store.builderState, inventory, draftAction);
      renderBuilderState(builder, store.builderState, clockOffsetMs, inventory, store.builderDraft);
      return;
    }

    if (!targetId) {
      return;
    }

    // Map button action names from UI copy to shared builder action message variants.
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
    // Some server messages refine the local server-time offset used by builder timers.
    const nextOffset = handleServerMessage(network, builder, hud, notifications, store, diagnostics, message, clockOffsetMs);
    if (typeof nextOffset === "number") {
      clockOffsetMs = nextOffset;
    }
  });

  window.addEventListener("builder-interact", () => {
    // E toggles the builder only when the latest snapshot says the player is close enough.
    const nearby = !!store.latestSnapshot?.builderSiteNearby;
    if (!nearby) {
      return;
    }

    store.builderOpen = !store.builderOpen;
    if (!store.builderOpen) {
      // Closing the builder drops stale state so the next open re-syncs with the server.
      store.builderState = null;
      store.builderDraft = {
        mode: "new",
        hullIndex: 0,
        shipIndex: 0,
        hardpointIndex: 0,
        selectedModules: {}
      };
      syncBuilderVisibility(builder, store);
      return;
    }

    // Show immediate loading copy while waiting for the authoritative builderState response.
    builder.innerHTML = `
      <p class="panel-title">Builder Site</p>
      <div class="muted-copy">Syncing builder state...</div>
    `;
    syncBuilderVisibility(builder, store);
    network.send({ type: "interact" });
  });

  // Use a temporary prototype pilot id until authentication/account selection exists.
  await network.connect(`pilot-${Math.floor(Math.random() * 10000)}`);

  app.ticker.add(() => {
    // Local ticker drives input submission, client-only UI timers, and opportunistic actions.
    const callbackStart = performance.now();
    tick += 1;
    // Keep only the last two seconds of frame timestamps for a stable rolling FPS display.
    const frameTime = performance.now();
    recordFrameTiming(diagnostics, frameTime);
    frameTimes.push(frameTime);
    while (frameTimes.length && frameTimes[0] < frameTime - 2000) {
      frameTimes.shift();
    }

    // Movement input is sent every frame so the server remains authoritative about motion.
    network.send({
      type: "moveInput",
      thrustForward: input.thrustForward,
      thrustReverse: input.thrustReverse,
      rotateLeft: input.rotateLeft,
      rotateRight: input.rotateRight,
      tick
    });

    const snapshot = store.latestSnapshot;
    if (snapshot) {
      const predictStart = performance.now();
      const renderSnapshot = predictSnapshotForRender(snapshot, store.latestSnapshotReceivedAt, frameTime, input);
      diagnostics.predictMs = performance.now() - predictStart;
      // Camera update must happen before screen-to-world targeting.
      const renderStart = performance.now();
      updateCamera(worldLayer, renderSnapshot, app.screen.width, app.screen.height);
      diagnostics.renderStats = renderWorld(worldLayer, renderSnapshot, {
        x: -worldLayer.position.x,
        y: -worldLayer.position.y,
        width: app.screen.width,
        height: app.screen.height
      }, {
        selfThrustForward: input.thrustForward
      });
      diagnostics.renderMs = performance.now() - renderStart;
      diagnostics.snapshotAgeMs = store.latestSnapshotReceivedAt === null ? 0 : Math.max(0, frameTime - store.latestSnapshotReceivedAt);
      const mouseWorld = screenToWorld(worldLayer, mouseScreen);

      // Actions are throttled client-side to reduce duplicate messages while controls are held.
      const weaponModule = getSelectedModuleByCapability(snapshot.selfModules, "weapon", store.selectedModuleHardpoints.weapon);
      if (input.firePrimary && weaponModule && tick % 8 === 0) {
        network.send({
          type: "fireWeapon",
          weaponHardpointId: weaponModule.hardpointId,
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

    renderFrameRate(framerate, store.fpsVisible, frameTimes, diagnostics);

    if (store.builderOpen && store.builderState && builder.classList.contains("visible")) {
      // Builder countdowns are refreshed locally between server builderState messages.
      refreshBuilderTimers(builder, store.builderState, clockOffsetMs);
    }

    // Toasts expire on the client without requiring server cleanup messages.
    const now = Date.now();
    const nextToasts = store.toasts.filter((toast) => toast.expiresAt > now);
    if (nextToasts.length !== store.toasts.length) {
      store.toasts = nextToasts;
    }
    renderToasts(notifications, store.toasts);
    diagnostics.callbackMs = performance.now() - callbackStart;
    captureHitchIfNeeded(diagnostics);
  });
}

// Applies one incoming server message to client store, UI, and world rendering.
function handleServerMessage(
  network: NetworkClient,
  builder: HTMLElement,
  hud: HTMLElement,
  notifications: HTMLElement,
  store: ClientStore,
  diagnostics: ClientDiagnostics,
  message: ServerMessage,
  clockOffsetMs: number
): number | undefined {
  if (message.type === "builderState") {
    // builderState is authoritative and also provides a server timestamp for countdown correction.
    store.builderState = message;
    const nextOffset = message.serverTime - Date.now();
    if (store.builderOpen) {
      renderBuilderState(builder, message, nextOffset, store.latestSnapshot?.inventory ?? {}, store.builderDraft);
    }
    syncBuilderVisibility(builder, store);
    return nextOffset;
  }

  if (message.type === "shipBuildCompleted") {
    // Ship build completion is a one-off toast and may trigger a builder refresh if the panel is open.
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
    // Server action feedback becomes a transient toast with level-based duration/styling.
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
    // Snapshot is the main world/HUD update path and refreshes module selection validity.
    store.latestSnapshot = message;
    store.latestSnapshotReceivedAt = performance.now();
    diagnostics.lastSnapshotTick = message.tick;
    reconcileSelectedModules(store, message.selfModules);
    renderHudForStore(hud, store);
    if (!message.builderSiteNearby) {
      // Moving away from the builder closes the local panel and clears its stale state.
      store.builderOpen = false;
      store.builderState = null;
    }
    syncBuilderVisibility(builder, store);
  }

  return clockOffsetMs;
}

// Centers the world layer on the local player's latest snapshot position.
function updateCamera(worldLayer: Container, snapshot: SnapshotMessage, screenWidth: number, screenHeight: number): void {
  const selfPlayer = snapshot.players.find((player) => player.playerId === snapshot.selfPlayerId);
  if (!selfPlayer) {
    return;
  }

  worldLayer.position.set(screenWidth / 2 - selfPlayer.position.x, screenHeight / 2 - selfPlayer.position.y);
}

// Converts a browser screen coordinate into world coordinates using the current camera transform.
function screenToWorld(worldLayer: Container, screen: { x: number; y: number }): { x: number; y: number } {
  const local = worldLayer.toLocal(screen);
  return { x: local.x, y: local.y };
}

// Applies builder visibility rules and clears hidden content to avoid stale interactive controls.
function syncBuilderVisibility(builder: HTMLElement, store: ClientStore): void {
  const nearby = !!store.latestSnapshot?.builderSiteNearby;
  const visible = nearby && store.builderOpen;
  builder.classList.toggle("visible", visible);
  if (!visible) {
    builder.innerHTML = "";
  }
}

function createClientDiagnostics(): ClientDiagnostics {
  return {
    lastFrameTime: null,
    frameMs: 0,
    maxFrameMs: 0,
    renderMs: 0,
    callbackMs: 0,
    predictMs: 0,
    snapshotAgeMs: 0,
    lastSnapshotTick: null,
    renderStats: null,
    lastHitch: null
  };
}

function recordFrameTiming(diagnostics: ClientDiagnostics, frameTime: number): void {
  if (diagnostics.lastFrameTime !== null) {
    diagnostics.frameMs = frameTime - diagnostics.lastFrameTime;
    diagnostics.maxFrameMs = Math.max(diagnostics.maxFrameMs * 0.985, diagnostics.frameMs);
  }
  diagnostics.lastFrameTime = frameTime;
}

function captureHitchIfNeeded(diagnostics: ClientDiagnostics): void {
  if (diagnostics.frameMs < hitchFrameThresholdMs) {
    return;
  }

  diagnostics.lastHitch = {
    capturedAt: new Date().toLocaleTimeString(),
    frameMs: diagnostics.frameMs,
    callbackMs: diagnostics.callbackMs,
    renderMs: diagnostics.renderMs,
    predictMs: diagnostics.predictMs,
    snapshotAgeMs: diagnostics.snapshotAgeMs,
    lastSnapshotTick: diagnostics.lastSnapshotTick,
    renderStats: diagnostics.renderStats
  };
}

// Renders the current toast stack into the notifications container.
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

// Renders the rolling FPS overlay when the local toggle is enabled.
function renderFrameRate(container: HTMLElement, visible: boolean, frameTimes: number[], diagnostics?: ClientDiagnostics): void {
  container.classList.toggle("visible", visible);
  if (!visible) {
    return;
  }

  // FPS uses frame count over elapsed time in the rolling two-second window.
  const firstFrameTime = frameTimes[0];
  const lastFrameTime = frameTimes[frameTimes.length - 1];
  const elapsedSeconds =
    firstFrameTime === undefined || lastFrameTime === undefined
      ? 0
      : Math.min(2, Math.max((lastFrameTime - firstFrameTime) / 1000, 0));
  const framesPerSecond = elapsedSeconds > 0 ? Math.max(frameTimes.length - 1, 0) / elapsedSeconds : 0;
  if (!diagnostics) {
    container.textContent = `${Math.round(framesPerSecond)} FPS`;
    return;
  }

  const renderStats = diagnostics.renderStats;
  container.textContent = [
    `${Math.round(framesPerSecond)} FPS`,
    `frame ${diagnostics.frameMs.toFixed(1)}ms max ${diagnostics.maxFrameMs.toFixed(1)}ms callback ${diagnostics.callbackMs.toFixed(1)}ms`,
    `render ${diagnostics.renderMs.toFixed(1)}ms predict ${diagnostics.predictMs.toFixed(2)}ms`,
    `snapshot age ${Math.round(diagnostics.snapshotAgeMs)}ms tick ${diagnostics.lastSnapshotTick ?? "-"}`,
    renderStats
      ? `dyn ${renderStats.dynamicObjects} terrain ${renderStats.terrainSprites} fog ${renderStats.fogObjects}`
      : "dyn - terrain - fog -",
    renderStats
      ? `exhaust ${renderStats.exhaustParticles} bursts ${renderStats.terrainBursts} terrain rebuild ${renderStats.terrainRebuilt ? "yes" : "no"}`
      : "exhaust - bursts - terrain rebuild -",
    formatLastHitch(diagnostics.lastHitch)
  ].join("\n");
}

function formatLastHitch(hitch: HitchDiagnostics | null): string {
  if (!hitch) {
    return `last hitch >${hitchFrameThresholdMs}ms: none`;
  }

  const stats = hitch.renderStats;
  const counts = stats
    ? `dyn ${stats.dynamicObjects} terrain ${stats.terrainSprites} exhaust ${stats.exhaustParticles} rebuild ${stats.terrainRebuilt ? "yes" : "no"}`
    : "dyn - terrain - exhaust - rebuild -";
  return [
    `last hitch ${hitch.frameMs.toFixed(1)}ms at ${hitch.capturedAt}`,
    `  callback ${hitch.callbackMs.toFixed(1)} render ${hitch.renderMs.toFixed(1)} predict ${hitch.predictMs.toFixed(2)} age ${Math.round(hitch.snapshotAgeMs)} tick ${hitch.lastSnapshotTick ?? "-"}`,
    `  ${counts}`
  ].join("\n");
}

// Renders the HUD only when a snapshot is available.
function renderHudForStore(hud: HTMLElement, store: ClientStore): void {
  if (!store.latestSnapshot) {
    return;
  }

  renderHud(hud, store.latestSnapshot, store.hudMinimized, describeSelectedModules(store.latestSnapshot, store));
}

// Builds user-facing labels for the selected module in each capability group.
function describeSelectedModules(snapshot: SnapshotMessage, store: ClientStore): HudSelections {
  return {
    weapon: formatSelectedModule(getSelectedModuleByCapability(snapshot.selfModules, "weapon", store.selectedModuleHardpoints.weapon)),
    mining: formatSelectedModule(getSelectedModuleByCapability(snapshot.selfModules, "mining", store.selectedModuleHardpoints.mining)),
    support: formatSelectedModule(getSelectedModuleByCapability(snapshot.selfModules, "support", store.selectedModuleHardpoints.support))
  };
}

// Formats one installed module label for HUD display.
function formatSelectedModule(module: InstalledModule | undefined): string {
  if (!module) {
    return "offline";
  }

  const definition = getModuleDefinition(module.moduleId);
  return `${definition.name} (${module.hardpointId})`;
}

// Resolves the selected installed module for a capability, falling back to the first matching module.
function getSelectedModuleByCapability(
  modules: InstalledModule[],
  capability: ModuleSelectionCapability,
  selectedHardpointId: string | null
): InstalledModule | undefined {
  // Module definitions are the source of truth for capability membership.
  const matchingModules = modules.filter((installedModule) => getModuleDefinition(installedModule.moduleId).capabilities.includes(capability));
  if (!matchingModules.length) {
    return undefined;
  }

  return matchingModules.find((installedModule) => installedModule.hardpointId === selectedHardpointId) ?? matchingModules[0];
}

// Keeps selected hardpoints valid after snapshots change installed module state.
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

// Advances the selected hardpoint for a capability when the player presses 1/2/3.
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
