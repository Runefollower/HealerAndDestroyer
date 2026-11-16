import { deriveShipStats, getHullDefinition, hullDefinitions, moduleDefinitions, type ShipStats } from "@healer/content";
import type { BuilderActionMessage, BuilderStateMessage, BuilderShipState, ResourceMap } from "@healer/shared";
import { addResourceMaps, hasEnoughResources } from "@healer/shared";
import type { BuilderDesignDraft } from "./store.js";
import { renderPlayerShipPreviewMarkup } from "./playerShipAssets.js";

type BuilderDraftAction =
  | "mode-new"
  | "mode-refit"
  | "hull-prev"
  | "hull-next"
  | "ship-prev"
  | "ship-next"
  | "hardpoint-prev"
  | "hardpoint-next"
  | "module-prev"
  | "module-next";

interface ModuleOption {
  // moduleId is null for the empty-slot option.
  moduleId: string | null;
  // source describes whether this option uses storage, resources, or no module.
  source: "empty" | "stored" | "craftable" | "unaffordable";
}

interface DesignState {
  mode: BuilderDesignDraft["mode"];
  hull: ReturnType<typeof getHullDefinition>;
  shipState: BuilderShipState | null;
  hardpointIndex: number;
  activeHardpoint: ReturnType<typeof getHullDefinition>["hardpoints"][number];
  selectedModules: Record<string, string | null>;
  previewModules: Array<{ moduleId: string; hardpointId: string; currentHealth: number }>;
  moduleOptions: ModuleOption[];
  activeModule: ModuleOption;
  craftCost: ResourceMap;
  totalCost: ResourceMap;
  stats: ShipStats;
  canCommit: boolean;
  commitBlocker: string | null;
}

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

// Applies one workstation control action to the local draft and keeps indices in valid ranges.
export function updateBuilderDraft(
  draft: BuilderDesignDraft,
  message: BuilderStateMessage,
  inventory: ResourceMap,
  action: BuilderDraftAction
): BuilderDesignDraft {
  const next = normalizeBuilderDraft({ ...draft, selectedModules: { ...draft.selectedModules } }, message, inventory);
  if (action === "mode-new") {
    next.mode = "new";
    next.hardpointIndex = 0;
    return normalizeBuilderDraft(next, message, inventory, true);
  }
  if (action === "mode-refit") {
    next.mode = "refit";
    next.hardpointIndex = 0;
    return normalizeBuilderDraft(next, message, inventory, true);
  }
  if (action === "hull-prev" || action === "hull-next") {
    next.mode = "new";
    next.hullIndex += action === "hull-next" ? 1 : -1;
    next.hardpointIndex = 0;
    return normalizeBuilderDraft(next, message, inventory, true);
  }
  if (action === "ship-prev" || action === "ship-next") {
    next.mode = "refit";
    next.shipIndex += action === "ship-next" ? 1 : -1;
    next.hardpointIndex = 0;
    return normalizeBuilderDraft(next, message, inventory, true);
  }
  if (action === "hardpoint-prev" || action === "hardpoint-next") {
    const design = resolveDesignState(next, message, inventory);
    next.hardpointIndex = wrapIndex(next.hardpointIndex + (action === "hardpoint-next" ? 1 : -1), design.hull.hardpoints.length);
    return normalizeBuilderDraft(next, message, inventory);
  }
  if (action === "module-prev" || action === "module-next") {
    const design = resolveDesignState(next, message, inventory);
    const currentIndex = design.moduleOptions.findIndex((option) => option.moduleId === design.activeModule.moduleId);
    const nextIndex = wrapIndex(currentIndex + (action === "module-next" ? 1 : -1), design.moduleOptions.length);
    next.selectedModules[design.activeHardpoint.id] = design.moduleOptions[nextIndex]?.moduleId ?? null;
    return normalizeBuilderDraft(next, message, inventory);
  }
  return next;
}

