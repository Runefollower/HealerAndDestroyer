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
// Inputs are applied once per 30 Hz tick. Clients used to send (and the server applied) one input per render
// frame, so these values are doubled from that era to keep the turn rate and top speed players had at 60 fps.
export const PLAYER_ROTATION_STEP = 0.2;
export const PLAYER_FORWARD_THRUST = 160;
export const PLAYER_REVERSE_THRUST = 80;
export const PLAYER_VELOCITY_RETENTION = 0.96;
export const PLAYER_MOVEMENT_INPUT_RATE_HZ = 30;

// Per-ship movement tuning derived from hull and module stats (see deriveShipMovementProfile).
export interface ShipMovementProfile {
  // forwardAcceleration and reverseAcceleration are pixels per second squared while the key is held.
  forwardAcceleration: number;
  reverseAcceleration: number;
  // rotationStep is radians turned per 30 Hz input step.
  rotationStep: number;
}

// The tuning every ship used before hull/module stats mattered. It is also the starter Sparrow's derived profile.
export const DEFAULT_SHIP_MOVEMENT_PROFILE: ShipMovementProfile = {
  forwardAcceleration: PLAYER_FORWARD_THRUST,
  reverseAcceleration: PLAYER_REVERSE_THRUST,
  rotationStep: PLAYER_ROTATION_STEP
};

// Converts thrust units into pixels per second squared: acceleration = scale * thrust / mass (GDD 8.3).
export const SHIP_THRUST_TO_ACCELERATION = 40;
// Converts torque units into radians per input step: rotationStep = scale * torque / mass.
export const SHIP_TORQUE_TO_ROTATION_STEP = 0.2;
// Reverse thrust stays at half of forward thrust, as it always has.
export const SHIP_REVERSE_THRUST_RATIO = PLAYER_REVERSE_THRUST / PLAYER_FORWARD_THRUST;
// Clamps keep extreme loadouts controllable: no ship turns too sluggishly to aim or so fast it is twitchy.
export const SHIP_MIN_ROTATION_STEP = 0.07;
export const SHIP_MAX_ROTATION_STEP = 0.28;
export const SHIP_MIN_FORWARD_ACCELERATION = 40;
export const SHIP_MAX_FORWARD_ACCELERATION = 260;

// Derives a ship's movement profile from total thrust, torque, and mass. Shared so the server simulation and
// the client's input replay always agree for the same loadout.
export function deriveShipMovementProfile(totalThrust: number, totalTorque: number, totalMass: number): ShipMovementProfile {
  const mass = Math.max(1, totalMass);
  const forwardAcceleration = clampNumber((SHIP_THRUST_TO_ACCELERATION * totalThrust) / mass, SHIP_MIN_FORWARD_ACCELERATION, SHIP_MAX_FORWARD_ACCELERATION);
  return {
    forwardAcceleration,
    reverseAcceleration: forwardAcceleration * SHIP_REVERSE_THRUST_RATIO,
    rotationStep: clampNumber((SHIP_TORQUE_TO_ROTATION_STEP * totalTorque) / mass, SHIP_MIN_ROTATION_STEP, SHIP_MAX_ROTATION_STEP)
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Applies one raw input sample to rotation and velocity, matching the server's authoritative handling.
export function applyPlayerMovementInput(
  state: PlayerMovementState,
  input: PlayerMovementInput,
  profile: ShipMovementProfile = DEFAULT_SHIP_MOVEMENT_PROFILE
): void {
  if (input.rotateLeft) {
    state.rotation -= profile.rotationStep;
  }
  if (input.rotateRight) {
    state.rotation += profile.rotationStep;
  }

  const thrust = input.thrustForward ? profile.forwardAcceleration : input.thrustReverse ? -profile.reverseAcceleration : 0;
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
