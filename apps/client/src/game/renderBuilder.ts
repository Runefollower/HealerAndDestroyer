import { getHullDefinition, hullDefinitions, moduleDefinitions } from "@healer/content";
import type { BuilderStateMessage, BuilderShipState } from "@healer/shared";
import { playerShipPartCatalog, renderPlayerShipPreviewMarkup } from "./playerShipAssets.js";

// Formats build countdowns into compact user-facing builder UI text.
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// Computes remaining build time using the server/client clock offset from the latest builder message.
function getRemainingBuildMs(shipState: BuilderShipState, clockOffsetMs: number): number {
  if (shipState.ship.status !== "building" || !shipState.ship.buildCompleteAt) {
    return 0;
  }
  return Math.max(0, shipState.ship.buildCompleteAt - (Date.now() + clockOffsetMs));
}

// Converts a ship build timer into a 0..1 progress ratio for the progress bar.
function getBuildProgress(shipState: BuilderShipState, remainingBuildMs: number): number {
  const startedAt = shipState.ship.buildStartedAt;
  const completeAt = shipState.ship.buildCompleteAt;
  if (shipState.ship.status !== "building" || !startedAt || !completeAt) {
    return shipState.ship.status === "ready" || shipState.ship.status === "active" ? 1 : 0;
  }

  const total = Math.max(1, completeAt - startedAt);
  return Math.min(1, Math.max(0, (total - remainingBuildMs) / total));
}

// Renders one ship card including preview art, build status, swap action, and module hardpoints.
function renderShipCard(shipState: BuilderShipState, message: BuilderStateMessage, clockOffsetMs: number): string {
  // Ship/hull metadata drives both available hardpoints and compatible module installation controls.
  const ship = shipState.ship;
  const hull = getHullDefinition(ship.hullId);
  const installedByHardpoint = new Map(ship.modules.map((module) => [module.hardpointId, module]));
  const canModify = ship.status !== "building";
  const remainingBuildMs = getRemainingBuildMs(shipState, clockOffsetMs);
  const progress = Math.round(getBuildProgress(shipState, remainingBuildMs) * 100);

  const hardpoints = hull.hardpoints
    .map((hardpoint) => {
      // For each hardpoint, only crafted modules with matching slot type are offered for install.
      const installed = installedByHardpoint.get(hardpoint.id);
      const compatibleModules = message.craftedModules.filter((stack) => {
        const definition = moduleDefinitions.find((module) => module.id === stack.moduleId);
        return definition?.slotType === hardpoint.type;
      });
      const installButtons = compatibleModules.length
        ? compatibleModules
            .map(
              (stack) =>
                `<button ${canModify ? "" : "disabled"} data-action="install" data-ship="${ship.id}" data-hardpoint="${hardpoint.id}" data-target="${stack.moduleId}">Install ${stack.moduleId}</button>`
            )
            .join("")
        : `<span class="muted-copy">No stored modules fit this slot.</span>`;
      const removeButton = installed
        ? `<button ${canModify ? "" : "disabled"} data-action="remove" data-ship="${ship.id}" data-hardpoint="${hardpoint.id}" data-target="${installed.moduleId}">Remove ${installed.moduleId}</button>`
        : '<span class="muted-copy">Empty slot</span>';
      return `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)">
          <strong>${hardpoint.id}</strong> (${hardpoint.type})<br/>
          ${installed ? `Installed: ${installed.moduleId}<br/>` : "Installed: none<br/>"}
          ${installButtons}<br/>
          ${removeButton}
        </div>
      `;
    })
    .join("");

  // Status/progress copy keeps build timers visible without asking for new server state every frame.
  const statusCopy = ship.status === "building"
    ? `Construction underway: ${formatDuration(remainingBuildMs)} remaining`
    : ship.status === "ready"
      ? "Ready in storage"
      : "Currently active in the field";
  const progressMarkup = ship.status === "building"
    ? `
      <div class="muted-copy" data-build-status="${ship.id}">${statusCopy}</div>
      <div class="build-progress"><div class="build-progress-fill" data-build-progress="${ship.id}" style="width:${progress}%"></div></div>
      <div class="muted-copy" data-build-percent="${ship.id}">Build progress: ${progress}%</div>
    `
    : `<div class="muted-copy">${statusCopy}</div>`;
  const swapButton = ship.status === "ready"
    ? `<button data-action="swap" data-target="${ship.id}">Swap To This Ship</button>`
    : ship.id === message.activeShipId
      ? "<span>Currently active</span>"
      : "<button disabled>Unavailable</button>";

  return `
    <div class="ship-card" data-ship-card="${ship.id}">
      <div class="ship-card-header">
        ${renderPlayerShipPreviewMarkup(ship.hullId, ship.modules, ship.id, `${ship.name} preview`)}
        <div class="ship-preview-copy">
          <strong>${ship.name}</strong>${ship.id === message.activeShipId ? " (Active)" : ""}<br/>
          Hull: ${ship.hullId}<br/>
          Status: ${ship.status}<br/>
          ${progressMarkup}
          ${swapButton}
        </div>
      </div>
      ${hardpoints}
    </div>
  `;
}

