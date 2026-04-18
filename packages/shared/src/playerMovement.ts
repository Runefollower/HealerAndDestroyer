import type { Vec2 } from "./math.js";

export interface PlayerMovementInput {
  // thrustForward and thrustReverse accelerate along the current ship facing.
  thrustForward: boolean;
  thrustReverse: boolean;
  // rotateLeft and rotateRight turn the ship before thrust is applied.
  rotateLeft: boolean;
  rotateRight: boolean;
}

export interface PlayerMovementState {
  // position is world-space pixels.
  position: Vec2;
  // velocity is world-space pixels per second.
  velocity: Vec2;
  // rotation is radians, where 0 faces positive X.
  rotation: number;
}

// Shared movement tuning keeps authoritative server motion and client prediction aligned.
export const PLAYER_ROTATION_STEP = 0.1;
export const PLAYER_FORWARD_THRUST = 80;
export const PLAYER_REVERSE_THRUST = 40;
export const PLAYER_VELOCITY_RETENTION = 0.96;
export const PLAYER_MOVEMENT_INPUT_RATE_HZ = 30;

// Applies one raw input sample to rotation and velocity, matching the server's authoritative handling.
export function applyPlayerMovementInput(state: PlayerMovementState, input: PlayerMovementInput): void {
  if (input.rotateLeft) {
    state.rotation -= PLAYER_ROTATION_STEP;
  }
  if (input.rotateRight) {
    state.rotation += PLAYER_ROTATION_STEP;
  }

  const thrust = input.thrustForward ? PLAYER_FORWARD_THRUST : input.thrustReverse ? -PLAYER_REVERSE_THRUST : 0;
  if (thrust === 0) {
    return;
  }

  const forward = {
    x: Math.cos(state.rotation),
    y: Math.sin(state.rotation)
  };
  state.velocity.x += forward.x * thrust * (1 / PLAYER_MOVEMENT_INPUT_RATE_HZ);
  state.velocity.y += forward.y * thrust * (1 / PLAYER_MOVEMENT_INPUT_RATE_HZ);
}

// Integrates position with velocity and applies drag over a number of simulation ticks.
export function integratePlayerMovement(state: PlayerMovementState, deltaSeconds: number, tickRateHz = PLAYER_MOVEMENT_INPUT_RATE_HZ): void {
  state.position.x += state.velocity.x * deltaSeconds;
  state.position.y += state.velocity.y * deltaSeconds;

  const retentionSteps = Math.max(0, deltaSeconds * tickRateHz);
  const retention = PLAYER_VELOCITY_RETENTION ** retentionSteps;
  state.velocity.x *= retention;
  state.velocity.y *= retention;
}
