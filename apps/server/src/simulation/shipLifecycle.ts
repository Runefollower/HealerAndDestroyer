import { getHullDefinition } from "@healer/content";
import { asEntityId, type BuilderStateMessage, type PlayerSave, type PlayerShipState, type StoredShip } from "@healer/shared";

export function createRuntimeShip(playerId: PlayerShipState["playerId"], ship: StoredShip, player: PlayerSave): PlayerShipState {
  const hull = getHullDefinition(ship.hullId);
  return {
    id: asEntityId(`entity-${ship.id}`),
    playerId,
    shipId: ship.id,
    mapId: player.spawnPoint.mapId,
    position: { ...player.spawnPoint.position },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    hull: ship.hullIntegrity,
    maxHull: hull.baseHull,
    power: hull.powerCapacity,
    maxPower: hull.powerCapacity,
    modules: structuredClone(ship.modules),
    inventory: { ...player.resourceCounts },
    moduleCooldowns: {}
  };
}

export function resolveActiveShip(player: PlayerSave): StoredShip {
  const activeShip = player.shipStable[player.activeShipId];
  if (!activeShip) {
    throw new Error(`Player ${player.playerId} is missing active ship ${player.activeShipId}.`);
  }
  return activeShip;
}

export function syncCompletedShipBuilds(player: PlayerSave, now: number): { changed: boolean; completedShips: StoredShip[]; player: PlayerSave } {
  const completedShips: StoredShip[] = [];
  for (const ship of Object.values(player.shipStable)) {
    if (ship.status === "building" && ship.buildCompleteAt && ship.buildCompleteAt <= now) {
      ship.status = "ready";
      completedShips.push(ship);
    }
  }
  return { changed: completedShips.length > 0, completedShips, player };
}

export function syncRuntimeShipFromSave(runtimePlayer: PlayerShipState, playerSave: PlayerSave): void {
  const activeShip = resolveActiveShip(playerSave);
  const hull = getHullDefinition(activeShip.hullId);
  runtimePlayer.shipId = activeShip.id;
  runtimePlayer.modules = structuredClone(activeShip.modules);
  runtimePlayer.hull = activeShip.hullIntegrity;
  runtimePlayer.maxHull = hull.baseHull;
  runtimePlayer.power = Math.min(runtimePlayer.power, hull.powerCapacity);
  runtimePlayer.maxPower = hull.powerCapacity;
  runtimePlayer.inventory = { ...playerSave.resourceCounts };
}

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
