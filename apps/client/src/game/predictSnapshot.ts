import { getShipStats } from "@healer/content";
import {
  applyPlayerMovementInput,
  DEFAULT_SHIP_MOVEMENT_PROFILE,
  driftOffset,
  integratePlayerMovement,
  PLAYER_MOVEMENT_INPUT_RATE_HZ,
  type ShipMovementProfile,
  type MoveInputMessage,
  type PlayerMovementInput,
  type PlayerMovementState,
  type PlayerSnapshot,
  type SnapshotMessage
} from "@healer/shared";

// Fixed input step shared with the server simulation tick.
const inputStepSeconds = 1 / PLAYER_MOVEMENT_INPUT_RATE_HZ;
// A long frame (tab hidden, debugger pause) must not turn into a burst of catch-up inputs.
const maxFrameSeconds = 0.25;
// Unacknowledged inputs older than this are dropped; they were lost while disconnected.
const maxPendingInputs = PLAYER_MOVEMENT_INPUT_RATE_HZ;
// Remote entities are dead-reckoned from velocity for at most this long past their snapshot.
const maxExtrapolationSeconds = 0.2;
// Server corrections to the local ship are blended out over roughly this time constant.
const correctionTimeConstantSeconds = 0.1;
// Corrections larger than this are teleports (respawn, map change) and are applied immediately.
const maxSmoothedCorrectionPixels = 96;

// Movement profile for the local ship's hull and loadout. Unknown content (a stale client) falls back to the
// default profile rather than breaking the render loop; server corrections then keep the ship honest.
function resolveMovementProfile(self: PlayerSnapshot): ShipMovementProfile {
  try {
    return getShipStats(self.hullId, self.modules).movement;
  } catch {
    return DEFAULT_SHIP_MOVEMENT_PROFILE;
  }
}

interface PendingInput extends PlayerMovementInput {
  tick: number;
}

interface Pose {
  x: number;
  y: number;
  rotation: number;
}

// Predicts the local ship from the last authoritative snapshot plus the inputs the server has not applied yet.
// Input is sampled at the server's fixed tick rate, so each sample means exactly one simulation step on both
// sides: rotation and speed no longer depend on the client's frame rate, and a new snapshot lands where the
// prediction already was instead of pulling the ship back.
export class LocalShipPredictor {
  private nextInputTick = 1;
  private accumulatorSeconds = 0;
  private lastFrameTime: number | null = null;
  private pending: PendingInput[] = [];
  private correction: Pose = { x: 0, y: 0, rotation: 0 };
  private lastPredictedBase: Pose | null = null;

