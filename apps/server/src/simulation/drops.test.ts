import { describe, expect, it } from "vitest";
import { DROP_DRIFT, TERRAIN_CELL_TYPES, asEntityId, asMapId, createSnapshotMessage, type ActiveMapState, type LootDropState } from "@healer/shared";
import { launchDrop, tickDrops } from "./drops.js";
import { pruneEffects } from "./effects.js";
import { damageTerrainAt, mineTerrainAt, TILE_SIZE } from "./terrain.js";

const tickSeconds = 1 / 30;

describe("drifting drops", () => {
  it("launches new drops with a velocity and spin inside the configured ranges", () => {
    const map = createRoomMap();
    const drop = addDrop(map, "a", { x: 4 * TILE_SIZE, y: 4 * TILE_SIZE });
    tickDrops(map, tickSeconds, seededRandom(1));

    const speed = Math.hypot(drop.velocity!.x, drop.velocity!.y);
    expect(speed).toBeGreaterThanOrEqual(DROP_DRIFT.minLaunchSpeed);
    expect(speed).toBeLessThanOrEqual(DROP_DRIFT.maxLaunchSpeed);
    expect(Math.abs(drop.angularVelocity!)).toBeLessThanOrEqual(DROP_DRIFT.maxLaunchSpin);
    expect(drop.rotation).toBeGreaterThanOrEqual(0);
  });

  it("drifts, slows down, and comes to rest", () => {
    const map = createRoomMap();
    const start = { x: 4 * TILE_SIZE, y: 4 * TILE_SIZE };
    const drop = addDrop(map, "a", { ...start });
    tickDrops(map, tickSeconds, seededRandom(2));
    const launchSpeed = Math.hypot(drop.velocity!.x, drop.velocity!.y);

    for (let tick = 0; tick < 30; tick += 1) {
      tickDrops(map, tickSeconds);
    }
    expect(Math.hypot(drop.position.x - start.x, drop.position.y - start.y)).toBeGreaterThan(5);
    expect(Math.hypot(drop.velocity!.x, drop.velocity!.y)).toBeLessThan(launchSpeed);

    for (let tick = 0; tick < 30 * 30; tick += 1) {
      tickDrops(map, tickSeconds);
    }
    expect(drop.velocity).toEqual({ x: 0, y: 0 });
    expect(drop.angularVelocity).toBe(0);
  });

  it("bounces off terrain and never leaves open space or the map", () => {
    const map = createRoomMap();
    // Many drops thrown hard in every direction from near a wall must all stay in open cells.
    for (let index = 0; index < 40; index += 1) {
      const drop = addDrop(map, `d${index}`, { x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE });
      launchDrop(map, drop, seededRandom(index + 10));
      drop.velocity = { x: Math.cos(index) * 300, y: Math.sin(index) * 300 };
    }

    for (let tick = 0; tick < 30 * 20; tick += 1) {
      tickDrops(map, tickSeconds);
      for (const drop of Object.values(map.drops)) {
        expect(isOpenCell(map, drop.position.x, drop.position.y)).toBe(true);
      }
    }
  });

  it("reverses velocity on a wall hit", () => {
    const map = createRoomMap();
    const drop = addDrop(map, "a", { x: TILE_SIZE + DROP_DRIFT.radius + 1, y: 4 * TILE_SIZE });
    drop.velocity = { x: -60, y: 0 };
    drop.rotation = 0;
    drop.angularVelocity = 0;

    tickDrops(map, tickSeconds);
    expect(drop.velocity.x).toBeGreaterThan(0);
  });

  it("moves a drop spawned against a wall into open space at launch", () => {
    const map = createRoomMap();
    const drop = addDrop(map, "a", { x: TILE_SIZE + 1, y: 4 * TILE_SIZE });
    launchDrop(map, drop, seededRandom(3));
    expect(drop.position.x).toBeGreaterThanOrEqual(TILE_SIZE + DROP_DRIFT.radius);
  });

  it("exposes drift state in snapshots", () => {
    const map = createRoomMap();
    addDrop(map, "a", { x: 4 * TILE_SIZE, y: 4 * TILE_SIZE });
    tickDrops(map, tickSeconds, seededRandom(4));
    const snapshot = createSnapshotMessage(1, "p" as never, map.id, map, { inventory: {}, modules: [] } as never, false, false);
    expect(snapshot.drops[0].velocity).toEqual(map.drops.a.velocity);
    expect(snapshot.drops[0].angularVelocity).toBe(map.drops.a.angularVelocity);
  });
});

