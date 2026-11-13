import { deriveShipMovementProfile, type InstalledModule, type ShipMovementProfile } from "@healer/shared";
import { hullDefinitions } from "./hulls.js";
import { moduleDefinitions } from "./modules.js";

// Energy always trickles back at this rate, even when the loadout uses the whole power budget.
export const ENERGY_REGEN_BASE_PER_SECOND = 8;
// Each point of unused power budget adds this much energy recharge per second.
export const ENERGY_REGEN_PER_SURPLUS_POWER = 0.5;

export interface ShipStats {
  // totalMass is hull mass plus every installed module's mass.
  totalMass: number;
  // totalThrust and totalTorque combine hull baselines with engine modules.
  totalThrust: number;
  totalTorque: number;
  // powerOutput is the budget (hull reactor plus power modules); powerDraw is the sum of module powerUse.
  powerOutput: number;
  powerDraw: number;
  // energyCapacity and energyRegenPerSecond describe the store that weapons and support tools spend.
  energyCapacity: number;
  energyRegenPerSecond: number;
  // maxHull is hull integrity including armor bonuses.
  maxHull: number;
  movement: ShipMovementProfile;
}

// Derives the gameplay stats of a hull plus loadout. Used by the server simulation, client prediction, and
// the builder preview so all three agree.
export function deriveShipStats(hullId: string, modules: Pick<InstalledModule, "moduleId">[]): ShipStats {
  const hull = hullDefinitions.find((entry) => entry.id === hullId);
  if (!hull) {
    throw new Error(`Unknown hull definition: ${hullId}`);
  }
  let totalMass = hull.mass;
  let totalThrust = hull.baseThrust;
  let totalTorque = hull.torque;
  let powerOutput = hull.powerCapacity;
  let powerDraw = 0;
  let energyCapacity = hull.energyCapacity;
  let maxHull = hull.baseHull;

  for (const installed of modules) {
    const module = moduleDefinitions.find((entry) => entry.id === installed.moduleId);
    if (!module) {
      throw new Error(`Unknown module definition: ${installed.moduleId}`);
    }
    totalMass += module.mass;
    powerDraw += module.powerUse;
    totalThrust += module.engine?.thrust ?? 0;
    totalTorque += module.engine?.torque ?? 0;
    powerOutput += module.power?.output ?? 0;
    energyCapacity += module.power?.storage ?? 0;
    maxHull += module.armor?.hullBonus ?? 0;
  }

  const surplus = Math.max(0, powerOutput - powerDraw);
  return {
    totalMass,
    totalThrust,
    totalTorque,
    powerOutput,
    powerDraw,
    energyCapacity,
    energyRegenPerSecond: ENERGY_REGEN_BASE_PER_SECOND + surplus * ENERGY_REGEN_PER_SURPLUS_POWER,
    maxHull,
    movement: deriveShipMovementProfile(totalThrust, totalTorque, totalMass)
  };
}

const statsCache = new Map<string, ShipStats>();

// Cached deriveShipStats for per-tick callers. Content is static, so the hull plus module list is a full key.
export function getShipStats(hullId: string, modules: Pick<InstalledModule, "moduleId">[]): ShipStats {
  const key = `${hullId}|${modules.map((module) => module.moduleId).join(",")}`;
  let stats = statsCache.get(key);
  if (!stats) {
    stats = deriveShipStats(hullId, modules);
    if (statsCache.size > 256) {
      statsCache.clear();
    }
    statsCache.set(key, stats);
  }
  return stats;
}
