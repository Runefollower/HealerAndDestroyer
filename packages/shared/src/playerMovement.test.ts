import { describe, expect, it } from "vitest";
import { applyPlayerMovementInput, integratePlayerMovement, PLAYER_ROTATION_STEP, PLAYER_VELOCITY_RETENTION, type PlayerMovementState } from "./playerMovement.js";

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
});