// Creates the network payload for the current workstation draft.
export function createShipDesignAction(
  draft: BuilderDesignDraft,
  message: BuilderStateMessage,
  inventory: ResourceMap
): BuilderActionMessage | null {
  const design = resolveDesignState(normalizeBuilderDraft(draft, message, inventory), message, inventory);
  if (!design.canCommit) {
    return null;
  }
  return {
    type: "builderAction",
    action: "submitShipDesign",
    mode: design.mode,
    hullId: design.hull.id,
    shipId: design.shipState?.shipId,
    modules: design.previewModules.map((module) => ({
      hardpointId: module.hardpointId,
      moduleId: module.moduleId
    }))
  };
}

// Renders the full builder panel from the latest server builder state and local design draft.
export function renderBuilderState(
  builder: HTMLElement,
  message: BuilderStateMessage,
  clockOffsetMs: number,
  inventory: ResourceMap,
  draft: BuilderDesignDraft
): void {
  const normalizedDraft = normalizeBuilderDraft(draft, message, inventory);
  const design = resolveDesignState(normalizedDraft, message, inventory);
  const buildingCount = message.ships.filter((entry) => entry.ship.status === "building").length;
  const buildQueueSummary = buildingCount
    ? `${buildingCount} hull${buildingCount === 1 ? "" : "s"} under construction`
    : "No active ship builds";
  const storedModules = message.craftedModules.length
    ? `<div class="ui-chips">${message.craftedModules.map((entry) => `<span class="ui-chip">${labelModule(entry.moduleId)} <b>${entry.quantity}</b></span>`).join("")}</div>`
    : '<div class="ui-muted">No crafted modules in storage.</div>';
  const hasRefitShips = getRefitShips(message).length > 0;

  builder.innerHTML = `
    <header class="ui-head">
      <span class="ui-title">Builder Site</span>
      <span class="ui-sub">${buildQueueSummary}</span>
    </header>
    <div class="ui-tabs">
      <button class="ui-tab${design.mode === "new" ? " ui-active" : ""}" data-action="design-mode-new">New Ship</button>
      <button class="ui-tab${design.mode === "refit" ? " ui-active" : ""}" data-action="design-mode-refit" ${hasRefitShips ? "" : "disabled"}>Refit Ship</button>
    </div>
    ${renderSelector(design, message)}
    <div class="ui-ship">
      <div class="ui-preview">
        ${renderPlayerShipPreviewMarkup(design.hull.id, design.previewModules, design.shipState?.shipId ?? `draft-${design.hull.id}`, `${design.hull.name} preview`)}
        <span class="ui-fig">Fig. 1 · ${design.hull.name}</span>
      </div>
      <div class="ui-shipstats">
        ${renderStatsPreview(design.stats)}
        <div class="ui-buildtime">Build time <b>${formatDuration(design.hull.buildTimeMs)}</b></div>
      </div>
    </div>
    ${renderHardpointEditor(design)}
    ${renderDesignSummary(design, inventory)}
    <section class="ui-sec">
      <div class="ui-label">Stored modules</div>
      ${storedModules}
    </section>
    ${renderShipInventory(message, clockOffsetMs)}
  `;
}

// Updates live build timers/progress bars without replacing the whole builder DOM every frame.
export function refreshBuilderTimers(builder: HTMLElement, message: BuilderStateMessage, clockOffsetMs: number): void {
  for (const shipState of message.ships) {
    if (shipState.ship.status !== "building") {
      continue;
    }

    const remainingBuildMs = getRemainingBuildMs(shipState, clockOffsetMs);
    const progress = Math.round(getBuildProgress(shipState, remainingBuildMs) * 100);
    const statusNode = builder.querySelector<HTMLElement>(`[data-build-status="${shipState.ship.id}"]`);
    const progressNode = builder.querySelector<HTMLElement>(`[data-build-progress="${shipState.ship.id}"]`);

    if (statusNode) {
      statusNode.textContent = describeBuildStatus(remainingBuildMs, progress);
    }
    if (progressNode) {
      progressNode.style.width = `${progress}%`;
    }
  }
}

