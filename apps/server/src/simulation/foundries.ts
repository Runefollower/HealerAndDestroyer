import { enemyDefinitions, findEnemyDefinition, structureDefinitions } from "@healer/content";
import { asEntityId, distance, type ActiveMapState, type EnemyState, type FoundryState, type MapId, type ResourceMap, type Vec2 } from "@healer/shared";
import { findNearestValidPosition, getEnemyCollisionRadius, isPositionBlocked } from "./collision.js";
import type { FoundryContentConfig } from "./mapArchetypes.js";

// Each extra level of depth adds this fraction of base health to a foundry (depth 1 is the baseline).
const foundryHealthPerDepth = 0.25;
// Each level of depth adds this fraction of the base reward (root is depth 0, so it gets the base reward).
const foundryRewardPerDepth = 0.5;
// Every two levels of depth add one more defense turret to a fortification pocket.
const depthLevelsPerExtraDefense = 2;
// Defense turrets sit on a ring this far from the foundry center, inside the foundry chamber.
const defenseRingRadius = 104;
// Turrets keep this much room from exits, builder sites, and each other so they never plug a route.
const defenseKeepoutRadius = 80;
const defenseMinSpacing = 56;
// The enemy type that fills fortification slots.
export const DEFENSE_TURRET_TYPE_ID = "defense-turret";
// Used when a foundry has no enemy mix (old saves): every mobile enemy type in content order.
const defaultEnemyMix = enemyDefinitions.filter((entry) => entry.role !== "turret").map((entry) => entry.id);
import { emitEffect } from "./effects.js";

export interface FoundryDamageResult {
  // hit identifies that damage landed on an active foundry.
  hit: boolean;
  // destroyedFoundry is present when the hit reduced health to zero.
  destroyedFoundry?: FoundryState;
}

export interface CreateFoundryOptions {
  id: string;
  mapId: MapId;
  position: Vec2;
  config: FoundryContentConfig;
  depth: number;
  now: number;
  // activeEnemyCount lets the root map count its hand-placed starter enemy toward the cap.
  activeEnemyCount?: number;
}

// Builds a foundry from archetype content config, scaling health, defenses, and reward for map depth.
// Defense slots are planned separately (planFoundryDefenses) because they need the map's terrain.
export function createFoundry(options: CreateFoundryOptions): FoundryState {
  const definition = structureDefinitions.find((entry) => entry.id === "enemy-foundry");
  const baseHealth = definition?.maxHealth ?? 350;
  const healthScale = 1 + foundryHealthPerDepth * Math.max(0, options.depth - 1);
  const maxHealth = Math.round(baseHealth * options.config.healthMultiplier * healthScale);
  return {
    id: asEntityId(options.id),
    mapId: options.mapId,
    ownerType: "enemy",
    structureTypeId: definition?.id ?? "enemy-foundry",
    position: { ...options.position },
    health: maxHealth,
    maxHealth,
    buildState: "active",
    spawnCooldownMs: options.config.spawnCooldownMs,
    spawnCap: options.config.spawnCap,
    lastSpawnAt: options.now,
    activeEnemyCount: options.activeEnemyCount ?? 0,
    active: true,
    destroyedAt: null,
    enemyMix: [...options.config.enemyMix],
    defenseSlots: [],
    defenseRebuildMs: options.config.defenseRebuildMs,
    reward: scaleFoundryReward(options.config.reward, options.depth)
  };
}

// Scales a base foundry reward for map depth, rounding each resource to a whole number.
export function scaleFoundryReward(base: ResourceMap, depth: number): ResourceMap {
  const scale = 1 + foundryRewardPerDepth * Math.max(0, depth);
  return Object.fromEntries(Object.entries(base).map(([resourceId, amount]) => [resourceId, Math.round(amount * scale)]));
}

// Number of defense turrets a foundry of this config gets at a given depth.
export function defenseCountForDepth(config: FoundryContentConfig, depth: number): number {
  return config.defenseCount + Math.floor(Math.max(0, depth) / depthLevelsPerExtraDefense);
}

