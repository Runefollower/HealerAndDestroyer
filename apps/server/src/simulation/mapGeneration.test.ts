import { describe, expect, it } from "vitest";
import { TERRAIN_CELL_TYPES, isSolidTerrainCell } from "@healer/shared";
import { createActiveMaps, createWorldGraph } from "./createWorld.js";
import { getMapArchetype, mapArchetypes, prototypeMaps, type MapGenerationConfig } from "./mapArchetypes.js";
import { GENERATED_TILE_SIZE, generateCaveMapLayout, generateMapLayout, layoutToGrid, type GeneratedMapLayout } from "./mapGeneration.js";
import { applyPersistedMapState, serializeMapState } from "./mapPersistence.js";
import { MapGenerationError, countCells, findNavigableTiles, validateMapGrid } from "./mapValidation.js";

const starterConfig = mapArchetypes["starter-cavern"];

describe("map generation", () => {
  it("generates the same cave layout for the same seed", () => {
    const first = generateCaveMapLayout("stable-seed", starterConfig);
    const second = generateCaveMapLayout("stable-seed", starterConfig);

    expect(first.widthTiles).toBe(96);
    expect(first.heightTiles).toBe(72);
    expect(first.chunks).toEqual(second.chunks);
    expect(first.spawnPoint).toEqual(second.spawnPoint);
    expect(first.builderPosition).toEqual(second.builderPosition);
    expect(first.foundryPosition).toEqual(second.foundryPosition);
    expect(first.sourceAnchor).toEqual(second.sourceAnchor);
  });

  it("varies cave terrain for different seeds", () => {
    const first = generateCaveMapLayout("alpha-seed", starterConfig);
    const second = generateCaveMapLayout("beta-seed", starterConfig);

    expect(layoutToGrid(first).cells).not.toEqual(layoutToGrid(second).cells);
  });

  it("keeps required gameplay anchors open and connected", () => {
    const layout = generateCaveMapLayout("connectivity-seed", starterConfig);
    const grid = layoutToGrid(layout);

    // World-space positions must land on the validated anchor tiles.
    expect(worldToTile(layout.spawnPoint)).toEqual(layout.anchors.spawn);
    expect(worldToTile(layout.builderPosition)).toEqual(layout.anchors.builder);
    expect(worldToTile(layout.foundryPosition)).toEqual(layout.anchors.foundry);
    expect(worldToTile(layout.enemyPosition)).toEqual(layout.anchors.enemy);

    const reachable = findNavigableTiles(grid, layout.anchors.spawn, 1);
    for (const anchor of Object.values(layout.anchors)) {
      expect(grid.cells[anchor.y * grid.widthTiles + anchor.x]).toBe(TERRAIN_CELL_TYPES.empty);
      expect(reachable.has(anchor.y * grid.widthTiles + anchor.x)).toBe(true);
    }
  });

  it("includes mineable solid terrain next to generated open space", () => {
    const grid = layoutToGrid(generateCaveMapLayout("ore-seed", starterConfig));
    const mineableWallCount = grid.cells.filter((cell, index) => {
      if (!isSolidTerrainCell(cell)) {
        return false;
      }
      const tileX = index % grid.widthTiles;
      const tileY = Math.floor(index / grid.widthTiles);
      return [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ].some(([dx, dy]) => grid.cells[(tileY + dy) * grid.widthTiles + tileX + dx] === TERRAIN_CELL_TYPES.empty);
    }).length;

    expect(mineableWallCount).toBeGreaterThan(20);
  });

  it("places first-pass ore and rare volatile materials", () => {
    const counts = countCells(layoutToGrid(generateCaveMapLayout("ore-variety-seed", starterConfig)));

    expect(counts.get(TERRAIN_CELL_TYPES.ferriteOre)).toBeGreaterThan(0);
    expect(counts.get(TERRAIN_CELL_TYPES.plasmaCrystal)).toBeGreaterThan(0);
    expect(counts.get(TERRAIN_CELL_TYPES.ancientStone)).toBeGreaterThan(0);
    expect(counts.get(TERRAIN_CELL_TYPES.unstableCrystal)).toBeGreaterThan(0);
  });
});

