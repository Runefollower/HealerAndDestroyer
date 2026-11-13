import type { EffectEvent, EffectKind } from "@healer/shared";

// Client-side bookkeeping for cosmetic effects (§12). The server sends each dust cloud or explosion in
// several consecutive snapshots; this module plays each one exactly once, caps how many run at a time,
// and starts late arrivals part-way through so every viewer sees roughly the same moment.

export interface ActiveEffect {
  id: string;
  kind: EffectKind;
  x: number;
  y: number;
  radius: number;
  tint: number;
  // startedAt is a local performance timestamp (possibly in the past for late-arriving events).
  startedAt: number;
  lifetimeMs: number;
  // seed gives each effect stable pseudo-random particle directions.
  seed: number;
}

// Hard cap on simultaneous effects; a chain of detonations drops the oldest first.
export const maxActiveEffects = 32;
// Remember played ids a little longer than the server keeps sending them (about one second).
const seenIdRetentionMs = 4000;

export function effectLifetimeMs(kind: EffectKind, radius: number): number {
  switch (kind) {
    case "dust":
      return 950;
    case "rockBurst":
      return 460;
    case "explosion":
      // Bigger blasts linger a little longer so the smoke has time to roll out.
      return Math.min(1300, 650 + radius * 6);
  }
}

export class WorldEffects {
  readonly active: ActiveEffect[] = [];
  private readonly seen = new Map<string, number>();
  private mapId: string | null = null;

  // Starts any unseen events. secondsSinceTick converts a server tick into how long ago it happened.
  ingest(mapId: string, events: readonly EffectEvent[], now: number, secondsSinceTick?: (tick: number) => number): void {
    if (mapId !== this.mapId) {
      // A map change makes old effects meaningless; ids are only unique within one map.
      this.mapId = mapId;
      this.active.length = 0;
      this.seen.clear();
    }

    for (const event of events) {
      if (this.seen.has(event.id)) {
        continue;
      }
      this.seen.set(event.id, now);
      const lifetimeMs = effectLifetimeMs(event.kind, event.radius);
      const ageMs = Math.max(0, (secondsSinceTick?.(event.tick) ?? 0) * 1000);
      if (ageMs >= lifetimeMs) {
        continue;
      }
      this.active.push({
        id: event.id,
        kind: event.kind,
        x: event.position.x,
        y: event.position.y,
        radius: event.radius,
        tint: event.tint,
        startedAt: now - ageMs,
        lifetimeMs,
        seed: hashString(event.id)
      });
    }

    if (this.active.length > maxActiveEffects) {
      this.active.splice(0, this.active.length - maxActiveEffects);
    }
  }

  // Drops finished effects and forgets old ids.
  prune(now: number): void {
    let write = 0;
    for (const effect of this.active) {
      if (now - effect.startedAt < effect.lifetimeMs) {
        this.active[write] = effect;
        write += 1;
      }
    }
    this.active.length = write;

    for (const [id, seenAt] of this.seen) {
      if (now - seenAt > seenIdRetentionMs) {
        this.seen.delete(id);
      }
    }
  }
}

// Produces a deterministic unsigned hash for effect variation.
export function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}
