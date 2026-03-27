import type { ActiveMapState, PersistedMapState, PersistentMapSummary } from "@healer/shared";

export function applyPersistedMapState(runtimeMap: ActiveMapState, persisted: PersistedMapState): void {
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

export function serializeMapState(runtimeMap: ActiveMapState, summary: PersistentMapSummary): PersistedMapState {
  return {
    map: summary,
    chunkDeltas: Object.entries(runtimeMap.chunks).map(([chunkKey, chunk]) => ({
      chunkKey,
      changedCells: chunk.cells.map((value, index) => ({ index, value }))
    })),
    structures: Object.values(runtimeMap.structures).map((structure) => ({
      id: structure.id,
      structureTypeId: structure.structureTypeId,
      position: structuredClone(structure.position),
      health: structure.health,
      maxHealth: structure.maxHealth,
      buildState: structure.buildState
    })),
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
