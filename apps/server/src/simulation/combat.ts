import { findEnemyDefinition, getHullDefinition, getModuleDefinition } from "@healer/content";
import {
  addResourceMaps,
  asEntityId,
  distance,
  normalize,
  scaleVec2,
  type ActiveMapState,
  type EnemyDefinition,
  type EnemyState,
  type PlayerShipState,
  type ResourceMap,
  type StoredShip
} from "@healer/shared";
import { getEnemyCollisionRadius, getPlayerShipCollisionRadius, resolveMovement } from "./collision.js";
import { noteDefenseLost, refreshFoundryEnemyCounts } from "./foundries.js";
import { findNearestVisiblePlayer } from "./visibility.js";

// A respawned ship ignores damage for this long so it cannot be camped at the spawn point.
export const RESPAWN_INVULNERABILITY_MS = 3000;
// Wreck salvage is reserved for the ship's owner for this long before anyone can take it (GDD §16.4).
export const WRECK_OWNER_PROTECTION_MS = 60000;
// Share of carried resources that spills into the wreck on destruction. The rest stays with the player.
export const CARGO_SPILL_FRACTION = 0.5;
// Share of the destroyed ship's hull and module build cost recoverable from the wreck.
export const WRECK_SALVAGE_FRACTION = 0.5;
// Contact damage lands when bodies are within this many pixels of touching.
const contactReach = 4;
// Ranged enemies stop backing off or closing in once within this band around their preferred range.
const rangeBand = 24;

// PlayerDestruction records a ship whose hull reached zero this tick so GameWorld can run the respawn flow.
export interface PlayerDestruction {
  player: PlayerShipState;
  cause: string;
}

// Applies damage to a player ship. Returns true when this hit destroyed it (hull went from >0 to 0).
export function damagePlayerShip(player: PlayerShipState, amount: number, now: number): boolean {
  if (amount <= 0 || player.hull <= 0 || (player.invulnerableUntil ?? 0) > now) {
    return false;
  }
  player.hull = Math.max(0, player.hull - amount);
  return player.hull === 0;
}

// Updates every enemy's AI for one tick: target the nearest visible player, move by role, and attack.
// Returns the player ships destroyed this tick.
export function tickEnemies(map: ActiveMapState, deltaSeconds: number, now: number, projectileIdFactory: () => string): PlayerDestruction[] {
  const destroyed: PlayerDestruction[] = [];
  for (const enemy of Object.values(map.enemies)) {
    const definition = findEnemyDefinition(enemy.enemyTypeId);
    if (!definition) {
      continue;
    }

    // Enemy vision uses the same terrain line-of-sight rules as player snapshots.
    const target = findNearestVisiblePlayer(map, enemy);
    if (!target || target.hull <= 0) {
      enemy.aiState = "idle";
      enemy.velocity = { x: 0, y: 0 };
      continue;
    }

    enemy.aiState = "chasing";
    const toTarget = { x: target.position.x - enemy.position.x, y: target.position.y - enemy.position.y };
    const range = Math.hypot(toTarget.x, toTarget.y);
    const direction = normalize(toTarget);
    enemy.rotation = Math.atan2(direction.y, direction.x);

    moveEnemy(map, enemy, definition, direction, range, deltaSeconds);

    // Contact damage: one hit per attack cooldown while touching, using the enemy's own damage value.
    const reach = getEnemyCollisionRadius(enemy) + getPlayerShipCollisionRadius(target) + contactReach;
    if (definition.contactDamage > 0 && distance(enemy.position, target.position) <= reach && (enemy.nextAttackAt ?? 0) <= now) {
      enemy.nextAttackAt = now + definition.attackCooldownMs;
      if (damagePlayerShip(target, definition.contactDamage, now)) {
        destroyed.push({ player: target, cause: definition.name });
      }
      continue;
    }

    // Ranged fire: a straight bolt at the target once in range and off cooldown.
    if (definition.ranged && range <= definition.ranged.range && (enemy.nextAttackAt ?? 0) <= now) {
      enemy.nextAttackAt = now + definition.ranged.cooldownMs;
      fireEnemyBolt(map, enemy, definition, direction, projectileIdFactory());
    }
  }
  refreshFoundryEnemyCounts(map);
  return destroyed;
}