// Short status line for a hull under construction.
function describeBuildStatus(remainingBuildMs: number, progress: number): string {
  return `Building · ${formatDuration(remainingBuildMs)} left · ${progress}%`;
}
// Normalizes draft indices and seeds default module choices from the selected hull/ship.
function normalizeBuilderDraft(draft: BuilderDesignDraft, message: BuilderStateMessage, inventory: ResourceMap, resetModules = false): BuilderDesignDraft {
  draft.hullIndex = wrapIndex(draft.hullIndex, hullDefinitions.length);
  const refitShips = getRefitShips(message);
  if (!refitShips.length && draft.mode === "refit") {
    draft.mode = "new";
  }
  draft.shipIndex = wrapIndex(draft.shipIndex, Math.max(1, refitShips.length));
  const hull = draft.mode === "new" ? hullDefinitions[draft.hullIndex] : getHullDefinition(refitShips[draft.shipIndex]?.ship.hullId ?? hullDefinitions[0].id);
  draft.hardpointIndex = wrapIndex(draft.hardpointIndex, hull.hardpoints.length);

  if (resetModules) {
    draft.selectedModules = {};
  }
  if (draft.mode === "refit" && refitShips[draft.shipIndex] && !Object.keys(draft.selectedModules).length) {
    draft.selectedModules = Object.fromEntries(refitShips[draft.shipIndex].ship.modules.map((module) => [module.hardpointId, module.moduleId]));
  }

  for (const hardpoint of hull.hardpoints) {
    if (draft.selectedModules[hardpoint.id] === undefined) {
      const refitShip = draft.mode === "refit" ? getRefitShips(message)[draft.shipIndex] : null;
      const options = getModuleOptionsForHardpoint(hardpoint.type, draft.selectedModules, message, inventory, hardpoint.id, refitShip ?? null);
      draft.selectedModules[hardpoint.id] = options.find((option) => option.source !== "unaffordable")?.moduleId ?? null;
    }
  }

  draft.selectedModules = Object.fromEntries(Object.entries(draft.selectedModules).filter(([hardpointId]) => hull.hardpoints.some((hardpoint) => hardpoint.id === hardpointId)));
  return draft;
}

// Resolves derived data needed to render and submit the current draft.
function resolveDesignState(draft: BuilderDesignDraft, message: BuilderStateMessage, inventory: ResourceMap): DesignState {
  const refitShips = getRefitShips(message);
  const mode = draft.mode === "refit" && refitShips.length ? "refit" : "new";
  const shipState = mode === "refit" ? refitShips[wrapIndex(draft.shipIndex, refitShips.length)] : null;
  const hull = mode === "new" ? hullDefinitions[wrapIndex(draft.hullIndex, hullDefinitions.length)] : getHullDefinition(shipState!.ship.hullId);
  const hardpointIndex = wrapIndex(draft.hardpointIndex, hull.hardpoints.length);
  const activeHardpoint = hull.hardpoints[hardpointIndex];
  const selectedModules = { ...draft.selectedModules };
  const moduleOptions = getModuleOptionsForHardpoint(activeHardpoint.type, selectedModules, message, inventory, activeHardpoint.id, shipState);
  const activeModule = moduleOptions.find((option) => option.moduleId === (selectedModules[activeHardpoint.id] ?? null)) ?? moduleOptions[0] ?? { moduleId: null, source: "empty" };
  selectedModules[activeHardpoint.id] = activeModule.moduleId;
  const previewModules = toInstalledModules(selectedModules);
  const craftCost = getCraftCost(previewModules, message, shipState);
  const totalCost = mode === "new" ? addResourceMaps(hull.buildCost, craftCost) : craftCost;
  const canAfford = hasEnoughResources(inventory, totalCost);
  const stats = deriveShipStats(hull.id, previewModules);
  const powerOk = stats.powerDraw <= stats.powerOutput;
  const commitBlocker = !powerOk
    ? "Loadout draws more power than the reactor provides. Add a power module or swap to lighter modules."
    : canAfford
      ? null
      : "Not enough resources for this design.";

  return {
    mode,
    hull,
    shipState,
    hardpointIndex,
    activeHardpoint,
    selectedModules,
    previewModules,
    moduleOptions,
    activeModule,
    craftCost,
    totalCost,
    stats,
    canCommit: canAfford && powerOk,
    commitBlocker
  };
}

