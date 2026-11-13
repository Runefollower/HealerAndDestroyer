import { getShipStats } from "@healer/content";
import { asEntityId, type BuilderStateMessage, type PlayerSave, type PlayerShipState, type StoredShip } from "@healer/shared";

// Builds the live simulation ship from the player's saved active ship and spawn point.
export function createRuntimeShip(playerId: PlayerShipState["playerId"], ship: StoredShip, player: PlayerSave): PlayerShipState {
  // Derived hull+loadout stats supply capacity limits while the save supplies player-owned state.
  const stats = getShipStats(ship.hullId, ship.modules);
  return {
    id: asEntityId(`entity-${ship.id}`),
    playerId,
    shipId: ship.id,
    hullId: ship.hullId,
    mapId: player.spawnPoint.mapId,
    position: { ...player.spawnPoint.position },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    hull: Math.min(ship.hullIntegrity, stats.maxHull),
    maxHull: stats.maxHull,
    // power/maxPower hold the energy store; a freshly launched ship starts fully charged.
    power: stats.energyCapacity,
    maxPower: stats.energyCapacity,
    modules: structuredClone(ship.modules),
    inventory: { ...player.resourceCounts },
    moduleCooldowns: {}
  };
}

// Returns the active saved ship or fails loudly if persistence has become internally inconsistent.
export function resolveActiveShip(player: PlayerSave): StoredShip {
  const activeShip = player.shipStable[player.activeShipId];
  if (!activeShip) {
    throw new Error(`Player ${player.playerId} is missing active ship ${player.activeShipId}.`);
  }
  return activeShip;
}

// Promotes any completed ship builds from building to ready based on the current server time.
export function syncCompletedShipBuilds(player: PlayerSave, now: number): { changed: boolean; completedShips: StoredShip[]; player: PlayerSave } {
  // completedShips is returned so callers can emit player-facing completion messages.
  const completedShips: StoredShip[] = [];
  for (const ship of Object.values(player.shipStable)) {
    if (ship.status === "building" && ship.buildCompleteAt && ship.buildCompleteAt <= now) {
      ship.status = "ready";
      completedShips.push(ship);
    }
  }
  return { changed: completedShips.length > 0, completedShips, player };
}

// Copies active ship save data back onto the live ship when modules, hull, or active ship changes.
export function syncRuntimeShipFromSave(runtimePlayer: PlayerShipState, playerSave: PlayerSave): void {
  const activeShip = resolveActiveShip(playerSave);
  const stats = getShipStats(activeShip.hullId, activeShip.modules);
  runtimePlayer.shipId = activeShip.id;
  runtimePlayer.hullId = activeShip.hullId;
  runtimePlayer.modules = structuredClone(activeShip.modules);
  runtimePlayer.maxHull = stats.maxHull;
  runtimePlayer.hull = Math.min(activeShip.hullIntegrity, stats.maxHull);
  runtimePlayer.power = Math.min(runtimePlayer.power, stats.energyCapacity);
  runtimePlayer.maxPower = stats.energyCapacity;
  runtimePlayer.inventory = { ...playerSave.resourceCounts };
}

// Copies saved resources into the live ship inventory after builder crafting/spending changes.
export function syncRuntimeInventoryFromSave(runtimePlayer: PlayerShipState, playerSave: PlayerSave): void {
  runtimePlayer.inventory = { ...playerSave.resourceCounts };
}

// Copies live runtime state into the persisted save before storage writes or builder reads.
export function syncPlayerSaveFromRuntime(runtimePlayer: PlayerShipState, playerSave: PlayerSave): PlayerSave {
  playerSave.resourceCounts = { ...runtimePlayer.inventory };

  const activeShip = playerSave.shipStable[playerSave.activeShipId];
  if (activeShip) {
    activeShip.modules = structuredClone(runtimePlayer.modules);
    activeShip.hullIntegrity = runtimePlayer.hull;
  }

  playerSave.spawnPoint = {
    mapId: runtimePlayer.mapId,
    position: { ...runtimePlayer.position }
  };

  return playerSave;
}

// Shapes the current stable, active ship, crafted modules, and build timers for the builder UI.
export function createBuilderState(player: PlayerSave, now: number): BuilderStateMessage {
  return {
    type: "builderState",
    serverTime: now,
    activeShipId: player.activeShipId,
    ships: Object.values(player.shipStable).map((ship) => ({
      shipId: ship.id,
      ship,
      remainingBuildMs: ship.status === "building" && ship.buildCompleteAt ? Math.max(0, ship.buildCompleteAt - now) : 0
    })),
    craftedModules: structuredClone(player.craftedModules)
  };
}
