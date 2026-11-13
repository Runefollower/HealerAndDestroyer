import type { Vec2 } from "./math.js";

// Cosmetic world effects (§12). The server decides when something was mined, blown apart, or destroyed and
// records a short-lived event; the client turns each event into a purely visual dust cloud or explosion.

// dust: a mining module finished a block. rockBurst: weapon fire broke an ordinary block.
// explosion: a volatile block detonated or an enemy, foundry, or ship was destroyed.
export type EffectKind = "dust" | "rockBurst" | "explosion";

export interface EffectEvent {
  // id is unique per map so clients can play each event exactly once across overlapping snapshots.
  id: string;
  kind: EffectKind;
  position: Vec2;
  // radius is the world-space size of the effect in pixels (for explosions, the blast radius).
  radius: number;
  // tint is a 0xRRGGBB colour, usually the destroyed terrain material's burst tint.
  tint: number;
  // tick is the server simulation tick the event happened on, so late snapshots can start it part-way.
  tick: number;
}

// EFFECT_EVENT_RETENTION_TICKS keeps events in snapshots for about one second at 30 Hz, long enough for
// a 10 Hz snapshot stream (and a dropped snapshot or two) to deliver each one.
export const EFFECT_EVENT_RETENTION_TICKS = 30;

// Drifting drops: shared so the server simulation and the client's extrapolation follow the same curve.
export const DROP_DRIFT = {
  // Collision radius of a drop against terrain and structures, in world pixels.
  radius: 5,
  // Initial launch speed range in pixels per second.
  minLaunchSpeed: 14,
  maxLaunchSpeed: 34,
  // Initial spin range in radians per second (either direction).
  maxLaunchSpin: 2.6,
  // Exponential drag rates per second; velocity scales by exp(-drag * t).
  linearDrag: 0.45,
  angularDrag: 0.35,
  // Speeds below these settle to exactly zero so idle drops stop costing bandwidth and CPU.
  restSpeed: 1.5,
  restSpin: 0.08,
  // Fraction of speed kept (and reversed) along an axis that hits a wall.
  restitution: 0.55
} as const;

// Returns the position/rotation offset a drifting drop covers in `seconds` under DROP_DRIFT drag, ignoring
// collisions. Used by the client to extrapolate between snapshots along the same curve as the server.
export function driftOffset(velocity: Vec2, angularVelocity: number, seconds: number): { x: number; y: number; rotation: number } {
  if (seconds <= 0) {
    return { x: 0, y: 0, rotation: 0 };
  }
  const linear = (1 - Math.exp(-DROP_DRIFT.linearDrag * seconds)) / DROP_DRIFT.linearDrag;
  const angular = (1 - Math.exp(-DROP_DRIFT.angularDrag * seconds)) / DROP_DRIFT.angularDrag;
  return { x: velocity.x * linear, y: velocity.y * linear, rotation: angularVelocity * angular };
}
