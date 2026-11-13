import { describe, expect, it } from "vitest";
import type { EffectEvent } from "@healer/shared";
import { WorldEffects, effectLifetimeMs, maxActiveEffects } from "./worldEffects.js";

function event(id: string, overrides: Partial<EffectEvent> = {}): EffectEvent {
  return { id, kind: "dust", position: { x: 10, y: 20 }, radius: 20, tint: 0x888888, tick: 1, ...overrides };
}

describe("WorldEffects", () => {
  it("plays each event once even though snapshots repeat it", () => {
    const effects = new WorldEffects();
    effects.ingest("map", [event("a")], 1000);
    effects.ingest("map", [event("a")], 1100);
    effects.ingest("map", [event("a"), event("b")], 1200);
    expect(effects.active.map((effect) => effect.id)).toEqual(["a", "b"]);
  });

  it("starts late events part-way and skips ones already finished", () => {
    const effects = new WorldEffects();
    effects.ingest("map", [event("late", { tick: 5 }), event("stale", { tick: 1 })], 5000, (tick) => (tick === 5 ? 0.3 : 5));
    expect(effects.active).toHaveLength(1);
    expect(effects.active[0].startedAt).toBeCloseTo(4700);
  });

  it("expires finished effects and caps how many run at once", () => {
    const effects = new WorldEffects();
    effects.ingest(
      "map",
      Array.from({ length: maxActiveEffects + 10 }, (_, index) => event(`e${index}`, { kind: "explosion", radius: 40 })),
      0
    );
    expect(effects.active).toHaveLength(maxActiveEffects);
    expect(effects.active[0].id).toBe("e10");
    effects.prune(effectLifetimeMs("explosion", 40) + 1);
    expect(effects.active).toHaveLength(0);
  });

  it("clears effects on a map change", () => {
    const effects = new WorldEffects();
    effects.ingest("map-a", [event("a")], 0);
    effects.ingest("map-b", [], 10);
    expect(effects.active).toHaveLength(0);
  });
});