// Renders the top selector for new hulls or existing ships.
function renderSelector(design: DesignState, message: BuilderStateMessage): string {
  if (design.mode === "new") {
    const hullIndex = hullDefinitions.findIndex((hull) => hull.id === design.hull.id);
    return renderPicker("design-hull", `Hull ${hullIndex + 1} / ${hullDefinitions.length}`, design.hull.name, false, "ui-hull");
  }
  const refitShips = getRefitShips(message);
  const shipIndex = refitShips.findIndex((entry) => entry.shipId === design.shipState?.shipId);
  const swap =
    design.shipState?.ship.status === "ready"
      ? `<button class="ui-btn ui-small" data-action="swap" data-target="${design.shipState.shipId}">Swap to this ship</button>`
      : '<span class="ui-ok">Currently active</span>';
  return `
    ${renderPicker("design-ship", `Ship ${shipIndex + 1} / ${refitShips.length} · ${design.hull.name}`, design.shipState?.ship.name ?? "No ship", false, "ui-hull")}
    <div class="ui-swap">${swap}</div>
  `;
}

// Renders a prev/next cycler around a caption and value; actionPrefix gets -prev / -next appended.
function renderPicker(actionPrefix: string, caption: string, value: string, disabled = false, extraClass = ""): string {
  const disabledAttr = disabled ? "disabled" : "";
  return `
    <div class="ui-picker ${extraClass}">
      <button class="ui-btn ui-arrow" data-action="${actionPrefix}-prev" aria-label="Previous" ${disabledAttr}>&#8249;</button>
      <div><small>${caption}</small><strong>${value}</strong></div>
      <button class="ui-btn ui-arrow" data-action="${actionPrefix}-next" aria-label="Next" ${disabledAttr}>&#8250;</button>
    </div>
  `;
}

// Renders the active hardpoint and compatible module cycler side by side.
function renderHardpointEditor(design: DesignState): string {
  const moduleName = design.activeModule.moduleId ? labelModule(design.activeModule.moduleId) : "Empty mount";
  const moduleCaption = design.activeModule.moduleId ? moduleSourceCopy[design.activeModule.source] : "no module fitted";
  const noOptions = design.moduleOptions.length <= 1 && design.moduleOptions[0]?.moduleId === null;
  return `
    <div class="ui-mounts">
      <div class="ui-label">Mount point</div>
      ${renderPicker("design-hardpoint", `${design.activeHardpoint.type} · faces ${design.activeHardpoint.orientation}`, design.activeHardpoint.id)}
      <div class="ui-label">Module</div>
      ${renderPicker("design-module", noOptions ? "none compatible" : moduleCaption, moduleName, noOptions)}
    </div>
  `;
}

const moduleSourceCopy: Record<ModuleOption["source"], string> = {
  empty: "no module fitted",
  stored: "from storage",
  craftable: "crafted on commit",
  unaffordable: "can't afford"
};

