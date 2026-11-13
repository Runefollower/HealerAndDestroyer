import {
  DROP_DRIFT,
  type ActiveMapState,
  type LootDropState,
  type Vec2
} from "@healer/shared";
import { findNearestValidPosition, isPositionBlocked } from "./collision.js";

// Random source for drop launches; tests pass a seeded one to make drift deterministic.
export type RandomSource = () => number;

// Gives a freshly created drop its random launch velocity and spin, nudging it out of any wall it was
// spawned against so it can drift freely (terrain hits spawn drops right at the broken cell's edge).
export function launchDrop(map: ActiveMapState, drop: LootDropState, random: RandomSource = Math.random): void {
  const angle = random() * Math.PI * 2;
  const speed = DROP_DRIFT.minLaunchSpeed + random() * (DROP_DRIFT.maxLaunchSpeed - DROP_DRIFT.minLaunchSpeed);
  drop.velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  drop.rotation = random() * Math.PI * 2;
  drop.angularVelocity = (random() * 2 - 1) * DROP_DRIFT.maxLaunchSpin;
  if (isPositionBlocked(map, drop.position, DROP_DRIFT.radius)) {
    drop.position = findNearestValidPosition(map, drop.position, DROP_DRIFT.radius, {}, 3);
  }
}

// Advances every drop on the map: launches new ones, integrates drift with drag, and bounces off terrain
// and structures. Drops ignore ships and enemies so they never block movement or get shoved around.
export function tickDrops(map: ActiveMapState, deltaSeconds: number, random: RandomSource = Math.random): void {
  const linearKeep = Math.exp(-DROP_DRIFT.linearDrag * deltaSeconds);
  const angularKeep = Math.exp(-DROP_DRIFT.angularDrag * deltaSeconds);
  for (const drop of Object.values(map.drops)) {
    if (!drop.velocity) {
      launchDrop(map, drop, random);
      continue;
    }

    if (drop.velocity.x !== 0 || drop.velocity.y !== 0) {
      stepDrop(map, drop, drop.velocity, deltaSeconds);
      drop.velocity.x *= linearKeep;
      drop.velocity.y *= linearKeep;
      if (Math.hypot(drop.velocity.x, drop.velocity.y) < DROP_DRIFT.restSpeed) {
        drop.velocity = { x: 0, y: 0 };
      }
    }

    const spin = drop.angularVelocity ?? 0;
    if (spin !== 0) {
      drop.rotation = wrapAngle((drop.rotation ?? 0) + spin * deltaSeconds);
      drop.angularVelocity = Math.abs(spin * angularKeep) < DROP_DRIFT.restSpin ? 0 : spin * angularKeep;
    }
  }
}

// Moves one drop an axis at a time; a blocked axis reverses with restitution so drops bounce off walls.
function stepDrop(map: ActiveMapState, drop: LootDropState, velocity: Vec2, deltaSeconds: number): void {
  // A drop already overlapping something (a wall regrown by a map edit, a structure built on it) moves
  // freely until it is clear, rather than being pinned in place forever.
  const trapped = isPositionBlocked(map, drop.position, DROP_DRIFT.radius);

  const candidateX = { x: drop.position.x + velocity.x * deltaSeconds, y: drop.position.y };
  if (trapped || !isPositionBlocked(map, candidateX, DROP_DRIFT.radius)) {
    drop.position = candidateX;
  } else {
    velocity.x = -velocity.x * DROP_DRIFT.restitution;
  }

  const candidateY = { x: drop.position.x, y: drop.position.y + velocity.y * deltaSeconds };
  if (trapped || !isPositionBlocked(map, candidateY, DROP_DRIFT.radius)) {
    drop.position = candidateY;
  } else {
    velocity.y = -velocity.y * DROP_DRIFT.restitution;
  }
}

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}