// Picks fortification slots on a ring around the foundry. Slots must be open terrain for a turret body,
// and stay clear of the given keep-out points (exits, spawns) and builder sites so a turret can never
// block a route. Deterministic for a given map and foundry, so regenerated maps get the same pocket.
export function planFoundryDefenses(map: ActiveMapState, foundry: FoundryState, count: number, keepOut: Vec2[] = []): Vec2[] {
  const turretRadius = getEnemyCollisionRadius({ enemyTypeId: DEFENSE_TURRET_TYPE_ID });
  const avoid = [...keepOut, ...Object.values(map.structures).map((structure) => structure.position)];
  const slots: Vec2[] = [];
  // Try 16 evenly spaced angles, starting at a per-foundry offset, then take every slot that fits
  // in an order that spreads them around the ring (opposite sides first).
  const angleCount = 16;
  const startAngle = (hashString(foundry.id) % angleCount) * ((Math.PI * 2) / angleCount);
  const order = spreadOrder(angleCount);
  for (const index of order) {
    if (slots.length >= count) {
      break;
    }
    const angle = startAngle + (index * Math.PI * 2) / angleCount;
    const candidate = {
      x: Math.round(foundry.position.x + Math.cos(angle) * defenseRingRadius),
      y: Math.round(foundry.position.y + Math.sin(angle) * defenseRingRadius)
    };
    if (isPositionBlocked(map, candidate, turretRadius + 4)) {
      continue;
    }
    if (avoid.some((point) => distance(point, candidate) < defenseKeepoutRadius)) {
      continue;
    }
    if (slots.some((slot) => distance(slot, candidate) < defenseMinSpacing)) {
      continue;
    }
    slots.push(candidate);
  }
  return slots;
}

// Fills every empty defense slot of each active foundry immediately. Used when a map is created or loaded
// (enemies are not persisted, so a restarted server re-garrisons standing foundries).
export function seedFoundryDefenses(map: ActiveMapState, now: number): void {
  for (const foundry of Object.values(map.foundries)) {
    if (!isFoundryOperational(foundry)) {
      continue;
    }
    for (const slotIndex of emptyDefenseSlots(map, foundry)) {
      spawnDefense(map, foundry, slotIndex);
    }
    foundry.lastDefenseRebuildAt = now;
  }
}

// Called when a fortification defense dies: restarts that foundry's rebuild timer so losses are not
// replaced in the middle of an assault (GDD §12.2).
export function noteDefenseLost(map: ActiveMapState, enemy: EnemyState, now: number): void {
  const foundry = enemy.defendsFoundryId ? map.foundries[enemy.defendsFoundryId] : undefined;
  if (foundry) {
    foundry.lastDefenseRebuildAt = now;
  }
}

// Recounts living enemies assigned to each foundry so spawn caps stay accurate after kills/reloads.
export function refreshFoundryEnemyCounts(map: ActiveMapState): void {
  for (const foundry of Object.values(map.foundries)) {
    foundry.activeEnemyCount = Object.values(map.enemies).filter((enemy) => enemy.sourceFoundryId === foundry.id).length;
  }
}

// Applies projectile damage to the foundry near the impact point and drops rewards on destruction.
export function applyFoundryDamage(map: ActiveMapState, position: { x: number; y: number }, damage: number, tickCounter: number): FoundryDamageResult {
  // A small radius lets projectile impacts damage the structure without exact center hits.
  const foundry = Object.values(map.foundries).find((entry) => entry.active && distance(entry.position, position) < 20);
  if (!foundry) {
    return { hit: false };
  }

  foundry.health = Math.max(0, foundry.health - damage);
  if (foundry.health === 0) {
    // Destruction disables future spawns and defense rebuilds and produces a depth-scaled resource drop.
    foundry.active = false;
    foundry.buildState = "destroyed";
    foundry.destroyedAt = Date.now();
    map.drops[`foundry-${foundry.id}-${tickCounter}`] = {
      id: asEntityId(`foundry-${foundry.id}-${tickCounter}`),
      mapId: map.id,
      position: { ...foundry.position },
      resources: { ...(foundry.reward ?? { ferrite: 30, "plasma-crystal": 10 }) }
    };
    emitEffect(map, {
      id: `foundry-${foundry.id}-${tickCounter}`,
      kind: "explosion",
      position: { ...foundry.position },
      radius: 64,
      tint: 0xff8a4c,
      tick: tickCounter
    });
    return { hit: true, destroyedFoundry: foundry };
  }
  return { hit: true };
}

// Advances foundry production, spawning enemies while respecting cooldowns and local caps, and slowly
// rebuilding lost fortification defenses while the foundry stands.
export function tickFoundries(map: ActiveMapState, now: number, spawnIdFactory: () => string): void {
  refreshFoundryEnemyCounts(map);

  // Each active foundry independently checks cap/cooldown before placing one enemy.
  for (const foundry of Object.values(map.foundries)) {
    if (!isFoundryOperational(foundry)) {
      continue;
    }

    rebuildOneDefense(map, foundry, now);

    if (foundry.activeEnemyCount >= foundry.spawnCap) {
      continue;
    }

    if (now - foundry.lastSpawnAt < foundry.spawnCooldownMs) {
      continue;
    }

    // Cycle through the foundry's enemy mix by current population so the unit blend stays stable.
    const mix = foundry.enemyMix && foundry.enemyMix.length > 0 ? foundry.enemyMix : defaultEnemyMix;
    const enemyDefinition = findEnemyDefinition(mix[foundry.activeEnemyCount % mix.length]) ?? enemyDefinitions[0];
    const enemyId = asEntityId(spawnIdFactory());
    const desiredPosition = {
      x: foundry.position.x + 24 + foundry.activeEnemyCount * 8,
      y: foundry.position.y + 12
    };
    map.enemies[enemyId] = {
      id: enemyId,
      mapId: map.id,
      enemyTypeId: enemyDefinition.id,
      position: findNearestValidPosition(map, desiredPosition, getEnemyCollisionRadius({ enemyTypeId: enemyDefinition.id }), {
        includePlayers: true,
        includeEnemies: true
      }),
      velocity: { x: 0, y: 0 },
      rotation: 0,
      health: enemyDefinition.maxHealth,
      aiState: "idle",
      sourceFoundryId: foundry.id
    };
    foundry.lastSpawnAt = now;
    foundry.activeEnemyCount += 1;
  }
}

