import { EFFECT_EVENT_RETENTION_TICKS, type ActiveMapState, type EffectEvent } from "@healer/shared";

// Records a cosmetic effect event on the map for upcoming snapshots.
export function emitEffect(map: ActiveMapState, event: EffectEvent): void {
  (map.effects ??= []).push(event);
}

// Forgets effect events older than the snapshot retention window.
export function pruneEffects(map: ActiveMapState, tick: number): void {
  if (!map.effects?.length) {
    return;
  }
  map.effects = map.effects.filter((effect) => tick - effect.tick <= EFFECT_EVENT_RETENTION_TICKS);
}