describe("map archetypes", () => {
  // Sweeping many seeds per archetype catches tuning changes that only break some layouts.
  it.each(Object.values(mapArchetypes).map((config) => [config.archetypeId, config] as const))(
    "%s produces valid layouts across many seeds",
    (_archetypeId, config) => {
      for (let index = 0; index < 40; index += 1) {
        const layout = generateCaveMapLayout(`sweep-${index}`, config);
        expect(layout.archetypeId).toBe(config.archetypeId);
        expect(layout.widthTiles).toBe(config.widthInChunks * 8);
        expect(validateMapGrid(layoutToGrid(layout), layout.anchors, config.validation)).toEqual([]);
      }
    }
  );

  it("guarantees each archetype's minimum material counts", () => {
    for (const config of Object.values(mapArchetypes)) {
      for (let index = 0; index < 20; index += 1) {
        const counts = countCells(layoutToGrid(generateCaveMapLayout(`materials-${index}`, config)));
        for (const [cellType, minimum] of Object.entries(config.validation.minMaterialCounts)) {
          expect(counts.get(Number(cellType)) ?? 0).toBeGreaterThanOrEqual(minimum ?? 0);
        }
      }
    }
  });

  it("gives resource caverns more ore than starter caverns", () => {
    const totals = (config: MapGenerationConfig) => {
      let ore = 0;
      for (let index = 0; index < 10; index += 1) {
        const counts = countCells(layoutToGrid(generateCaveMapLayout(`density-${index}`, config)));
        ore += (counts.get(TERRAIN_CELL_TYPES.ferriteOre) ?? 0) + (counts.get(TERRAIN_CELL_TYPES.plasmaCrystal) ?? 0);
      }
      return ore;
    };

    expect(totals(mapArchetypes["resource-cavern"])).toBeGreaterThan(totals(starterConfig));
  });

  it("fails fast when a config cannot produce a valid map", () => {
    const impossible: MapGenerationConfig = {
      ...starterConfig,
      validation: { ...starterConfig.validation, minAnchorSpacingTiles: 500 }
    };

    expect(() => generateCaveMapLayout("any-seed", impossible)).toThrow(MapGenerationError);
  });

  it("rejects unknown archetype ids", () => {
    expect(() => getMapArchetype("lava-lake")).toThrow(/Unknown map archetype/);
  });
});

describe("map validation", () => {
  const rules = { ...starterConfig.validation, minMaterialCounts: {} };

  it("accepts an open room with connected anchors", () => {
    const grid = openGrid(30, 20);
    expect(validateMapGrid(grid, spreadAnchors(), rules)).toEqual([]);
  });

  it("reports anchors that are blocked, crowded, or out of bounds", () => {
    const grid = openGrid(30, 20);
    const blockedGrid = withCells(grid, [[3, 4, TERRAIN_CELL_TYPES.commonRock]]);

    expect(codes(validateMapGrid(blockedGrid, spreadAnchors(), rules))).toContain("anchor-blocked");
    expect(codes(validateMapGrid(grid, { ...spreadAnchors(), builder: { x: 4, y: 4 } }, rules))).toContain("anchors-too-close");
    expect(codes(validateMapGrid(grid, { ...spreadAnchors(), foundry: { x: 99, y: 4 } }, rules))).toEqual(["anchor-out-of-bounds"]);
  });

  it("treats passages narrower than ship clearance as unreachable", () => {
    // A solid wall at x=12 with a one-tile gap: open, but too narrow for 1-tile clearance.
    const wall: Array<[number, number, number]> = [];
    for (let y = 0; y < 20; y += 1) {
      if (y !== 10) {
        wall.push([12, y, TERRAIN_CELL_TYPES.commonRock]);
      }
    }
    const grid = withCells(openGrid(30, 20), wall);
    const issues = validateMapGrid(grid, spreadAnchors(), rules);

    expect(codes(issues)).toContain("anchor-unreachable");
    expect(validateMapGrid(grid, spreadAnchors(), { ...rules, minPassageClearanceTiles: 0 })).toEqual([]);
  });

  it("reports volatile crystals near anchors and material shortfalls", () => {
    const grid = withCells(openGrid(30, 20), [[1, 1, TERRAIN_CELL_TYPES.unstableCrystal]]);
    const issues = validateMapGrid(grid, spreadAnchors(), {
      ...rules,
      anchorClearanceTiles: 0,
      minMaterialCounts: { [TERRAIN_CELL_TYPES.ferriteOre]: 1 }
    });

    expect(codes(issues)).toEqual(expect.arrayContaining(["volatile-near-anchor", "material-shortfall"]));
  });
});