  // Advances the fixed-step input clock and returns the moveInput messages due this frame.
  sampleInput(now: number, input: PlayerMovementInput): MoveInputMessage[] {
    const frameSeconds = this.lastFrameTime === null ? inputStepSeconds : Math.min(maxFrameSeconds, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.decayCorrection(frameSeconds);
    this.accumulatorSeconds += frameSeconds;

    const messages: MoveInputMessage[] = [];
    while (this.accumulatorSeconds >= inputStepSeconds) {
      this.accumulatorSeconds -= inputStepSeconds;
      const sample: PendingInput = {
        thrustForward: input.thrustForward,
        thrustReverse: input.thrustReverse,
        rotateLeft: input.rotateLeft,
        rotateRight: input.rotateRight,
        tick: this.nextInputTick
      };
      this.nextInputTick += 1;
      this.pending.push(sample);
      messages.push({ type: "moveInput", ...sample });
    }
    if (this.pending.length > maxPendingInputs) {
      this.pending.splice(0, this.pending.length - maxPendingInputs);
    }
    return messages;
  }

  // Drops acknowledged inputs and converts any prediction error into a correction that fades out.
  onSnapshot(snapshot: SnapshotMessage): void {
    this.pending = this.pending.filter((entry) => entry.tick > snapshot.lastProcessedInputTick);
    const self = snapshot.players.find((player) => player.playerId === snapshot.selfPlayerId);
    if (!self) {
      this.lastPredictedBase = null;
      return;
    }

    const predicted = this.replay(self);
    if (this.lastPredictedBase) {
      const errorX = this.lastPredictedBase.x - predicted.position.x;
      const errorY = this.lastPredictedBase.y - predicted.position.y;
      if (Math.hypot(errorX + this.correction.x, errorY + this.correction.y) > maxSmoothedCorrectionPixels) {
        this.correction = { x: 0, y: 0, rotation: 0 };
      } else {
        this.correction.x += errorX;
        this.correction.y += errorY;
        this.correction.rotation += wrapAngle(this.lastPredictedBase.rotation - predicted.rotation);
      }
    }
    this.lastPredictedBase = { x: predicted.position.x, y: predicted.position.y, rotation: predicted.rotation };
  }

  // Returns the render pose for the local ship at the current frame.
  predict(self: PlayerSnapshot): PlayerSnapshot {
    const { predicted, rotationBeforeLastStep } = this.replayWithPrevious(self);
    this.lastPredictedBase = { x: predicted.position.x, y: predicted.position.y, rotation: predicted.rotation };

    // Between fixed steps, ease rotation from the previous step to the latest one so turning looks smooth at
    // any frame rate. Interpolating (rather than guessing ahead with the held key) means releasing the key
    // never shows a partial turn that then has to be taken back. Position is extrapolated along velocity.
    const fraction = this.accumulatorSeconds / inputStepSeconds;
    predicted.rotation = rotationBeforeLastStep + (predicted.rotation - rotationBeforeLastStep) * fraction + this.correction.rotation;
    predicted.position.x += predicted.velocity.x * this.accumulatorSeconds + this.correction.x;
    predicted.position.y += predicted.velocity.y * this.accumulatorSeconds + this.correction.y;
    return predicted;
  }

  // Replays unacknowledged inputs on top of the authoritative state, one simulation step each.
  private replay(self: PlayerSnapshot): PlayerSnapshot {
    return this.replayWithPrevious(self).predicted;
  }

  // Same as replay, but also reports the rotation before the newest step for render interpolation.
  private replayWithPrevious(self: PlayerSnapshot): { predicted: PlayerSnapshot; rotationBeforeLastStep: number } {
    const predicted = clonePlayer(self);
    // The same hull+loadout derivation the server uses, so heavier ships replay exactly as they simulate.
    const movement = resolveMovementProfile(self);
    let rotationBeforeLastStep = predicted.rotation;
    for (const input of this.pending) {
      rotationBeforeLastStep = predicted.rotation;
      applyPlayerMovementInput(predicted, input, movement);
      integratePlayerMovement(predicted, inputStepSeconds);
    }
    return { predicted, rotationBeforeLastStep };
  }

  private decayCorrection(frameSeconds: number): void {
    const keep = Math.exp(-frameSeconds / correctionTimeConstantSeconds);
    this.correction.x *= keep;
    this.correction.y *= keep;
    this.correction.rotation *= keep;
  }
}

// Nominal server time of one simulation tick. Server entity motion advances by exactly this much per tick.
const serverTickMs = 1000 / PLAYER_MOVEMENT_INPUT_RATE_HZ;
// Remote entity corrections blend out over this time constant instead of popping.
const remoteCorrectionTimeConstantSeconds = 0.08;

// Maps server simulation ticks onto the local clock. Snapshot arrival times jitter (send timer phase, network,
// main-thread stalls), so entities are placed by the server tick their state belongs to rather than by when the
// message happened to arrive. The estimate follows the earliest arrivals, which carry the least delay.
export class ServerTickClock {
  private offsetMs: number | null = null;

  observe(serverTick: number, receivedAt: number): void {
    const sample = receivedAt - serverTick * serverTickMs;
    if (this.offsetMs === null || Math.abs(sample - this.offsetMs) > 1000) {
      this.offsetMs = sample;
      return;
    }
    // Earlier-than-expected arrivals pull the estimate quickly; late ones only nudge it so drift is tracked.
    this.offsetMs += (sample - this.offsetMs) * (sample < this.offsetMs ? 0.3 : 0.02);
  }

  // Seconds of server simulation that have passed since the given tick, as of the local time now.
  secondsSinceTick(serverTick: number, now: number): number {
    if (this.offsetMs === null) {
      return 0;
    }
    return (now - this.offsetMs - serverTick * serverTickMs) / 1000;
  }
}

interface RemotePoseState {
  // offset is the remaining correction blended onto the extrapolated pose.
  offset: Pose;
  // rendered is the pose drawn last frame, used to measure the jump when a new snapshot arrives.
  rendered: Pose;
  snapshotTick: number;
  lastFrame: number;
}

// Produces render poses for everything in a snapshot, driven by wall-clock time rather than frame count:
// the local ship from input replay, projectiles by exact straight-line extrapolation on the server tick clock,
// and remote ships and enemies by extrapolation with any jump at a new snapshot blended out over time.
export class WorldRenderPredictor {
  readonly ship = new LocalShipPredictor();
  readonly clock = new ServerTickClock();
  private remotePoses = new Map<string, RemotePoseState>();

