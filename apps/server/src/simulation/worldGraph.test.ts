import { describe, expect, it } from "vitest";
import { isPositionBlocked } from "./collision.js";
import { defenseCountForDepth, scaleFoundryReward } from "./foundries.js";
import { createWorldGraph } from "./createWorld.js";
import { chooseArchetypeForDepth, discoveredArchetypePools, getMapArchetype, prototypeMaps } from "./mapArchetypes.js";
import { generateMapLayout } from "./mapGeneration.js";
import {
  EXIT_TRAVEL_RADIUS,
  connectionsForMap,
  createUndiscoveredExit,
  deeperExitId,
  discoverExit,
  ensureUndiscoveredExits,
  exitPositionOnMap,
  findNearbyExit,
  generateLayoutWithRetries
} from "./worldGraph.js";

describe("world graph discovery", () => {
  it("reserves an undiscovered exit at the bottom of the deeper prototype map", () => {
    const world = createWorldGraph();
    const exit = world.graph.connectionIndex[deeperExitId(prototypeMaps.deeper.mapId)];

    expect(exit).toMatchObject({ sourceMapId: "map-depth-1", discovered: false });
    expect(exit.destinationMapId).toBeUndefined();
    expect(exit.destinationSeed).toBe("alpha-seed/conn-map-depth-1-down");
    expect(exit.sourceAnchor).toEqual(generateMapLayout(prototypeMaps.deeper.seed, prototypeMaps.deeper.archetypeId).sourceAnchor);
    expect(world.maps["map-depth-1"].connectionIds).toContain(exit.id);
  });

  it("reserves the same destination for the same world seed and source map", () => {
    const first = createUndiscoveredExit("world-a", "map-x", 2, { x: 10, y: 10 });
    const second = createUndiscoveredExit("world-a", "map-x", 2, { x: 10, y: 10 });
    const other = createUndiscoveredExit("world-b", "map-x", 2, { x: 10, y: 10 });

    expect(first).toEqual(second);
    expect(other.destinationSeed).not.toBe(first.destinationSeed);
  });

  it("picks archetypes from the deepest pool the depth qualifies for", () => {
    expect(chooseArchetypeForDepth(1, 0.99)).toBe("deep-cavern");
    expect(chooseArchetypeForDepth(2, 0)).toBe("tunnel-network");
    expect(chooseArchetypeForDepth(3, 0)).toBe("foundry-arena");
    expect(chooseArchetypeForDepth(40, 0.999)).toBe("deep-cavern");

    // Every archetype in a pool is reachable across the roll range.
    for (const pool of discoveredArchetypePools) {
      const picked = new Set(pool.archetypes.map((_, index) => chooseArchetypeForDepth(pool.minDepth, (index + 0.5) / pool.archetypes.length)));
      expect([...picked].sort()).toEqual([...pool.archetypes].sort());
    }
  });

  it("generates the map behind an exit and links it into the graph", () => {
    const world = createWorldGraph();
    const exit = world.graph.connectionIndex[deeperExitId("map-depth-1")];
    const { summary, map } = discoverExit(world, exit, 1000);

    expect(summary).toMatchObject({ id: "map-depth-2", depth: 2, status: "discovered", biomeId: exit.destinationArchetypeId });
    expect(exit).toMatchObject({ discovered: true, destinationMapId: "map-depth-2" });
    expect(world.maps["map-depth-2"]).toBe(summary);
    expect(world.graph.discoveredMapIds).toContain("map-depth-2");

    // The new map regenerates from its summary and arrival lands on the validated entry anchor.
    const regenerated = generateMapLayout(summary.seed, summary.biomeId ?? "");
    expect(regenerated.chunks).toEqual(map.chunks);
    expect(exit.destinationAnchor).toEqual(regenerated.destinationAnchor);

    // The new map carries the arrival connection plus its own undiscovered deeper exit.
    const deeper = world.graph.connectionIndex[deeperExitId("map-depth-2")];
    expect(deeper).toMatchObject({ sourceMapId: "map-depth-2", discovered: false, sourceAnchor: regenerated.sourceAnchor });
    expect(map.connections).toEqual([exit, deeper]);
    expect(connectionsForMap(world, "map-depth-2").map((entry) => entry.id).sort()).toEqual([exit.id, deeper.id].sort());

    expect(() => discoverExit(world, exit)).toThrow(/already discovered/);
  });

  it("chains discoveries into valid maps with archetype content", () => {
    const world = createWorldGraph();
    let sourceMapId = "map-depth-1";
    for (let depth = 2; depth <= 7; depth += 1) {
      const exit = world.graph.connectionIndex[deeperExitId(sourceMapId)];
      const { summary, map } = discoverExit(world, exit);
      const content = getMapArchetype(summary.biomeId ?? "").content;

      expect(summary.depth).toBe(depth);
      expect(Object.keys(map.foundries)).toHaveLength(content.foundry ? 1 : 0);
      for (const foundry of Object.values(map.foundries)) {
        // Foundries grow tougher with depth.
        expect(foundry.maxHealth).toBeGreaterThan(350 * (content.foundry?.healthMultiplier ?? 1));
        expect(foundry.mapId).toBe(summary.id);
        // Fortification pocket: every planned turret slot fits, and rewards grow with depth.
        expect(foundry.defenseSlots).toHaveLength(defenseCountForDepth(content.foundry!, depth));
        for (const slot of foundry.defenseSlots ?? []) {
          expect(isPositionBlocked(map, slot, 14)).toBe(false);
        }
        expect(foundry.reward).toEqual(scaleFoundryReward(content.foundry!.reward, depth));
        expect(foundry.reward?.ferrite ?? 0).toBeGreaterThan(content.foundry!.reward.ferrite ?? 0);
      }
      sourceMapId = summary.id;
    }
    expect(Object.keys(world.maps)).toHaveLength(8);
  });

  it("returns the seed that produced the layout and does not retry non-validation errors", () => {
    const result = generateLayoutWithRetries("retry-probe", "deep-cavern");
    expect(result.seed.startsWith("retry-probe")).toBe(true);
    expect(generateMapLayout(result.seed, "deep-cavern").chunks).toEqual(result.layout.chunks);
    expect(() => generateLayoutWithRetries("retry-probe", "no-such-archetype")).toThrow(/Unknown map archetype/);
  });

  it("adds missing deeper exits to worlds saved before discovery existed", () => {
    const world = createWorldGraph();
    delete world.graph.connectionIndex[deeperExitId("map-depth-1")];
    world.maps["map-depth-1"].connectionIds = ["conn-root-depth-1" as never];
    const deeperLayout = generateMapLayout(prototypeMaps.deeper.seed, prototypeMaps.deeper.archetypeId);

    expect(ensureUndiscoveredExits(world, { "map-depth-1": deeperLayout })).toBe(true);
    expect(world.graph.connectionIndex[deeperExitId("map-depth-1")]?.discovered).toBe(false);
    expect(ensureUndiscoveredExits(world, { "map-depth-1": deeperLayout })).toBe(false);
  });

  it("finds exits in travel range from either end of a connection", () => {
    const world = createWorldGraph();
    const rootExit = world.graph.connectionIndex["conn-root-depth-1"];
    const onRoot = exitPositionOnMap(rootExit, "map-root");
    const onDeeper = exitPositionOnMap(rootExit, "map-depth-1");
    if (!onRoot || !onDeeper) {
      throw new Error("Expected both ends of the root connection.");
    }

    expect(findNearbyExit(world, "map-root", onRoot)?.id).toBe(rootExit.id);
    expect(findNearbyExit(world, "map-depth-1", onDeeper)?.id).toBe(rootExit.id);
    expect(findNearbyExit(world, "map-root", { x: onRoot.x + EXIT_TRAVEL_RADIUS + 1, y: onRoot.y })).toBeNull();
  });
});
