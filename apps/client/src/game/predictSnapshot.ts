import {
  applyPlayerMovementInput,
  integratePlayerMovement,
  PLAYER_MOVEMENT_INPUT_RATE_HZ,
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
    let rotationBeforeLastStep = predicted.rotation;
    for (const input of this.pending) {
      rotationBeforeLastStep = predicted.rotation;
      applyPlayerMovementInput(predicted, input);
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

// Builds a render-only snapshot: the local ship comes from the predictor, while remote ships, enemies, and
// projectiles are dead-reckoned from their authoritative velocity since the snapshot arrived.
export function predictSnapshotForRender(
  snapshot: SnapshotMessage,
  snapshotReceivedAt: number | null,
  now: number,
  predictor: LocalShipPredictor
): SnapshotMessage {
  const elapsedSeconds = Math.min(maxExtrapolationSeconds, Math.max(0, (now - (snapshotReceivedAt ?? now)) / 1000));

  return {
    ...snapshot,
    players: snapshot.players.map((player) =>
      player.playerId === snapshot.selfPlayerId ? predictor.predict(player) : predictRemotePlayer(player, elapsedSeconds)
    ),
    enemies:
      elapsedSeconds <= 0
        ? snapshot.enemies
        : snapshot.enemies.map((enemy) => ({ ...enemy, position: extrapolate(enemy.position, enemy.velocity, elapsedSeconds) })),
    // Projectiles fly in straight lines at constant speed, so extrapolation is exact until they hit something.
    projectiles:
      elapsedSeconds <= 0
        ? snapshot.projectiles
        : snapshot.projectiles.map((projectile) => ({
            ...projectile,
            position: extrapolate(projectile.position, projectile.velocity, elapsedSeconds)
          }))
  };
}

// Predicts other players with simple dead reckoning from their authoritative velocity.
function predictRemotePlayer(player: PlayerSnapshot, elapsedSeconds: number): PlayerSnapshot {
  if (elapsedSeconds <= 0) {
    return player;
  }
  const predicted = clonePlayer(player);
  integratePlayerMovement(predicted, elapsedSeconds);
  return predicted;
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