// Renders costs, the committed loadout summary, and the commit button.
function renderDesignSummary(design: DesignState, inventory: ResourceMap): string {
  const moduleRows = design.hull.hardpoints
    .map((hardpoint) => {
      const moduleId = design.selectedModules[hardpoint.id];
      const active = hardpoint.id === design.activeHardpoint.id ? " ui-current" : "";
      return `<div class="ui-hp${active}"><span><i class="ui-dot" data-slot="${hardpoint.type}"></i>${hardpoint.id}</span><b${moduleId ? ' class="ui-fitted"' : ""}>${moduleId ? labelModule(moduleId) : "Empty"}</b></div>`;
    })
    .join("");
  const costs =
    design.mode === "new"
      ? `<div><span>Hull cost</span><b>${formatResources(design.hull.buildCost)}</b></div>
         <div><span>Craft on commit</span><b>${formatResources(design.craftCost)}</b></div>`
      : `<div><span>Craft on commit</span><b>${formatResources(design.craftCost)}</b></div>`;
  return `
    <div class="ui-summary">
      <div class="ui-label">Design summary</div>
      ${moduleRows}
      <div class="ui-costs">
        ${costs}
        <div><span>Total</span><b>${formatResources(design.totalCost)}</b></div>
        <div class="ui-wide"><span>In cargo</span><b>${formatResources(inventory)}</b></div>
      </div>
      ${design.commitBlocker ? `<div class="ui-blocker">${design.commitBlocker}</div>` : ""}
    </div>
    <button class="ui-btn ui-primary" data-action="design-submit" ${design.canCommit ? "" : "disabled"}>${design.mode === "new" ? "Start Build" : "Apply Refit"}</button>
  `;
}

// Renders the stable: every owned ship with its status, and a progress bar for hulls under construction.
function renderShipInventory(message: BuilderStateMessage, clockOffsetMs: number): string {
  const rows = message.ships
    .map((shipState) => {
      const id = shipState.ship.id;
      if (shipState.ship.status === "building") {
        const remainingBuildMs = getRemainingBuildMs(shipState, clockOffsetMs);
        const progress = Math.round(getBuildProgress(shipState, remainingBuildMs) * 100);
        return `
          <div class="ui-card">
            <strong>${shipState.ship.name}</strong>
            <span data-build-status="${id}">${describeBuildStatus(remainingBuildMs, progress)}</span>
            <div class="ui-bar"><i data-build-progress="${id}" style="width:${progress}%"></i></div>
          </div>`;
      }
      const status = shipState.ship.status === "active" ? '<span class="ui-ok">Active</span>' : "<span>Ready in storage</span>";
      return `<div class="ui-card"><strong>${shipState.ship.name}</strong>${status}</div>`;
    })
    .join("");
  return `
    <section class="ui-sec">
      <div class="ui-label">Stable</div>
      ${rows || '<div class="ui-muted">No ships in storage.</div>'}
    </section>
  `;
}
// Finds ships that can be selected in the refit workstation.
function getRefitShips(message: BuilderStateMessage): BuilderShipState[] {
  return message.ships.filter((entry) => entry.ship.status !== "building");
}

// Builds compatible module options for a hardpoint from stored and craftable modules.
function getModuleOptionsForHardpoint(
  slotType: string,
  selectedModules: Record<string, string | null>,
  message: BuilderStateMessage,
  inventory: ResourceMap,
  activeHardpointId: string,
  shipState: BuilderShipState | null = null
): ModuleOption[] {
  const consumedSelections = Object.entries(selectedModules)
    .filter(([hardpointId, moduleId]) => hardpointId !== activeHardpointId && moduleId)
    .map(([, moduleId]) => moduleId as string);
  const storedCounts = new Map(message.craftedModules.map((entry) => [entry.moduleId, entry.quantity]));
  for (const installed of shipState?.ship.modules ?? []) {
    storedCounts.set(installed.moduleId, (storedCounts.get(installed.moduleId) ?? 0) + 1);
  }
  for (const moduleId of consumedSelections) {
    storedCounts.set(moduleId, Math.max(0, (storedCounts.get(moduleId) ?? 0) - 1));
  }

  const compatibleOptions = moduleDefinitions
    .filter((definition) => definition.slotType === slotType)
    .map((definition): ModuleOption => {
      if ((storedCounts.get(definition.id) ?? 0) > 0) {
        return { moduleId: definition.id, source: "stored" };
      }
      return {
        moduleId: definition.id,
        source: hasEnoughResources(inventory, definition.buildCost) ? "craftable" : "unaffordable"
      };
    });
  return [{ moduleId: null, source: "empty" }, ...compatibleOptions];
}

