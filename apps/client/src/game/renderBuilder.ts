import { getHullDefinition, hullDefinitions, moduleDefinitions } from "@healer/content";
import type { BuilderStateMessage, BuilderShipState } from "@healer/shared";
import { NetworkClient } from "./networkClient.js";

function getRemainingBuildMs(shipState: BuilderShipState, clockOffsetMs: number): number {
  if (shipState.ship.status !== "building" || !shipState.ship.buildCompleteAt) {
    return 0;
  }
  return Math.max(0, shipState.ship.buildCompleteAt - (Date.now() + clockOffsetMs));
}

function renderShipCard(shipState: BuilderShipState, message: BuilderStateMessage, clockOffsetMs: number): string {
  const ship = shipState.ship;
  const hull = getHullDefinition(ship.hullId);
  const installedByHardpoint = new Map(ship.modules.map((module) => [module.hardpointId, module]));
  const canModify = ship.status !== "building";
  const hardpoints = hull.hardpoints
    .map((hardpoint) => {
      const installed = installedByHardpoint.get(hardpoint.id);
      const compatibleModules = message.craftedModules.filter((stack) => {
        const definition = moduleDefinitions.find((module) => module.id === stack.moduleId);
        return definition?.slotType === hardpoint.type;
      });
      const installButtons = canModify
        ? compatibleModules
            .map(
              (stack) =>
                `<button data-action="install" data-ship="${ship.id}" data-hardpoint="${hardpoint.id}" data-target="${stack.moduleId}">Install ${stack.moduleId}</button>`
            )
            .join("")
        : "";
      const removeButton = canModify && installed
        ? `<button data-action="remove" data-ship="${ship.id}" data-hardpoint="${hardpoint.id}" data-target="${installed.moduleId}">Remove ${installed.moduleId}</button>`
        : installed
          ? `<span>Installed: ${installed.moduleId}</span>`
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

  const timerLine = ship.status === "building"
    ? `<div>Ready in: ${Math.ceil(getRemainingBuildMs(shipState, clockOffsetMs) / 1000)}s</div>`
    : "";
  const swapButton = ship.status === "ready"
    ? `<button data-action="swap" data-target="${ship.id}">Swap To This Ship</button>`
    : ship.id === message.activeShipId
      ? "<span>Currently active</span>"
      : `<span>${ship.status}</span>`;

  return `
    <div class="ship-card">
      <strong>${ship.name}</strong>${ship.id === message.activeShipId ? " (Active)" : ""}<br/>
      Hull: ${ship.hullId}<br/>
      Status: ${ship.status}<br/>
      ${timerLine}
      ${swapButton}
      ${hardpoints}
    </div>
  `;
}

export function renderBuilderState(network: NetworkClient, builder: HTMLElement, message: BuilderStateMessage, clockOffsetMs: number): void {
  const activeShips = message.ships.filter((entry) => entry.ship.status === "active");
  const readyShips = message.ships.filter((entry) => entry.ship.status === "ready");
  const buildingShips = message.ships.filter((entry) => entry.ship.status === "building");

  const moduleButtons = moduleDefinitions
    .map((module) => `<button data-action="craft" data-target="${module.id}">Craft ${module.name}</button>`)
    .join("");
  const hullButtons = hullDefinitions
    .map((hull) => `<button data-action="build" data-target="${hull.id}">Build ${hull.name}</button>`)
    .join("");

  const craftedModuleSummary = message.craftedModules.length
    ? message.craftedModules.map((entry) => `<div>${entry.moduleId}: ${entry.quantity}</div>`).join("")
    : "<div>No crafted modules in storage.</div>";

  builder.innerHTML = `
    <p class="panel-title">Builder Site</p>
    <div><strong>Crafted Modules</strong>${craftedModuleSummary}</div>
    <div style="margin-top: 10px">${moduleButtons}</div>
    <div style="margin-top: 10px">${hullButtons}</div>
    <div style="margin-top: 14px"><strong>Active Ship</strong>${activeShips.map((ship) => renderShipCard(ship, message, clockOffsetMs)).join("")}</div>
    <div style="margin-top: 14px"><strong>Stored Ships</strong>${readyShips.map((ship) => renderShipCard(ship, message, clockOffsetMs)).join("") || "<div class=\"ship-card\">No ready ships.</div>"}</div>
    <div style="margin-top: 14px"><strong>Building Ships</strong>${buildingShips.map((ship) => renderShipCard(ship, message, clockOffsetMs)).join("") || "<div class=\"ship-card\">No active builds.</div>"}</div>
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
