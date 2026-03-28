import { getModuleDefinition, weaponDefinitions } from "@healer/content";
import { distance, normalize, scaleVec2, type ActiveMapState, type ActivateModuleMessage, type EntityId, type FireWeaponMessage, type PlayerShipState } from "@healer/shared";
import { mineTerrainAt } from "./terrain.js";

export interface ActionAttemptResult {
  ok: boolean;
  code: string;
  hardpointId?: string;
}

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
): ActionAttemptResult {
  const installedModule = findInstalledModule(player, message.weaponHardpointId);
  if (!installedModule) {
    return { ok: false, code: "weapon_not_installed" };
  }

  const moduleDefinition = getModuleDefinition(installedModule.moduleId);
  if (!moduleDefinition.capabilities.includes("weapon") || !moduleDefinition.weapon) {
    return { ok: false, code: "weapon_capability_missing", hardpointId: installedModule.hardpointId };
  }

  const weapon = weaponDefinitions.find((entry) => entry.id === moduleDefinition.weapon?.weaponId);
  if (!weapon) {
    return { ok: false, code: "weapon_definition_missing", hardpointId: installedModule.hardpointId };
  }
  if (!isModuleReady(player, installedModule.hardpointId, now)) {
    return { ok: false, code: "weapon_on_cooldown", hardpointId: installedModule.hardpointId };
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
  return { ok: true, code: "weapon_fired", hardpointId: installedModule.hardpointId };
}

export function activateInstalledModule(
  map: ActiveMapState,
  player: PlayerShipState,
  message: ActivateModuleMessage,
  now: number,
  tickCounter: number
): ActionAttemptResult {
  const installedModule = findInstalledModule(player, message.moduleId);
  if (!installedModule) {
    return { ok: false, code: "module_not_installed" };
  }

  const moduleDefinition = getModuleDefinition(installedModule.moduleId);
  if (!isModuleReady(player, installedModule.hardpointId, now)) {
    return { ok: false, code: "module_on_cooldown", hardpointId: installedModule.hardpointId };
  }

  if (moduleDefinition.capabilities.includes("mining") && moduleDefinition.mining) {
    if (!message.targetWorld) {
      return { ok: false, code: "mining_target_missing", hardpointId: installedModule.hardpointId };
    }
    if (distance(player.position, message.targetWorld) > moduleDefinition.mining.range) {
      return { ok: false, code: "mining_target_out_of_range", hardpointId: installedModule.hardpointId };
    }
    const mined = mineTerrainAt(map, message.targetWorld, tickCounter, moduleDefinition.mining.yieldMultiplier);
    if (!mined) {
      return { ok: false, code: "no_terrain_to_mine", hardpointId: installedModule.hardpointId };
    }
    markModuleUsed(player, installedModule.hardpointId, now + moduleDefinition.mining.cooldownMs);
    return { ok: true, code: "terrain_mined", hardpointId: installedModule.hardpointId };
  }

  if (moduleDefinition.capabilities.includes("support") && moduleDefinition.support) {
    const target = message.targetEntityId
      ? Object.values(map.players).find((entry) => entry.id === message.targetEntityId)
      : player;
    if (!target) {
      return { ok: false, code: "support_target_missing", hardpointId: installedModule.hardpointId };
    }
    if (target.playerId !== player.playerId && distance(player.position, target.position) > moduleDefinition.support.range) {
      return { ok: false, code: "support_target_out_of_range", hardpointId: installedModule.hardpointId };
    }
    if (target.playerId === player.playerId && !moduleDefinition.support.allowSelfTarget) {
      return { ok: false, code: "support_self_target_forbidden", hardpointId: installedModule.hardpointId };
    }
    if (target.hull >= target.maxHull) {
      return { ok: false, code: "support_target_full_hull", hardpointId: installedModule.hardpointId };
    }
    target.hull = Math.min(target.maxHull, target.hull + moduleDefinition.support.repairAmount);
    markModuleUsed(player, installedModule.hardpointId, now + moduleDefinition.support.cooldownMs);
    return { ok: true, code: "support_applied", hardpointId: installedModule.hardpointId };
  }

  return { ok: false, code: "module_capability_missing", hardpointId: installedModule.hardpointId };
}