describe("effect events", () => {
  it("emits dust for mining and a rock burst for weapon fire", () => {
    const map = createRoomMap();
    const cells = map.chunks["0,0"].cells;
    cells[3 * 8 + 3] = TERRAIN_CELL_TYPES.commonRock;
    cells[3 * 8 + 5] = TERRAIN_CELL_TYPES.commonRock;

    expect(mineTerrainAt(map, { x: 3.2 * TILE_SIZE, y: 3.7 * TILE_SIZE }, 7)).toBe(true);
    expect(damageTerrainAt(map, { x: 5.5 * TILE_SIZE, y: 3.5 * TILE_SIZE }, 999, 8).destroyed).toBe(true);

    expect(map.effects?.map((effect) => effect.kind)).toEqual(["dust", "rockBurst"]);
    // Effects are centered on the broken cell, not on the click point.
    expect(map.effects?.[0].position).toEqual({ x: 3.5 * TILE_SIZE, y: 3.5 * TILE_SIZE });
    expect(map.effects?.[0].tick).toBe(7);
  });

  it("emits an explosion sized to the blast when a volatile block detonates", () => {
    const map = createRoomMap();
    map.chunks["0,0"].cells[3 * 8 + 3] = TERRAIN_CELL_TYPES.unstableCrystal;
    mineTerrainAt(map, { x: 3.5 * TILE_SIZE, y: 3.5 * TILE_SIZE }, 1);
    expect(map.effects?.[0].kind).toBe("explosion");
    expect(map.effects?.[0].radius).toBeGreaterThan(TILE_SIZE);
  });

  it("forgets events after the retention window", () => {
    const map = createRoomMap();
    map.chunks["0,0"].cells[3 * 8 + 3] = TERRAIN_CELL_TYPES.commonRock;
    mineTerrainAt(map, { x: 3.5 * TILE_SIZE, y: 3.5 * TILE_SIZE }, 1);
    pruneEffects(map, 20);
    expect(map.effects).toHaveLength(1);
    pruneEffects(map, 100);
    expect(map.effects).toHaveLength(0);
  });
});

// An 8x8-tile room: solid border, open interior.
function createRoomMap(): ActiveMapState {
  const cells = new Array(64).fill(TERRAIN_CELL_TYPES.empty);
  for (let index = 0; index < 64; index += 1) {
    const x = index % 8;
    const y = Math.floor(index / 8);
    if (x === 0 || y === 0 || x === 7 || y === 7) {
      cells[index] = TERRAIN_CELL_TYPES.commonRock;
    }
  }
  return {
    id: asMapId("test-map"),
    seed: "test-seed",
    width: 8 * TILE_SIZE,
    height: 8 * TILE_SIZE,
    chunks: { "0,0": { chunkX: 0, chunkY: 0, cells, dirty: false, active: true } },
    players: {},
    enemies: {},
    projectiles: {},
    structures: {},
    foundries: {},
    drops: {},
    connections: []
  };
}

function addDrop(map: ActiveMapState, id: string, position: { x: number; y: number }): LootDropState {
  const drop: LootDropState = { id: asEntityId(id), mapId: map.id, position, resources: { rock: 1 } };
  map.drops[id] = drop;
  return drop;
}

function isOpenCell(map: ActiveMapState, x: number, y: number): boolean {
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  if (tileX < 0 || tileY < 0 || tileX >= 8 || tileY >= 8) {
    return false;
  }
  return map.chunks["0,0"].cells[tileY * 8 + tileX] === TERRAIN_CELL_TYPES.empty;
}

// Small deterministic PRNG (mulberry32) so drift tests are repeatable.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
