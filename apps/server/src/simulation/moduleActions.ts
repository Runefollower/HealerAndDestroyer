import { getModuleDefinition, weaponDefinitions } from "@healer/content";
import { distance, normalize, scaleVec2, type ActiveMapState, type ActivateModuleMessage, type EntityId, type FireWeaponMessage, type PlayerShipState } from "@healer/shared";
import { mineTerrainAt } from "./terrain.js";

function isModuleReady(player: PlayerShipState, hardpointId: string, now: number): boolean {
  return (player.moduleCooldowns[hardpointId] ?? 0) <= now;
}

function markModuleUsed(player: PlayerShipState, hardpointId: string, nextReadyAt: number): void {
  player.moduleCooldowns[hardpointId] = nextReadyAt;
}

function findInstalledModule(player: PlayerShipState, identifier: string) {
  return player.modules.find((entry) => entry.hardpointId === identifier || entry.moduleId === identifier);
}

export function findInstalledModuleByCapability(player: PlayerShipState, capability: "weapon" | "mining" | "support") {
  return player.modules.find((installed) => getModuleDefinition(installed.moduleId).capabilities.includes(capability));
}

export function applyWeaponFire(
  map: ActiveMapState,
  player: PlayerShipState,
  message: FireWeaponMessage,
  now: number,
  projectileIdFactory: () => EntityId
): boolean {
  const installedModule = findInstalledModule(player, message.weaponHardpointId);
  if (!installedModule) {
    return false;
  }

  const moduleDefinition = getModuleDefinition(installedModule.moduleId);
  if (!moduleDefinition.capabilities.includes("weapon") || !moduleDefinition.weapon) {
    return false;
  }

  const weapon = weaponDefinitions.find((entry) => entry.id === moduleDefinition.weapon?.weaponId);
  if (!weapon || !isModuleReady(player, installedModule.hardpointId, now)) {
    return false;
  }

  const direction = normalize({
    x: (message.targetWorld?.x ?? player.position.x + 1) - player.position.x,
    y: (message.targetWorld?.y ?? player.position.y) - player.position.y
  });
  const projectileId = projectileIdFactory();
  map.projectiles[projectileId] = {
    id: projectileId,
    mapId: player.mapId,
    ownerPlayerId: player.playerId,
    position: { ...player.position },
    velocity: scaleVec2(direction, weapon.range),
    damage: weapon.damage,
    lifetimeMs: weapon.cooldownMs * 3
  };
  markModuleUsed(player, installedModule.hardpointId, now + weapon.cooldownMs);
  return true;
}

export function activateInstalledModule(
  map: ActiveMapState,
  player: PlayerShipState,
  message: ActivateModuleMessage,
  now: number,
  tickCounter: number
): boolean {
  const installedModule = findInstalledModule(player, message.moduleId);
  if (!installedModule) {
    return false;
  }

  const moduleDefinition = getModuleDefinition(installedModule.moduleId);
  if (!isModuleReady(player, installedModule.hardpointId, now)) {
    return false;
  }

  if (moduleDefinition.capabilities.includes("mining") && moduleDefinition.mining && message.targetWorld) {
    if (distance(player.position, message.targetWorld) > moduleDefinition.mining.range) {
      return false;
    }
    const mined = mineTerrainAt(map, message.targetWorld, tickCounter, moduleDefinition.mining.yieldMultiplier);
    if (mined) {
      markModuleUsed(player, installedModule.hardpointId, now + moduleDefinition.mining.cooldownMs);
    }
    return mined;
  }

  if (moduleDefinition.capabilities.includes("support") && moduleDefinition.support) {
    const target = message.targetEntityId
      ? Object.values(map.players).find((entry) => entry.id === message.targetEntityId)
      : player;
    if (!target) {
      return false;
    }
    if (target.playerId !== player.playerId && distance(player.position, target.position) > moduleDefinition.support.range) {
      return false;
    }
    if (target.playerId === player.playerId && !moduleDefinition.support.allowSelfTarget) {
      return false;
    }
    target.hull = Math.min(target.maxHull, target.hull + moduleDefinition.support.repairAmount);
    markModuleUsed(player, installedModule.hardpointId, now + moduleDefinition.support.cooldownMs);
    return true;
  }

  return false;
}

