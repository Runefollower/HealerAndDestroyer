import type { HullDefinition, ModuleDefinition } from "@healer/shared";
import { enemyDefinitions } from "./enemies.js";
import { hullDefinitions } from "./hulls.js";
import { moduleDefinitions, weaponDefinitions } from "./modules.js";
import { resourceDefinitions } from "./resources.js";
import { structureDefinitions } from "./structures.js";

export * from "./enemies.js";
export * from "./hulls.js";
export * from "./modules.js";
export * from "./resources.js";
export * from "./structures.js";

export function getHullDefinition(hullId: string): HullDefinition {
  const hull = hullDefinitions.find((entry) => entry.id === hullId);
  if (!hull) {
    throw new Error(`Unknown hull definition: ${hullId}`);
  }
  return hull;
}

export function getModuleDefinition(moduleId: string): ModuleDefinition {
  const module = moduleDefinitions.find((entry) => entry.id === moduleId);
  if (!module) {
    throw new Error(`Unknown module definition: ${moduleId}`);
  }
  return module;
}

export function validateContent(): void {
  if (hullDefinitions.length < 2) {
    throw new Error("At least two starter hulls are required.");
  }

  if (moduleDefinitions.length < 3) {
    throw new Error("At least three modules are required.");
  }

  for (const hull of hullDefinitions) {
    if (hull.hardpoints.length === 0) {
      throw new Error(`Hull ${hull.id} has no hardpoints.`);
    }
  }

  for (const module of moduleDefinitions) {
    const compatibleHull = hullDefinitions.some((hull) =>
      hull.hardpoints.some((hardpoint) => hardpoint.type === module.slotType)
    );
    if (!compatibleHull) {
      throw new Error(`Module ${module.id} has no compatible starter hull.`);
    }
  }

  if (enemyDefinitions.length < 2 || structureDefinitions.length < 1 || resourceDefinitions.length < 2 || weaponDefinitions.length < 2) {
    throw new Error("Content seed set is incomplete.");
  }
}