// The deeper route unlocks once every foundry on the map is inactive or destroyed.
export function isDeeperPathUnlocked(rootMap: ActiveMapState): boolean {
  return Object.values(rootMap.foundries).every((foundry) => !foundry.active || foundry.buildState === "destroyed");
}

// Replaces template foundries with persisted copies during world initialization. Fields an older save
// lacks (enemy mix, defense slots, reward) are kept from the template.
export function rehydrateFoundries(map: ActiveMapState, foundries: FoundryState[]): void {
  map.foundries = Object.fromEntries(foundries.map((foundry) => [foundry.id, mergeFoundry(map.foundries[foundry.id], structuredClone(foundry))]));
}

// Overlays persisted foundry fields on a template foundry, ignoring persisted fields that are missing.
export function mergeFoundry(template: FoundryState | undefined, persisted: FoundryState): FoundryState {
  if (!template) {
    return persisted;
  }
  const defined = Object.fromEntries(Object.entries(persisted).filter(([, value]) => value !== undefined));
  return { ...template, ...defined } as FoundryState;
}

function isFoundryOperational(foundry: FoundryState): boolean {
  return foundry.active && foundry.buildState !== "destroyed";
}

// Rebuilds at most one empty defense slot once the rebuild interval has passed since the last loss/rebuild.
function rebuildOneDefense(map: ActiveMapState, foundry: FoundryState, now: number): void {
  const rebuildMs = foundry.defenseRebuildMs;
  if (!rebuildMs || !foundry.defenseSlots?.length) {
    return;
  }
  const last = foundry.lastDefenseRebuildAt ?? now;
  if (now - last < rebuildMs) {
    return;
  }
  const [slotIndex] = emptyDefenseSlots(map, foundry);
  if (slotIndex === undefined) {
    // Fully garrisoned: keep the timer fresh so the next loss waits a full interval.
    foundry.lastDefenseRebuildAt = now;
    return;
  }
  // A ship parked on the slot postpones the rebuild instead of trapping it inside a turret.
  const slot = foundry.defenseSlots[slotIndex];
  const radius = getEnemyCollisionRadius({ enemyTypeId: DEFENSE_TURRET_TYPE_ID });
  if (isPositionBlocked(map, slot, radius, { includePlayers: true, includeEnemies: true })) {
    return;
  }
  spawnDefense(map, foundry, slotIndex);
  foundry.lastDefenseRebuildAt = now;
}

// Lists defense slot indexes that have no living turret.
function emptyDefenseSlots(map: ActiveMapState, foundry: FoundryState): number[] {
  const filled = new Set(
    Object.values(map.enemies)
      .filter((enemy) => enemy.defendsFoundryId === foundry.id)
      .map((enemy) => enemy.defenseSlotIndex)
  );
  return (foundry.defenseSlots ?? []).map((_, index) => index).filter((index) => !filled.has(index));
}

function spawnDefense(map: ActiveMapState, foundry: FoundryState, slotIndex: number): void {
  const definition = findEnemyDefinition(DEFENSE_TURRET_TYPE_ID);
  const slot = foundry.defenseSlots?.[slotIndex];
  if (!definition || !slot) {
    return;
  }
  const id = asEntityId(`defense-${foundry.id}-${slotIndex}`);
  map.enemies[id] = {
    id,
    mapId: map.id,
    enemyTypeId: definition.id,
    position: { ...slot },
    velocity: { x: 0, y: 0 },
    // Turrets start facing outward from the foundry.
    rotation: Math.atan2(slot.y - foundry.position.y, slot.x - foundry.position.x),
    health: definition.maxHealth,
    aiState: "idle",
    sourceFoundryId: null,
    defendsFoundryId: foundry.id,
    defenseSlotIndex: slotIndex
  };
}

// Visits ring indexes so successive picks land far apart: 0, 8, 4, 12, 2, 10, ...
function spreadOrder(count: number): number[] {
  const order: number[] = [];
  for (let step = count; step >= 1; step = Math.floor(step / 2)) {
    for (let index = 0; index < count; index += step) {
      if (!order.includes(index)) {
        order.push(index);
      }
    }
    if (step === 1) {
      break;
    }
  }
  return order;
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}