// Renders a grouped ship section such as active, stored, or building ships.
function renderShipSection(title: string, ships: BuilderShipState[], message: BuilderStateMessage, clockOffsetMs: number, emptyState: string): string {
  return `
    <div style="margin-top: 14px">
      <div class="section-label">${title} (${ships.length})</div>
      ${ships.length ? ships.map((ship) => renderShipCard(ship, message, clockOffsetMs)).join("") : `<div class="ship-card muted-copy">${emptyState}</div>`}
    </div>
  `;
}

// Renders the available visual part library in the builder panel.
function renderPartGallery(title: string, partType: keyof typeof playerShipPartCatalog): string {
  const parts = playerShipPartCatalog[partType];
  return `
    <div class="ship-part-gallery">
      <div class="muted-copy">${title}</div>
      <div class="ship-part-grid">
        ${parts
          .map(
            (part) => `
              <div class="ship-part-option">
                <div class="ship-part-swatch">
                  <img src="${part.textureUrl}" alt="" />
                </div>
                <div class="ship-part-name">${part.label}</div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

// Renders the full builder panel from the latest server builder state.
export function renderBuilderState(builder: HTMLElement, message: BuilderStateMessage, clockOffsetMs: number): void {
  // Split ships by status so the player can scan active, ready, and building inventory separately.
  const activeShips = message.ships.filter((entry) => entry.ship.status === "active");
  const readyShips = message.ships.filter((entry) => entry.ship.status === "ready");
  const buildingShips = message.ships.filter((entry) => entry.ship.status === "building");

  // Module and hull build controls are generated from content definitions.
  const moduleButtons = moduleDefinitions
    .map((module) => `<button data-action="craft" data-target="${module.id}">Craft ${module.name}</button>`)
    .join("");
  const hullButtons = hullDefinitions
    .map((hull) => `<button data-action="build" data-target="${hull.id}">Build ${hull.name}</button>`)
    .join("");

  // Summary sections keep resource/build state readable before the detailed ship cards.
  const craftedModuleSummary = message.craftedModules.length
    ? message.craftedModules.map((entry) => `<div>${entry.moduleId}: ${entry.quantity}</div>`).join("")
    : '<div class="muted-copy">No crafted modules in storage.</div>';
  const buildQueueSummary = buildingShips.length
    ? `<div class="muted-copy">${buildingShips.length} hull ${buildingShips.length === 1 ? "is" : "are"} under construction.</div>`
    : '<div class="muted-copy">No active ship builds right now.</div>';

  builder.innerHTML = `
    <p class="panel-title">Builder Site</p>
    ${buildQueueSummary}
    <div class="section-label">Prototype Ship Parts</div>
    <div class="muted-copy">Hull, engine, and weapon art are now separate layers so builder previews can assemble them cleanly.</div>
    <div class="ship-part-library">
      ${renderPartGallery("Hull options", "hull")}
      ${renderPartGallery("Engine options", "engine")}
      ${renderPartGallery("Weapon options", "weapon")}
    </div>
    <div class="section-label">Crafted Modules</div>
    <div>${craftedModuleSummary}</div>
    <div style="margin-top: 10px">${moduleButtons}</div>
    <div class="section-label">New Hull Construction</div>
    <div style="margin-top: 6px">${hullButtons}</div>
    ${renderShipSection("Active Ship", activeShips, message, clockOffsetMs, "No active ship.")}
    ${renderShipSection("Stored Ships", readyShips, message, clockOffsetMs, "No ready ships in storage.")}
    ${renderShipSection("Building Ships", buildingShips, message, clockOffsetMs, "No active builds.")}
  `;
}

// Updates live build timers/progress bars without replacing the whole builder DOM every frame.
export function refreshBuilderTimers(builder: HTMLElement, message: BuilderStateMessage, clockOffsetMs: number): void {
  for (const shipState of message.ships) {
    if (shipState.ship.status !== "building") {
      continue;
    }

    // The data attributes are emitted by renderShipCard and let us patch only timer-related nodes.
    const remainingBuildMs = getRemainingBuildMs(shipState, clockOffsetMs);
    const progress = Math.round(getBuildProgress(shipState, remainingBuildMs) * 100);
    const statusNode = builder.querySelector<HTMLElement>(`[data-build-status="${shipState.ship.id}"]`);
    const progressNode = builder.querySelector<HTMLElement>(`[data-build-progress="${shipState.ship.id}"]`);
    const percentNode = builder.querySelector<HTMLElement>(`[data-build-percent="${shipState.ship.id}"]`);

    if (statusNode) {
      statusNode.textContent = `Construction underway: ${formatDuration(remainingBuildMs)} remaining`;
    }
    if (progressNode) {
      progressNode.style.width = `${progress}%`;
    }
    if (percentNode) {
      percentNode.textContent = `Build progress: ${progress}%`;
    }
  }
}
