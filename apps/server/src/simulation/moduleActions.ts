import { getHullDefinition, getModuleDefinition, weaponDefinitions } from "@healer/content";
import { distance, normalize, scaleVec2, type ActiveMapState, type ActivateModuleMessage, type EntityId, type FireWeaponMessage, type PlayerShipState, type Vec2 } from "@healer/shared";
import { mineTerrainAt } from "./terrain.js";

export interface ActionAttemptResult {
  // ok marks whether the action mutated gameplay state.
  ok: boolean;
  // code is stable enough for GameWorld to map failures to player-facing feedback.
  code: string;
  // hardpointId identifies the installed module involved when one was found.
  hardpointId?: string;
}

// Checks whether a hardpoint cooldown has elapsed at the current server time.
function isModuleReady(player: PlayerShipState, hardpointId: string, now: number): boolean {
  return (player.moduleCooldowns[hardpointId] ?? 0) <= now;
}

// Records the next server timestamp at which a hardpoint can be used again.
function markModuleUsed(player: PlayerShipState, hardpointId: string, nextReadyAt: number): void {
  player.moduleCooldowns[hardpointId] = nextReadyAt;
}

// Finds an installed module by either hardpoint id or module id for flexible client messages.
function findInstalledModule(player: PlayerShipState, identifier: string) {
  return player.modules.find((entry) => entry.hardpointId === identifier || entry.moduleId === identifier);
}

// Returns the first installed module that exposes the requested gameplay capability.
export function findInstalledModuleByCapability(player: PlayerShipState, capability: "weapon" | "mining" | "support") {
  return player.modules.find((installed) => getModuleDefinition(installed.moduleId).capabilities.includes(capability));
}

// Validates a weapon fire request and creates a projectile when the installed module can fire.
export function applyWeaponFire(
  map: ActiveMapState,
  player: PlayerShipState,
  message: FireWeaponMessage,
  now: number,
  projectileIdFactory: () => EntityId
): ActionAttemptResult {
  // Resolve the selected installed module and verify it really owns weapon capability data.
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

  // Hardpoint orientation controls projectile direction and muzzle offset in the rotated ship frame.
  const hull = getHullDefinition(player.hullId);
  const hardpoint = hull.hardpoints.find((entry) => entry.id === installedModule.hardpointId);
  const direction = hardpoint ? rotateVec2(directionFromOrientation(hardpoint.orientation), player.rotation) : facingDirection(player.rotation);
  const mountOffset = hardpoint ? rotateVec2(hardpoint.localPosition, player.rotation) : scaleVec2(direction, 12);
  const spawnPosition = {
    x: player.position.x + mountOffset.x + direction.x * 8,
    y: player.position.y + mountOffset.y + direction.y * 8
  };

  // Projectiles use weapon range as their velocity magnitude for the current prototype.
  const projectileId = projectileIdFactory();
  map.projectiles[projectileId] = {
    id: projectileId,
    mapId: player.mapId,
    ownerPlayerId: player.playerId,
    position: spawnPosition,
    velocity: scaleVec2(direction, weapon.range),
    damage: weapon.damage,
    lifetimeMs: weapon.cooldownMs * 3
  };
  markModuleUsed(player, installedModule.hardpointId, now + weapon.cooldownMs);
  return { ok: true, code: "weapon_fired", hardpointId: installedModule.hardpointId };
}

// Validates and applies non-weapon module actions such as mining and support repair.
export function activateInstalledModule(
  map: ActiveMapState,
  player: PlayerShipState,
  message: ActivateModuleMessage,
  now: number,
  tickCounter: number
): ActionAttemptResult {
  // Most module actions start by resolving the installed module and checking shared cooldown state.
  const installedModule = findInstalledModule(player, message.moduleId);
  if (!installedModule) {
    return { ok: false, code: "module_not_installed" };
  }

  const moduleDefinition = getModuleDefinition(installedModule.moduleId);
  if (!isModuleReady(player, installedModule.hardpointId, now)) {
    return { ok: false, code: "module_on_cooldown", hardpointId: installedModule.hardpointId };
  }

  // Mining targets world-space terrain and consumes cooldown only after a tile is actually mined.
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

  // Support modules repair the requested allied ship, defaulting to self when no target is provided.
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

// Converts a ship rotation angle into a normalized forward vector.
function facingDirection(rotation: number): Vec2 {
  return normalize({
    x: Math.cos(rotation),
    y: Math.sin(rotation)
  });
}

// Converts a hardpoint's named local orientation into an unrotated unit vector.
function directionFromOrientation(orientation: string): Vec2 {
  switch (orientation) {
    case "north":
      return { x: 0, y: -1 };
    case "south":
      return { x: 0, y: 1 };
    case "west":
      return { x: -1, y: 0 };
    case "northEast":
      return normalize({ x: 1, y: -1 });
    case "northWest":
      return normalize({ x: -1, y: -1 });
    case "southEast":
      return normalize({ x: 1, y: 1 });
    case "southWest":
      return normalize({ x: -1, y: 1 });
    case "east":
    default:
      return { x: 1, y: 0 };
  }
}

// Rotates a vector from ship-local space into world space.
function rotateVec2(vector: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}
