import { describe, expect, it } from "vitest";
import {
  applyPlayerMovementInput,
  asEntityId,
  asPlayerId,
  asShipId,
  integratePlayerMovement,
  PLAYER_ROTATION_STEP,
  type MoveInputMessage,
  type PlayerMovementInput,
  type PlayerSnapshot,
  type SnapshotMessage
} from "@healer/shared";
import { WorldRenderPredictor } from "./predictSnapshot.js";

const selfPlayerId = asPlayerId("pilot-1");

// Small deterministic PRNG so jittered runs are reproducible.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Minimal stand-in for the authoritative server: one movement step per queued input (holding briefly when the
// queue runs dry, like GameWorld), plus one projectile and one enemy moving in straight lines.
class FakeServer {
  ship: PlayerSnapshot = {
    id: asEntityId("ship-entity"),
    playerId: selfPlayerId,
    shipId: asShipId("ship-1"),
    // The starter Sparrow loadout derives exactly the default movement profile the fake server applies.
    hullId: "sparrow-scout",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    hull: 10,
    maxHull: 10,
    modules: [
      { moduleId: "starter-thruster", hardpointId: "engine-rear", currentHealth: 30 },
      { moduleId: "pulse-cannon", hardpointId: "weapon-front", currentHealth: 24 },
      { moduleId: "mining-laser", hardpointId: "utility-belly", currentHealth: 20 }
    ]
  };
  projectile = { id: asEntityId("projectile-1"), position: { x: 0, y: 500 }, velocity: { x: 300, y: 0 } };
  enemy = { id: asEntityId("enemy-1"), enemyTypeId: "drone", position: { x: 0, y: -500 }, velocity: { x: 60, y: 0 }, rotation: 0, health: 10 };
  queue: MoveInputMessage[] = [];
  lastProcessedInputTick = 0;
  tickCount = 0;

  tick(): void {
    this.tickCount += 1;
    const steps = this.queue.length > 2 ? 2 : this.queue.length > 0 ? 1 : 0;
    for (const input of this.queue.splice(0, steps)) {
      applyPlayerMovementInput(this.ship, input);
      integratePlayerMovement(this.ship, 1 / 30);
      this.lastProcessedInputTick = input.tick;
    }
    this.projectile.position.x += this.projectile.velocity.x / 30;
    this.enemy.position.x += this.enemy.velocity.x / 30;
  }

  snapshot(): SnapshotMessage {
    return {
      type: "snapshot",
      tick: this.tickCount,
      lastProcessedInputTick: this.lastProcessedInputTick,
      selfPlayerId,
      mapId: "map-root" as SnapshotMessage["mapId"],
      players: [structuredClone(this.ship)],
      enemies: [structuredClone(this.enemy)],
      projectiles: [structuredClone(this.projectile)],
      structures: [],
      foundries: [],
      drops: [],
      effects: [],
      chunks: [],
      inventory: {},
      selfModules: [],
      selfEnergy: 60,
      selfMaxEnergy: 60,
      builderSiteNearby: false,
      deeperPathUnlocked: false,
      exits: [],
      nearbyExitId: null
    };
  }
}

interface SimulationOptions {
  frameRateHz: number;
  latencyMs: number;
  // jitterMs randomizes network delay, server timer firing, and frame timing by up to this much.
  jitterMs?: number;
}

interface RenderedFrame {
  ms: number;
  rotation: number;
  x: number;
  projectileX: number;
  enemyX: number;
}

