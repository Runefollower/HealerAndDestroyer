import { describe, expect, it } from "vitest";
import {
  applyPlayerMovementInput,
  deriveShipMovementProfile,
  integratePlayerMovement,
  PLAYER_ROTATION_STEP,
  PLAYER_VELOCITY_RETENTION,
  SHIP_MAX_ROTATION_STEP,
  SHIP_MIN_FORWARD_ACCELERATION,
  SHIP_MIN_ROTATION_STEP,
  type PlayerMovementState
} from "./playerMovement.js";

describe("player movement helpers", () => {
  it("rotates and applies thrust along the current facing", () => {
    const state: PlayerMovementState = {
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      rotation: Math.PI / 2
    };

    applyPlayerMovementInput(state, {
      thrustForward: false,
      thrustReverse: false,
      rotateLeft: false,
      rotateRight: true
    });
    expect(state.rotation).toBeCloseTo(Math.PI / 2 + PLAYER_ROTATION_STEP, 5);

    applyPlayerMovementInput(state, {
      thrustForward: true,
      thrustReverse: false,
      rotateLeft: false,
      rotateRight: false
    });

    expect(state.velocity.y).toBeGreaterThan(0);
    expect(Math.abs(state.velocity.y)).toBeGreaterThan(Math.abs(state.velocity.x));
  });

  it("integrates position and applies tick-rate-scaled velocity retention", () => {
    const state: PlayerMovementState = {
      position: { x: 0, y: 0 },
      velocity: { x: 30, y: 0 },
      rotation: 0
    };

    integratePlayerMovement(state, 1 / 30);

    expect(state.position.x).toBeCloseTo(1, 5);
    expect(state.velocity.x).toBeCloseTo(30 * PLAYER_VELOCITY_RETENTION, 5);
  });

  it("derives acceleration from thrust over mass and keeps extreme loadouts controllable", () => {
    const light = deriveShipMovementProfile(280, 70, 70);
    const heavy = deriveShipMovementProfile(280, 70, 140);
    expect(heavy.forwardAcceleration).toBeCloseTo(light.forwardAcceleration / 2, 5);
    expect(heavy.reverseAcceleration).toBeCloseTo(heavy.forwardAcceleration / 2, 5);

    const brick = deriveShipMovementProfile(10, 5, 1000);
    expect(brick.forwardAcceleration).toBe(SHIP_MIN_FORWARD_ACCELERATION);
    expect(brick.rotationStep).toBe(SHIP_MIN_ROTATION_STEP);
    expect(deriveShipMovementProfile(280, 500, 40).rotationStep).toBe(SHIP_MAX_ROTATION_STEP);
  });

  it("applies a ship's own movement profile", () => {
    const state: PlayerMovementState = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, rotation: 0 };
    applyPlayerMovementInput(state, { thrustForward: true, thrustReverse: false, rotateLeft: true, rotateRight: false }, {
      forwardAcceleration: 90,
      reverseAcceleration: 45,
      rotationStep: 0.1
    });
    expect(state.rotation).toBeCloseTo(-0.1, 5);
    expect(Math.hypot(state.velocity.x, state.velocity.y)).toBeCloseTo(3, 5);
  });
});
