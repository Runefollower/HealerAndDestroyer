import { getHullDefinition, hullDefinitions, moduleDefinitions } from "@healer/content";
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
  const buildingShips = message.ships.filter((entry) => entry.ship.status === "building");
  const storedModuleSummary = message.craftedModules.length
    ? message.craftedModules.map((entry) => `<div>${labelModule(entry.moduleId)}: ${entry.quantity}</div>`).join("")
    : '<div class="muted-copy">No crafted modules in storage.</div>';
  const buildQueueSummary = buildingShips.length
    ? `<div class="muted-copy">${buildingShips.length} hull ${buildingShips.length === 1 ? "is" : "are"} under construction.</div>`
    : '<div class="muted-copy">No active ship builds right now.</div>';

  builder.innerHTML = `
    <p class="panel-title">Builder Site</p>
    ${buildQueueSummary}
    <div class="builder-workstation">
      <div class="builder-mode-row">
        <button data-action="design-mode-new" ${design.mode === "new" ? "disabled" : ""}>New Ship</button>
        <button data-action="design-mode-refit" ${design.mode === "refit" ? "disabled" : ""}>Refit Ship</button>
      </div>
      ${renderSelector(design)}
      <div class="ship-card-header">
        ${renderPlayerShipPreviewMarkup(design.hull.id, design.previewModules, design.shipState?.shipId ?? `draft-${design.hull.id}`, `${design.hull.name} preview`)}
        <div class="ship-preview-copy">
          <strong>${design.mode === "new" ? design.hull.name : design.shipState?.ship.name}</strong><br/>
          Hull: ${design.hull.name}<br/>
          Build time: ${formatDuration(design.hull.buildTimeMs)}<br/>
          Mass: ${design.hull.mass + sumModuleMass(design.previewModules)} | Power: ${sumModulePower(design.previewModules)}/${design.hull.powerCapacity}
        </div>
      </div>
      ${renderHardpointEditor(design)}
      ${renderDesignSummary(design, inventory)}
    </div>
    <div class="section-label">Stored Modules</div>
    <div>${storedModuleSummary}</div>
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
  const commitBlocker = canAfford ? null : "Not enough resources for this design.";

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
    canCommit: canAfford,
    commitBlocker
  };
}

// Renders the top selector for new hulls or existing ships.
function renderSelector(design: DesignState): string {
  if (design.mode === "new") {
    return `
      <div class="builder-selector">
        <button data-action="design-hull-prev">Prev Hull</button>
        <strong>${design.hull.name}</strong>
        <button data-action="design-hull-next">Next Hull</button>
      </div>
    `;
  }
  return `
    <div class="builder-selector">
      <button data-action="design-ship-prev">Prev Ship</button>
      <strong>${design.shipState?.ship.name ?? "No ship"}</strong>
      <button data-action="design-ship-next">Next Ship</button>
    </div>
    ${design.shipState?.ship.status === "ready" ? `<button data-action="swap" data-target="${design.shipState.shipId}">Swap To This Ship</button>` : '<span class="muted-copy">Currently active</span>'}
  `;
}

// Renders the active hardpoint and compatible module cycler.
function renderHardpointEditor(design: DesignState): string {
  const moduleCopy = design.activeModule.moduleId
    ? `${labelModule(design.activeModule.moduleId)} (${design.activeModule.source})`
    : "Empty mount";
  const noOptions = design.moduleOptions.length <= 1 && design.moduleOptions[0]?.moduleId === null;
  return `
    <div class="section-label">Mount Point</div>
    <div class="builder-selector">
      <button data-action="design-hardpoint-prev">Prev Mount</button>
      <strong>${design.activeHardpoint.id}</strong>
      <button data-action="design-hardpoint-next">Next Mount</button>
    </div>
    <div class="muted-copy">Type: ${design.activeHardpoint.type} | Orientation: ${design.activeHardpoint.orientation}</div>
    <div class="builder-selector">
      <button data-action="design-module-prev" ${noOptions ? "disabled" : ""}>Prev Module</button>
      <strong>${moduleCopy}</strong>
      <button data-action="design-module-next" ${noOptions ? "disabled" : ""}>Next Module</button>
    </div>
    ${noOptions ? '<div class="muted-copy">No compatible modules available for this mount.</div>' : ""}
  `;
}

// Renders costs and the committed loadout summary.
function renderDesignSummary(design: DesignState, inventory: ResourceMap): string {
  const moduleRows = design.hull.hardpoints
    .map((hardpoint) => {
      const moduleId = design.selectedModules[hardpoint.id];
      return `<div>${hardpoint.id}: ${moduleId ? labelModule(moduleId) : "Empty"}</div>`;
    })
    .join("");
  return `
    <div class="section-label">Design Summary</div>
    <div>${moduleRows}</div>
    <div class="muted-copy">Hull cost: ${formatResources(design.hull.buildCost)}</div>
    <div class="muted-copy">Craft-on-commit cost: ${formatResources(design.craftCost)}</div>
    <div class="muted-copy">Total cost: ${formatResources(design.totalCost)}</div>
    <div class="muted-copy">Inventory: ${formatResources(inventory)}</div>
    ${design.commitBlocker ? `<div class="muted-copy">${design.commitBlocker}</div>` : ""}
    <button data-action="design-submit" ${design.canCommit ? "" : "disabled"}>${design.mode === "new" ? "Start Build" : "Apply Refit"}</button>
  `;
}

// Renders compact stable/building inventory below the workstation.
function renderShipInventory(message: BuilderStateMessage, clockOffsetMs: number): string {
  const rows = message.ships
    .map((shipState) => {
      const remainingBuildMs = getRemainingBuildMs(shipState, clockOffsetMs);
      const progress = Math.round(getBuildProgress(shipState, remainingBuildMs) * 100);
      const status =
        shipState.ship.status === "building"
          ? `
            <span data-build-status="${shipState.ship.id}">Construction underway: ${formatDuration(remainingBuildMs)} remaining</span>
            <div class="build-progress"><div class="build-progress-fill" data-build-progress="${shipState.ship.id}" style="width:${progress}%"></div></div>
            <span data-build-percent="${shipState.ship.id}">Build progress: ${progress}%</span>
          `
          : shipState.ship.status === "active"
            ? "Currently active"
            : "Ready in storage";
      return `<div class="ship-card"><strong>${shipState.ship.name}</strong><br/><span class="muted-copy">${status}</span></div>`;
    })
    .join("");
  return `
    <div class="section-label">Stable</div>
    ${rows || '<div class="ship-card muted-copy">No ships in storage.</div>'}
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

// Sums selected module mass for preview stats.
function sumModuleMass(modules: Array<{ moduleId: string }>): number {
  return modules.reduce((total, module) => total + (moduleDefinitions.find((entry) => entry.id === module.moduleId)?.mass ?? 0), 0);
}

// Sums selected module power use for preview stats.
function sumModulePower(modules: Array<{ moduleId: string }>): number {
  return modules.reduce((total, module) => total + (moduleDefinitions.find((entry) => entry.id === module.moduleId)?.powerUse ?? 0), 0);
}

// Formats resources into compact builder copy.
function formatResources(resources: ResourceMap): string {
  const entries = Object.entries(resources).filter(([, amount]) => amount !== 0);
  return entries.length ? entries.map(([resource, amount]) => `${resource}: ${amount}`).join(", ") : "none";
}

// Looks up module display names while keeping unknown ids visible during development.
function labelModule(moduleId: string): string {
  return moduleDefinitions.find((entry) => entry.id === moduleId)?.name ?? moduleId;
}
