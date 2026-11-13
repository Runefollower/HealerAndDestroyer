import { describe, expect, it } from "vitest";
import { DEFAULT_SHIP_MOVEMENT_PROFILE } from "@healer/shared";
import { deriveShipStats, getHullDefinition, getShipStats, validateContent } from "./index.js";
import { hullDefinitions } from "./hulls.js";
import { moduleDefinitions } from "./modules.js";
import { resourceDefinitions } from "./resources.js";

describe("content package", () => {
  it("contains valid starter content", () => {
    expect(() => validateContent()).not.toThrow();
  });

  it("can instantiate a starter hull with modules", () => {
    const hull = getHullDefinition("sparrow-scout");
    const compatibleModules = moduleDefinitions.filter((module) =>
      hull.hardpoints.some((hardpoint) => hardpoint.type === module.slotType)
    );

    expect(compatibleModules.length).toBeGreaterThan(0);
  });

  it("defines the first-pass terrain resource economy", () => {
    expect(resourceDefinitions.map((resource) => resource.id)).toEqual(["rock", "stone", "ferrite", "plasma-crystal"]);
  });

  it("derives the original movement constants for the starter Sparrow loadout", () => {
    const stats = deriveShipStats("sparrow-scout", [{ moduleId: "starter-thruster" }, { moduleId: "pulse-cannon" }, { moduleId: "mining-laser" }]);

    expect(stats.totalMass).toBe(70);
    expect(stats.movement.forwardAcceleration).toBeCloseTo(DEFAULT_SHIP_MOVEMENT_PROFILE.forwardAcceleration, 5);
    expect(stats.movement.reverseAcceleration).toBeCloseTo(DEFAULT_SHIP_MOVEMENT_PROFILE.reverseAcceleration, 5);
    expect(stats.movement.rotationStep).toBeCloseTo(DEFAULT_SHIP_MOVEMENT_PROFILE.rotationStep, 5);
    expect(stats.powerDraw).toBeLessThanOrEqual(stats.powerOutput);
  });

  it("makes mass slow a ship down and engines speed it back up", () => {
    const light = deriveShipStats("sparrow-scout", [{ moduleId: "starter-thruster" }]);
    const plated = deriveShipStats("breaker-destroyer", [{ moduleId: "starter-thruster" }, { moduleId: "reactive-plating" }]);
    const driven = deriveShipStats("breaker-destroyer", [{ moduleId: "heavy-drive" }, { moduleId: "reactive-plating" }]);

    expect(plated.movement.forwardAcceleration).toBeLessThan(light.movement.forwardAcceleration);
    expect(plated.movement.rotationStep).toBeLessThan(light.movement.rotationStep);
    expect(driven.movement.forwardAcceleration).toBeGreaterThan(plated.movement.forwardAcceleration);
    expect(plated.maxHull).toBe(getHullDefinition("breaker-destroyer").baseHull + 30);
  });

  it("turns leftover reactor power into energy recharge and lets power modules raise both", () => {
    const loadout = [{ moduleId: "rail-lance" }, { moduleId: "rail-lance" }, { moduleId: "heavy-drive" }];
    const bare = deriveShipStats("breaker-destroyer", loadout);
    const powered = deriveShipStats("breaker-destroyer", [...loadout, { moduleId: "micro-reactor" }]);

    expect(bare.powerDraw).toBeLessThanOrEqual(bare.powerOutput);
    expect(powered.powerOutput).toBe(bare.powerOutput + 40);
    expect(powered.energyCapacity).toBe(bare.energyCapacity + 40);
    expect(powered.energyRegenPerSecond).toBeGreaterThan(bare.energyRegenPerSecond);
  });

  it("flags loadouts that overload a hull's power budget", () => {
    const stats = deriveShipStats("sparrow-scout", [{ moduleId: "heavy-drive" }, { moduleId: "rail-lance" }, { moduleId: "bore-drill" }]);
    expect(stats.powerDraw).toBeGreaterThan(stats.powerOutput);
  });

  it("covers the scout, healer, destroyer, and miner directions with signature loadouts that fit their power", () => {
    expect(new Set(hullDefinitions.map((hull) => hull.category))).toEqual(new Set(["scout", "healer", "destroyer", "miner"]));

    const signatureLoadouts: Record<string, string[]> = {
      "sparrow-scout": ["starter-thruster", "pulse-cannon", "mining-laser"],
      "warden-healer": ["repair-beam", "pulse-cannon", "starter-thruster", "micro-reactor", "reactive-plating"],
      "breaker-destroyer": ["rail-lance", "rail-lance", "heavy-drive", "micro-reactor", "reactive-plating"],
      "delver-miner": ["bore-drill", "bore-drill", "pulse-cannon", "heavy-drive", "reactive-plating"]
    };
    for (const hull of hullDefinitions) {
      const moduleIds = signatureLoadouts[hull.id];
      expect(moduleIds, hull.id).toBeDefined();
      const stats = getShipStats(hull.id, moduleIds.map((moduleId) => ({ moduleId })));
      expect(stats.powerDraw, hull.id).toBeLessThanOrEqual(stats.powerOutput);
    }
  });
});
