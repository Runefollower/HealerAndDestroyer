import { describe, expect, it } from "vitest";
import { getHullDefinition, validateContent } from "./index.js";
import { moduleDefinitions } from "./modules.js";

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
});