// Steers an enemy by role: melee units close in, ranged units hold their preferred range, turrets stay put.
function moveEnemy(map: ActiveMapState, enemy: EnemyState, definition: EnemyDefinition, direction: { x: number; y: number }, range: number, deltaSeconds: number): void {
  let heading = 0;
  if (definition.role === "melee") {
    heading = 1;
  } else if (definition.role === "ranged" && definition.ranged) {
    const preferred = definition.ranged.preferredRange;
    heading = range > preferred + rangeBand ? 1 : range < preferred - rangeBand ? -1 : 0;
  }
  if (heading === 0 || definition.speed <= 0) {
    enemy.velocity = { x: 0, y: 0 };
    return;
  }

  enemy.velocity = scaleVec2(direction, definition.speed * heading);
  const resolved = resolveMovement(map, enemy.position, enemy.velocity, deltaSeconds, {
    radius: getEnemyCollisionRadius(enemy),
    excludeEntityId: enemy.id,
    includePlayers: true,
    includeEnemies: true
  });
  enemy.position = resolved.position;
  enemy.velocity = resolved.velocity;
}

function fireEnemyBolt(map: ActiveMapState, enemy: EnemyState, definition: EnemyDefinition, direction: { x: number; y: number }, rawId: string): void {
  const ranged = definition.ranged;
  if (!ranged) {
    return;
  }
  const id = asEntityId(rawId);
  const muzzle = getEnemyCollisionRadius(enemy) + 4;
  map.projectiles[id] = {
    id,
    mapId: map.id,
    faction: "enemy",
    ownerEnemyId: enemy.id,
    ownerPlayerId: null,
    position: { x: enemy.position.x + direction.x * muzzle, y: enemy.position.y + direction.y * muzzle },
    velocity: scaleVec2(direction, ranged.projectileSpeed),
    damage: ranged.damage,
    // Bolts fly a little past their firing range so a target at the edge can still be hit.
    lifetimeMs: Math.ceil(((ranged.range * 1.25) / ranged.projectileSpeed) * 1000)
  };
}

// Returns the player ship an enemy bolt at this position hits, if any.
export function findBoltPlayerHit(map: ActiveMapState, position: { x: number; y: number }): PlayerShipState | null {
  return Object.values(map.players).find((player) => player.hull > 0 && distance(player.position, position) <= getPlayerShipCollisionRadius(player) + 2) ?? null;
}

// Removes a killed enemy, drops its salvage, and updates its foundry's spawn count or rebuild timer.
export function killEnemy(map: ActiveMapState, enemy: EnemyState, now: number): void {
  const definition = findEnemyDefinition(enemy.enemyTypeId);
  map.drops[`drop-${enemy.id}`] = {
    id: asEntityId(`drop-${enemy.id}`),
    mapId: enemy.mapId,
    position: { ...enemy.position },
    resources: { ...(definition?.salvage ?? { ferrite: 1 }) }
  };
  delete map.enemies[enemy.id];
  if (enemy.defendsFoundryId) {
    noteDefenseLost(map, enemy, now);
  }
  refreshFoundryEnemyCounts(map);
}

// WreckSalvage is what a destroyed ship leaves behind and what the owner keeps.
export interface WreckSalvage {
  // spilled is the resource payload of the wreck drop.
  spilled: ResourceMap;
  // keptInventory is the carried inventory left after the spill.
  keptInventory: ResourceMap;
}

// Splits a destroyed ship's cargo and hardware into wreck salvage (GDD §4.3, §16): half of the carried
// resources spill, plus half the build cost of the hull and installed modules.
export function computeWreckSalvage(inventory: ResourceMap, ship: Pick<StoredShip, "hullId" | "modules">): WreckSalvage {
  const spilled: ResourceMap = {};
  const keptInventory: ResourceMap = {};
  for (const [resourceId, amount] of Object.entries(inventory)) {
    const spill = Math.floor(amount * CARGO_SPILL_FRACTION);
    keptInventory[resourceId] = amount - spill;
    if (spill > 0) {
      spilled[resourceId] = spill;
    }
  }

  let hardware: ResourceMap = { ...getHullDefinition(ship.hullId).buildCost };
  for (const installed of ship.modules) {
    hardware = addResourceMaps(hardware, getModuleDefinition(installed.moduleId).buildCost);
  }
  for (const [resourceId, amount] of Object.entries(hardware)) {
    const salvage = Math.floor(amount * WRECK_SALVAGE_FRACTION);
    if (salvage > 0) {
      spilled[resourceId] = (spilled[resourceId] ?? 0) + salvage;
    }
  }
  return { spilled, keptInventory };
}

// Whether a player may pick up a drop now: unprotected drops are open to anyone, protected wreck salvage
// only to its owner until the protection expires.
export function canCollectDrop(drop: ActiveMapState["drops"][string], player: PlayerShipState, now: number): boolean {
  if (player.hull <= 0) {
    return false;
  }
  if (!drop.ownerPlayerId || !drop.protectedUntil || drop.protectedUntil <= now) {
    return true;
  }
  return drop.ownerPlayerId === player.playerId;
}
