import type { ActiveMapState, PersistedMapState, PersistentMapSummary } from "@healer/shared";

// Replays persisted chunk/structure/foundry state into a freshly created runtime map template.
export function applyPersistedMapState(runtimeMap: ActiveMapState, persisted: PersistedMapState): void {
  // Chunk deltas currently store every cell value, so replaying them restores mined terrain exactly.
  for (const delta of persisted.chunkDeltas) {
    const chunk = runtimeMap.chunks[delta.chunkKey];
    if (!chunk) {
      continue;
    }
    for (const cell of delta.changedCells) {
      chunk.cells[cell.index] = cell.value;
    }
    chunk.dirty = false;
  }

  // Structures are cloned into runtime shape and reattached to the active map id.
  runtimeMap.structures = Object.fromEntries(
    persisted.structures.map((structure) => [
      structure.id,
      {
        ...structuredClone(structure),
        mapId: runtimeMap.id,
        ownerType: structure.structureTypeId === "builder-site" ? "neutral" : "enemy"
      }
    ])
  );

  // Foundries carry runtime spawn metadata, so restore their active/destroyed state with enemy ownership.
  runtimeMap.foundries = Object.fromEntries(
    persisted.foundries.map((foundry) => [
      foundry.id,
      {
        ...structuredClone(foundry),
        mapId: runtimeMap.id,
        ownerType: "enemy"
      }
    ])
  );
}

// Serializes the current runtime map into the persistence-friendly map state shape.
export function serializeMapState(runtimeMap: ActiveMapState, summary: PersistentMapSummary): PersistedMapState {
  return {
    map: summary,
    // Prototype persistence writes all chunk cells so reloads are simple and deterministic.
    chunkDeltas: Object.entries(runtimeMap.chunks).map(([chunkKey, chunk]) => ({
      chunkKey,
      changedCells: chunk.cells.map((value, index) => ({ index, value }))
    })),
    // Persist only the durable structure fields, not transient collision/render helpers.
    structures: Object.values(runtimeMap.structures).map((structure) => ({
      id: structure.id,
      structureTypeId: structure.structureTypeId,
      position: structuredClone(structure.position),
      health: structure.health,
      maxHealth: structure.maxHealth,
      buildState: structure.buildState
    })),
    // Foundry persistence includes spawn cadence and destruction state so objectives survive reconnects.
    foundries: Object.values(runtimeMap.foundries).map((foundry) => ({
      id: foundry.id,
      structureTypeId: foundry.structureTypeId,
      position: structuredClone(foundry.position),
      health: foundry.health,
      maxHealth: foundry.maxHealth,
      buildState: foundry.buildState,
      spawnCooldownMs: foundry.spawnCooldownMs,
      spawnCap: foundry.spawnCap,
      lastSpawnAt: foundry.lastSpawnAt,
      activeEnemyCount: foundry.activeEnemyCount,
      active: foundry.active,
      destroyedAt: foundry.destroyedAt ?? null
    }))
  };
}