// Runs client frames and server ticks on one clock with network latency, recording rendered poses per frame.
function simulate(options: SimulationOptions, inputAt: (ms: number) => PlayerMovementInput, durationMs: number) {
  const random = seededRandom(42);
  const jitter = () => (options.jitterMs ?? 0) * random();
  const server = new FakeServer();
  const predictor = new WorldRenderPredictor();
  const inFlight: { deliverAt: number; deliver: () => void }[] = [];
  let latest: SnapshotMessage | null = null;
  const rendered: RenderedFrame[] = [];
  let nextFrame = 0;
  let nextTick = 0;
  let nextSnapshot = 0;
  // Keeps each direction of the socket in order, like TCP.
  let lastToServer = 0;
  let lastToClient = 0;

  for (let ms = 0; ms <= durationMs; ms += 0.25) {
    for (const message of inFlight.filter((entry) => entry.deliverAt <= ms)) {
      message.deliver();
    }
    inFlight.splice(0, inFlight.length, ...inFlight.filter((entry) => entry.deliverAt > ms));

    if (ms >= nextTick) {
      server.tick();
      nextTick += 1000 / 30 + (random() - 0.5) * (options.jitterMs ?? 0) * 0.5;
    }
    if (ms >= nextSnapshot) {
      const snapshot = server.snapshot();
      const deliverAt = Math.max(lastToClient, ms + options.latencyMs + jitter());
      lastToClient = deliverAt;
      inFlight.push({
        deliverAt,
        deliver: () => {
          predictor.onSnapshot(snapshot, deliverAt);
          latest = snapshot;
        }
      });
      nextSnapshot += 100;
    }
    if (ms >= nextFrame) {
      for (const message of predictor.ship.sampleInput(ms, inputAt(ms))) {
        const deliverAt = Math.max(lastToServer, ms + options.latencyMs + jitter());
        lastToServer = deliverAt;
        inFlight.push({ deliverAt, deliver: () => server.queue.push(message) });
      }
      if (latest) {
        const frame = predictor.render(latest, ms);
        rendered.push({
          ms,
          rotation: frame.players[0].rotation,
          x: frame.players[0].position.x,
          projectileX: frame.projectiles[0].position.x,
          enemyX: frame.enemies[0].position.x
        });
      }
      nextFrame += 1000 / options.frameRateHz + (random() - 0.5) * (options.jitterMs ?? 0) * 0.2;
    }
  }
  return { rendered, server };
}

// Largest relative deviation of per-frame speed from the expected speed, over frames after warm-up.
function worstSpeedError(frames: RenderedFrame[], key: "projectileX" | "enemyX", expectedSpeed: number, fromMs: number): number {
  let worst = 0;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index].ms < fromMs) {
      continue;
    }
    const speed = (frames[index][key] - frames[index - 1][key]) / ((frames[index].ms - frames[index - 1].ms) / 1000);
    worst = Math.max(worst, Math.abs(speed - expectedSpeed) / expectedSpeed);
  }
  return worst;
}

const idle: PlayerMovementInput = { thrustForward: false, thrustReverse: false, rotateLeft: false, rotateRight: false };

describe("WorldRenderPredictor", () => {
  it.each([
    [60, 20, 0],
    [144, 50, 0],
    [60, 30, 25]
  ])("rotates without snapping back at %i fps, %i ms latency, %i ms jitter", (frameRateHz, latencyMs, jitterMs) => {
    // Hold rotate-right for 600 ms, then release.
    const { rendered, server } = simulate({ frameRateHz, latencyMs, jitterMs }, (ms) => ({ ...idle, rotateRight: ms >= 200 && ms < 800 }), 1500);

    for (let index = 1; index < rendered.length; index += 1) {
      // Rendered rotation must never move backwards while turning right or after release.
      expect(rendered[index].rotation).toBeGreaterThanOrEqual(rendered[index - 1].rotation - 1e-3);
    }
    // Turn rate is fixed by the tick rate (18 steps in 600 ms), not by the frame rate.
    expect(server.ship.rotation).toBeCloseTo(18 * PLAYER_ROTATION_STEP, 5);
    expect(rendered.at(-1)!.rotation).toBeCloseTo(18 * PLAYER_ROTATION_STEP, 2);
  });

  it("moves forward smoothly under thrust with a jittery network", () => {
    const { rendered } = simulate({ frameRateHz: 60, latencyMs: 30, jitterMs: 25 }, (ms) => ({ ...idle, thrustForward: ms >= 100 && ms < 900 }), 1200);
    for (let index = 1; index < rendered.length; index += 1) {
      expect(rendered[index].x).toBeGreaterThanOrEqual(rendered[index - 1].x - 0.05);
    }
  });

  it("moves projectiles and enemies at an even on-screen speed despite snapshot jitter", () => {
    const { rendered } = simulate({ frameRateHz: 60, latencyMs: 30, jitterMs: 25 }, () => idle, 3000);
    // Projectile speed is 300 px/s and enemy speed 60 px/s; per-frame speed should stay close to that.
    expect(worstSpeedError(rendered, "projectileX", 300, 1000)).toBeLessThan(0.25);
    expect(worstSpeedError(rendered, "enemyX", 60, 1000)).toBeLessThan(0.25);
  });
});
