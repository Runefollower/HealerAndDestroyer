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
import { LocalShipPredictor, predictSnapshotForRender } from "./predictSnapshot.js";

const selfPlayerId = asPlayerId("pilot-1");

// Minimal stand-in for the authoritative server: queues inputs, applies one per 30 Hz tick, snapshots at 10 Hz.
class FakeServer {
  ship: PlayerSnapshot = {
    id: asEntityId("ship-entity"),
    playerId: selfPlayerId,
    shipId: asShipId("ship-1"),
    hullId: "scout",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    hull: 10,
    maxHull: 10,
    modules: []
  };
  queue: MoveInputMessage[] = [];
  lastProcessedInputTick = 0;

  tick(): void {
    const input = this.queue.shift();
    if (input) {
      applyPlayerMovementInput(this.ship, input);
      this.lastProcessedInputTick = input.tick;
    }
    integratePlayerMovement(this.ship, 1 / 30);
  }

  snapshot(): SnapshotMessage {
    return {
      type: "snapshot",
      tick: 0,
      lastProcessedInputTick: this.lastProcessedInputTick,
      selfPlayerId,
      mapId: "map-root" as SnapshotMessage["mapId"],
      players: [structuredClone(this.ship)],
      enemies: [],
      projectiles: [],
      structures: [],
      foundries: [],
      drops: [],
      chunks: [],
      inventory: {},
      selfModules: [],
      builderSiteNearby: false,
      deeperPathUnlocked: false
    };
  }
}

// Runs client frames and server ticks on one clock with one-way network latency, recording rendered rotation.
function simulate(frameRateHz: number, latencyMs: number, inputAt: (ms: number) => PlayerMovementInput, durationMs: number) {
  const server = new FakeServer();
  const predictor = new LocalShipPredictor();
  const inFlight: { deliverAt: number; deliver: () => void }[] = [];
  let latest: { snapshot: SnapshotMessage; receivedAt: number } | null = null;
  const rendered: { ms: number; rotation: number; x: number }[] = [];
  let nextFrame = 0;
  let nextTick = 0;
  let nextSnapshot = 0;

  for (let ms = 0; ms <= durationMs; ms += 0.5) {
    for (const message of inFlight.filter((entry) => entry.deliverAt <= ms)) {
      message.deliver();
    }
    inFlight.splice(0, inFlight.length, ...inFlight.filter((entry) => entry.deliverAt > ms));

    if (ms >= nextTick) {
      server.tick();
      nextTick += 1000 / 30;
    }
    if (ms >= nextSnapshot) {
      const snapshot = server.snapshot();
      inFlight.push({
        deliverAt: ms + latencyMs,
        deliver: () => {
          predictor.onSnapshot(snapshot);
          latest = { snapshot, receivedAt: ms + latencyMs };
        }
      });
      nextSnapshot += 100;
    }
    if (ms >= nextFrame) {
      for (const message of predictor.sampleInput(ms, inputAt(ms))) {
        inFlight.push({ deliverAt: ms + latencyMs, deliver: () => server.queue.push(message) });
      }
      if (latest) {
        const self = predictSnapshotForRender(latest.snapshot, latest.receivedAt, ms, predictor).players[0];
        rendered.push({ ms, rotation: self.rotation, x: self.position.x });
      }
      nextFrame += 1000 / frameRateHz;
    }
  }
  return { rendered, server };
}

const idle: PlayerMovementInput = { thrustForward: false, thrustReverse: false, rotateLeft: false, rotateRight: false };

describe("LocalShipPredictor", () => {
  it.each([
    [60, 20],
    [144, 50]
  ])("rotates without snapping back at %i fps with %i ms latency", (frameRateHz, latencyMs) => {
    // Hold rotate-right for 600 ms, then release.
    const { rendered, server } = simulate(frameRateHz, latencyMs, (ms) => ({ ...idle, rotateRight: ms >= 200 && ms < 800 }), 1500);

    for (let index = 1; index < rendered.length; index += 1) {
      // Rendered rotation must never move backwards while turning right or after release.
      expect(rendered[index].rotation).toBeGreaterThanOrEqual(rendered[index - 1].rotation - 1e-3);
    }
    // Turn rate is fixed by the tick rate (18 steps in 600 ms), not by the frame rate.
    expect(server.ship.rotation).toBeCloseTo(18 * PLAYER_ROTATION_STEP, 5);
    expect(rendered.at(-1)!.rotation).toBeCloseTo(18 * PLAYER_ROTATION_STEP, 2);
  });

  it("moves forward smoothly under thrust", () => {
    const { rendered } = simulate(60, 40, (ms) => ({ ...idle, thrustForward: ms >= 100 && ms < 900 }), 1200);
    for (let index = 1; index < rendered.length; index += 1) {
      expect(rendered[index].x).toBeGreaterThanOrEqual(rendered[index - 1].x - 0.05);
    }
  });

  it("extrapolates projectiles along their velocity between snapshots", () => {
    const snapshot = new FakeServer().snapshot();
    snapshot.projectiles = [{ id: asEntityId("p1"), position: { x: 10, y: 20 }, velocity: { x: 300, y: -100 } }];
    const predicted = predictSnapshotForRender(snapshot, 1000, 1050, new LocalShipPredictor());
    expect(predicted.projectiles[0].position.x).toBeCloseTo(25, 5);
    expect(predicted.projectiles[0].position.y).toBeCloseTo(15, 5);
  });
});