  onSnapshot(snapshot: SnapshotMessage, receivedAt: number): void {
    this.clock.observe(snapshot.tick, receivedAt);
    this.ship.onSnapshot(snapshot);
  }

  render(snapshot: SnapshotMessage, now: number): SnapshotMessage {
    const elapsedSeconds = Math.min(maxExtrapolationSeconds, Math.max(-maxExtrapolationSeconds, this.clock.secondsSinceTick(snapshot.tick, now)));
    const seen = new Set<string>();

    const players = snapshot.players.map((player) => {
      if (player.playerId === snapshot.selfPlayerId) {
        return this.ship.predict(player);
      }
      const predicted = clonePlayer(player);
      integratePlayerMovement(predicted, Math.max(0, elapsedSeconds));
      const pose = this.smoothRemote(player.id, snapshot.tick, now, { x: predicted.position.x, y: predicted.position.y, rotation: predicted.rotation }, predicted.velocity);
      seen.add(player.id);
      return { ...predicted, position: { x: pose.x, y: pose.y }, rotation: pose.rotation };
    });

    const enemies = snapshot.enemies.map((enemy) => {
      const position = extrapolate(enemy.position, enemy.velocity, Math.max(0, elapsedSeconds));
      const pose = this.smoothRemote(enemy.id, snapshot.tick, now, { x: position.x, y: position.y, rotation: enemy.rotation }, enemy.velocity);
      seen.add(enemy.id);
      return { ...enemy, position: { x: pose.x, y: pose.y }, rotation: pose.rotation };
    });

    // Drops drift with drag on the server; follow the same decaying curve, then blend any wall bounce.
    const drops = snapshot.drops.map((drop) => {
      const offset = driftOffset(drop.velocity, drop.angularVelocity, Math.max(0, elapsedSeconds));
      const target = { x: drop.position.x + offset.x, y: drop.position.y + offset.y, rotation: drop.rotation + offset.rotation };
      const pose = this.smoothRemote(drop.id, snapshot.tick, now, target, drop.velocity);
      seen.add(drop.id);
      return { ...drop, position: { x: pose.x, y: pose.y }, rotation: pose.rotation };
    });

    for (const id of this.remotePoses.keys()) {
      if (!seen.has(id)) {
        this.remotePoses.delete(id);
      }
    }

    return {
      ...snapshot,
      players,
      enemies,
      drops,
      // Projectiles fly in straight lines at constant speed, so extrapolation is exact until they hit something.
      projectiles: snapshot.projectiles.map((projectile) => ({
        ...projectile,
        position: extrapolate(projectile.position, projectile.velocity, elapsedSeconds)
      }))
    };
  }

  // Applies a decaying correction so a remote entity glides into its new snapshot track instead of popping.
  private smoothRemote(id: string, snapshotTick: number, now: number, target: Pose, velocity: { x: number; y: number }): Pose {
    const state = this.remotePoses.get(id);
    if (!state) {
      this.remotePoses.set(id, { offset: { x: 0, y: 0, rotation: 0 }, rendered: { ...target }, snapshotTick, lastFrame: now });
      return target;
    }

    const frameSeconds = Math.max(0, now - state.lastFrame) / 1000;
    const keep = Math.exp(-frameSeconds / remoteCorrectionTimeConstantSeconds);
    state.offset.x *= keep;
    state.offset.y *= keep;
    state.offset.rotation *= keep;
    if (snapshotTick !== state.snapshotTick) {
      // Measure the jump between where the entity would have been drawn now on its old track and the new
      // track, and carry it as an offset to blend out.
      state.offset = {
        x: state.rendered.x + velocity.x * frameSeconds - target.x,
        y: state.rendered.y + velocity.y * frameSeconds - target.y,
        rotation: wrapAngle(state.rendered.rotation - target.rotation)
      };
      if (Math.hypot(state.offset.x, state.offset.y) > maxSmoothedCorrectionPixels) {
        state.offset = { x: 0, y: 0, rotation: 0 };
      }
      state.snapshotTick = snapshotTick;
    }

    const rendered = { x: target.x + state.offset.x, y: target.y + state.offset.y, rotation: target.rotation + state.offset.rotation };
    state.rendered = rendered;
    state.lastFrame = now;
    return rendered;
  }
}

function extrapolate(position: { x: number; y: number }, velocity: { x: number; y: number }, seconds: number) {
  return { x: position.x + velocity.x * seconds, y: position.y + velocity.y * seconds };
}

function clonePlayer(player: PlayerSnapshot): PlayerSnapshot & PlayerMovementState {
  return {
    ...player,
    position: { ...player.position },
    velocity: { ...player.velocity }
  };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