// Computes the resource cost for modules not covered by stored crafted inventory.
function getCraftCost(modules: Array<{ moduleId: string; hardpointId: string }>, message: BuilderStateMessage, shipState: BuilderShipState | null): ResourceMap {
  const available = new Map(message.craftedModules.map((entry) => [entry.moduleId, entry.quantity]));
  for (const installed of shipState?.ship.modules ?? []) {
    available.set(installed.moduleId, (available.get(installed.moduleId) ?? 0) + 1);
  }

  let cost: ResourceMap = {};
  for (const module of modules) {
    const count = available.get(module.moduleId) ?? 0;
    if (count > 0) {
      available.set(module.moduleId, count - 1);
      continue;
    }
    const definition = moduleDefinitions.find((entry) => entry.id === module.moduleId);
    if (definition) {
      cost = addResourceMaps(cost, definition.buildCost);
    }
  }
  return cost;
}

// Converts selected module ids into InstalledModule-like preview records.
function toInstalledModules(selectedModules: Record<string, string | null>): Array<{ moduleId: string; hardpointId: string; currentHealth: number }> {
  return Object.entries(selectedModules)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([hardpointId, moduleId]) => ({
      moduleId,
      hardpointId,
      currentHealth: moduleDefinitions.find((entry) => entry.id === moduleId)?.maxHealth ?? 1
    }));
}

// Returns a wrapped array index, tolerating empty lengths defensively.
function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return ((index % length) + length) % length;
}

// Bar scales for the stat preview; set a little above the strongest hull so modules still show growth.
const statBarScale = { mass: 150, thrust: 160, accel: 100, turn: 600, energy: 200, hull: 300 };

// Shows the derived flight, power, and durability numbers the server will use for this loadout as labelled bars.
function renderStatsPreview(stats: ShipStats): string {
  const turnDegreesPerSecond = Math.round((stats.movement.rotationStep * 30 * 180) / Math.PI);
  const accel = Math.round(stats.movement.forwardAcceleration);
  const overloaded = stats.powerDraw > stats.powerOutput;
  return [
    statRow("Mass", stats.totalMass / statBarScale.mass, `${stats.totalMass}`),
    statRow("Thrust", stats.totalThrust / statBarScale.thrust, `${stats.totalThrust}`),
    statRow("Accel", accel / statBarScale.accel, `${accel}`),
    statRow("Turn", turnDegreesPerSecond / statBarScale.turn, `${turnDegreesPerSecond}°/s`),
    statRow("Power", stats.powerDraw / Math.max(1, stats.powerOutput), `${stats.powerDraw} / ${stats.powerOutput}`, overloaded ? "ui-bar-danger" : ""),
    statRow("Energy", stats.energyCapacity / statBarScale.energy, `${stats.energyCapacity} +${stats.energyRegenPerSecond.toFixed(0)}/s`, "ui-bar-energy"),
    statRow("Hull", stats.maxHull / statBarScale.hull, `${stats.maxHull}`)
  ].join("");
}

// One stat line: label, a 0..1 bar, and the exact value.
function statRow(label: string, ratio: number, value: string, barClass = ""): string {
  const width = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return `<div class="ui-stat"><span>${label}</span><div class="ui-bar ${barClass}"><i style="width:${width}%"></i></div><b>${value}</b></div>`;
}

// Formats resources into compact builder copy.
function formatResources(resources: ResourceMap): string {
  const entries = Object.entries(resources).filter(([, amount]) => amount !== 0);
  return entries.length ? entries.map(([resource, amount]) => `${resource.replace(/-/g, " ")} ${amount}`).join(" · ") : "none";
}

// Looks up module display names while keeping unknown ids visible during development.
function labelModule(moduleId: string): string {
  return moduleDefinitions.find((entry) => entry.id === moduleId)?.name ?? moduleId;
}