describe("prototype maps", () => {
  it("can regenerate each map's baseline from its persisted summary", () => {
    const world = createWorldGraph();
    const activeMaps = createActiveMaps();

    for (const definition of Object.values(prototypeMaps)) {
      const summary = world.maps[definition.mapId];
      expect(summary.biomeId).toBe(definition.archetypeId);
      expect(generateMapLayout(summary.seed, summary.biomeId!).chunks).toEqual(activeMaps[definition.mapId].chunks);
    }
  });

  it("restores persisted terrain edits over a regenerated baseline", () => {
    const world = createWorldGraph();
    const editedMap = createActiveMaps()[prototypeMaps.root.mapId];
    const chunk = editedMap.chunks["2,2"];
    chunk.cells[0] = TERRAIN_CELL_TYPES.empty;
    chunk.cells[9] = TERRAIN_CELL_TYPES.ferriteOre;

    const persisted = serializeMapState(editedMap, world.maps[prototypeMaps.root.mapId]);
    const restoredMap = createActiveMaps()[prototypeMaps.root.mapId];
    applyPersistedMapState(restoredMap, persisted);

    for (const [chunkKey, editedChunk] of Object.entries(editedMap.chunks)) {
      expect(restoredMap.chunks[chunkKey].cells).toEqual(editedChunk.cells);
    }
  });

  // These fingerprints pin the shipped root/deeper terrain. If a generator change alters them on
  // purpose, update the values and call out the terrain change in the PR.
  it("keeps the shipped root and deeper terrain stable", () => {
    expect(fingerprint(generateMapLayout(prototypeMaps.root.seed, prototypeMaps.root.archetypeId))).toBe("29983f4");
    expect(fingerprint(generateMapLayout(prototypeMaps.deeper.seed, prototypeMaps.deeper.archetypeId))).toBe("bcedb845");
  });
});

// Builds an all-open grid with a solid border.
function openGrid(widthTiles: number, heightTiles: number) {
  const cells = new Array<number>(widthTiles * heightTiles).fill(TERRAIN_CELL_TYPES.empty);
  for (let y = 0; y < heightTiles; y += 1) {
    for (let x = 0; x < widthTiles; x += 1) {
      if (x === 0 || y === 0 || x === widthTiles - 1 || y === heightTiles - 1) {
        cells[y * widthTiles + x] = TERRAIN_CELL_TYPES.commonRock;
      }
    }
  }
  return { widthTiles, heightTiles, cells };
}

// Returns a copy of a grid with specific cells overwritten.
function withCells(grid: ReturnType<typeof openGrid>, changes: Array<[number, number, number]>) {
  const cells = [...grid.cells];
  for (const [x, y, value] of changes) {
    cells[y * grid.widthTiles + x] = value;
  }
  return { ...grid, cells };
}

// Anchors spread across the 30x20 test grid, with the foundry side past x=12.
function spreadAnchors() {
  return {
    spawn: { x: 4, y: 4 },
    builder: { x: 4, y: 14 },
    foundry: { x: 24, y: 10 },
    enemy: { x: 20, y: 10 },
    sourceExit: { x: 25, y: 16 },
    destinationEntry: { x: 9, y: 9 }
  };
}

// Extracts issue codes for compact assertions.
function codes(issues: Array<{ code: string }>): string[] {
  return issues.map((issue) => issue.code);
}

// Hashes a layout's cells so tests can detect any change to shipped terrain.
function fingerprint(layout: GeneratedMapLayout): string {
  let hash = 2166136261;
  for (const cell of layoutToGrid(layout).cells) {
    hash ^= cell;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

// Converts world-space positions back to tile coordinates for anchor validation.
function worldToTile(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.floor(position.x / GENERATED_TILE_SIZE),
    y: Math.floor(position.y / GENERATED_TILE_SIZE)
  };
}
