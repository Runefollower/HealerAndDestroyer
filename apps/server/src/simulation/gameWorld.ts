import { enemyDefinitions, getHullDefinition, getModuleDefinition, moduleDefinitions, weaponDefinitions } from "@healer/content";
import { createInMemoryPersistence, type PersistenceBundle } from "@healer/persistence";
import {
  addResourceMaps,
  asEntityId,
  asPlayerId,
  asShipId,
  asWorldId,
  clientMessageSchema,
  createSnapshotMessage,
  distance,
  hasEnoughResources,
  normalize,
  scaleVec2,
  subtractResourceMaps,
  type ActiveMapState,
  type BuilderActionMessage,
  type ChangeMapMessage,
  type ChunkDelta,
  type CraftedModuleStack,
  type FireWeaponMessage,
  type InteractMessage,
  type MoveInputMessage,
  type PersistedMapState,
  type PersistentWorld,
  type PlayerSave,
  type PlayerShipState,
  type ServerMessage,
  type SnapshotMessage,
  type StoredShip,
  type WorldRuntimeState
} from "@healer/shared";
import { CHUNK_SIZE, createDefaultPlayerSave, createRuntimeState, createWorldGraph } from "./createWorld.js";

interface PlayerSessionState {
  playerId: ReturnType<typeof asPlayerId>;
  connectedAt: number;
  lastInputTick: number;
}

export class GameWorld {
  readonly persistence: PersistenceBundle;
  readonly worldId = asWorldId("world-alpha");
  readonly runtime: WorldRuntimeState;
  private readonly sessions = new Map<string, PlayerSessionState>();
  private tickCounter = 0;
  private persistentWorld: PersistentWorld = createWorldGraph(this.worldId);

  constructor(persistence: PersistenceBundle = createInMemoryPersistence()) {
    this.persistence = persistence;
    this.runtime = createRuntimeState();
  }

  async initialize(): Promise<void> {
    const storedWorld = await this.persistence.worlds.getWorld(this.worldId);
    this.persistentWorld = storedWorld ?? createWorldGraph(this.worldId);
    if (!storedWorld) {
      await this.persistence.worlds.saveWorld(this.persistentWorld);
    }

    for (const mapSummary of Object.values(this.persistentWorld.maps)) {
      const persisted = await this.persistence.maps.getMapState(this.worldId, mapSummary.id);
      if (persisted) {
        this.applyPersistedMapState(mapSummary.id, persisted);
      } else {
        await this.persistence.maps.saveMapState(this.worldId, this.serializeMapState(mapSummary.id));
      }
    }
  }

  async connectPlayer(rawPlayerId: string): Promise<PlayerSave> {
    const playerId = asPlayerId(rawPlayerId);
    let player = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!player) {
      player = createDefaultPlayerSave(this.worldId, playerId);
      await this.persistence.players.savePlayer(player);
    }

    player = await this.syncCompletedShipBuilds(player);
    const activeShip = this.resolveActiveShip(player);
    const map = this.runtime.maps[player.spawnPoint.mapId];
    map.players[playerId] = this.createRuntimeShip(playerId, activeShip, player);

    this.sessions.set(playerId, {
      playerId,
      connectedAt: Date.now(),
      lastInputTick: 0
    });

    return player;
  }

  async disconnectPlayer(rawPlayerId: string): Promise<void> {
    const playerId = asPlayerId(rawPlayerId);
    const player = await this.persistence.players.getPlayer(this.worldId, playerId);
    const map = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    if (player && map) {
      const ship = map.players[playerId];
      const storedShip = player.shipStable[player.activeShipId];
      if (storedShip) {
        storedShip.modules = structuredClone(ship.modules);
        storedShip.hullIntegrity = ship.hull;
      }
      await this.persistence.players.savePlayer({
        ...player,
        resourceCounts: ship.inventory,
        spawnPoint: {
          mapId: ship.mapId,
          position: ship.position
        },
        updatedAt: Date.now()
      });
      delete map.players[playerId];
    }
    await this.saveDirtyMaps();
    this.sessions.delete(playerId);
  }

  async handleMessage(rawPlayerId: string, message: unknown): Promise<ServerMessage[]> {
    const parsed = clientMessageSchema.parse(message);
    const playerId = asPlayerId(rawPlayerId);

    if (parsed.type === "joinWorld") {
      const connected = Object.values(this.runtime.maps).some((map) => !!map.players[playerId]);
      if (!connected) {
        await this.connectPlayer(playerId);
      }
      return [];
    }

    const player = this.getPlayerShip(playerId);

    switch (parsed.type) {
      case "moveInput":
        this.applyMovementInput(player, parsed);
        this.sessions.get(playerId)!.lastInputTick = parsed.tick;
        return [];
      case "fireWeapon":
        this.fireWeapon(player, parsed);
        return [];
      case "interact":
        return this.interact(playerId, parsed);
      case "changeMap":
        this.changeMap(playerId, parsed);
        return [];
      case "builderAction":
        return this.handleBuilderAction(playerId, parsed);
      default:
        return [];
    }
  }

  tick(deltaMs = 1000 / 30): void {
    this.tickCounter += 1;
    const deltaSeconds = deltaMs / 1000;

    for (const map of Object.values(this.runtime.maps)) {
      for (const player of Object.values(map.players)) {
        player.position.x += player.velocity.x * deltaSeconds;
        player.position.y += player.velocity.y * deltaSeconds;
        player.velocity.x *= 0.92;
        player.velocity.y *= 0.92;
      }

      for (const projectile of Object.values(map.projectiles)) {
        projectile.position.x += projectile.velocity.x * deltaSeconds;
        projectile.position.y += projectile.velocity.y * deltaSeconds;
        projectile.lifetimeMs -= deltaMs;

        const enemy = Object.values(map.enemies).find((entry) => distance(entry.position, projectile.position) < 14);
        if (enemy) {
          enemy.health -= projectile.damage;
          delete map.projectiles[projectile.id];
          if (enemy.health <= 0) {
            const definition = enemyDefinitions.find((entry) => entry.id === enemy.enemyTypeId);
            map.drops[`drop-${enemy.id}`] = {
              id: asEntityId(`drop-${enemy.id}`),
              mapId: enemy.mapId,
              position: { ...enemy.position },
              resources: definition?.salvage ?? { ferrite: 1 }
            };
            delete map.enemies[enemy.id];
          }
          continue;
        }

        if (this.applyTerrainHit(map, projectile.position)) {
          delete map.projectiles[projectile.id];
          continue;
        }

        if (projectile.lifetimeMs <= 0) {
          delete map.projectiles[projectile.id];
        }
      }

      for (const enemy of Object.values(map.enemies)) {
        const nearestPlayer = Object.values(map.players).sort(
          (left, right) => distance(left.position, enemy.position) - distance(right.position, enemy.position)
        )[0];
        if (!nearestPlayer) {
          continue;
        }

        enemy.aiState = "chasing";
        const direction = normalize({
          x: nearestPlayer.position.x - enemy.position.x,
          y: nearestPlayer.position.y - enemy.position.y
        });
        enemy.velocity = scaleVec2(direction, 20);
        enemy.position.x += enemy.velocity.x * deltaSeconds;
        enemy.position.y += enemy.velocity.y * deltaSeconds;

        if (distance(enemy.position, nearestPlayer.position) < 18) {
          nearestPlayer.hull = Math.max(0, nearestPlayer.hull - 4);
        }
      }

      for (const [dropId, drop] of Object.entries(map.drops)) {
        const collector = Object.values(map.players).find((entry) => distance(entry.position, drop.position) < 16);
        if (collector) {
          collector.inventory = addResourceMaps(collector.inventory, drop.resources);
          delete map.drops[dropId];
        }
      }
    }

    void this.processShipBuildCompletions();
  }

  getSnapshot(rawPlayerId: string): SnapshotMessage {
    const playerId = asPlayerId(rawPlayerId);
    const map = this.getPlayerMap(playerId);
    const player = this.getPlayerShip(playerId);
    return createSnapshotMessage(this.tickCounter, playerId, player.mapId, map, player, this.isBuilderSiteNearby(playerId));
  }

  private getPlayerMap(playerId: ReturnType<typeof asPlayerId>) {
    const map = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    if (!map) {
      throw new Error(`Player ${playerId} is not in an active map.`);
    }
    return map;
  }

  private getPlayerShip(playerId: ReturnType<typeof asPlayerId>) {
    const map = this.getPlayerMap(playerId);
    return map.players[playerId];
  }

  private createRuntimeShip(playerId: ReturnType<typeof asPlayerId>, ship: StoredShip, player: PlayerSave): PlayerShipState {
    const hull = getHullDefinition(ship.hullId);
    return {
      id: asEntityId(`entity-${ship.id}`),
      playerId,
      shipId: ship.id,
      mapId: player.spawnPoint.mapId,
      position: { ...player.spawnPoint.position },
      velocity: { x: 0, y: 0 },
      rotation: 0,
      angularVelocity: 0,
      hull: ship.hullIntegrity,
      maxHull: hull.baseHull,
      power: 30,
      maxPower: hull.powerCapacity,
      modules: structuredClone(ship.modules),
      inventory: { ...player.resourceCounts }
    };
  }

  private resolveActiveShip(player: PlayerSave): StoredShip {
    const activeShip = player.shipStable[player.activeShipId];
    if (!activeShip) {
      throw new Error(`Player ${player.playerId} is missing active ship ${player.activeShipId}.`);
    }
    return activeShip;
  }

  private applyMovementInput(player: PlayerShipState, input: MoveInputMessage): void {
    const thrustDirection = {
      x: input.aimWorld.x - player.position.x,
      y: input.aimWorld.y - player.position.y
    };
    const normalized = normalize(thrustDirection);
    const acceleration = input.thrustForward ? 80 : input.thrustReverse ? -40 : 0;
    player.velocity.x += normalized.x * acceleration * (1 / 30);
    player.velocity.y += normalized.y * acceleration * (1 / 30);
    if (input.rotateLeft) {
      player.rotation -= 0.1;
    }
    if (input.rotateRight) {
      player.rotation += 0.1;
    }
  }

  private fireWeapon(player: PlayerShipState, message: FireWeaponMessage): void {
    const map = this.runtime.maps[player.mapId];
    const installedModule = player.modules.find((entry) => entry.hardpointId === message.weaponHardpointId || entry.moduleId === message.weaponHardpointId);
    const weaponId = installedModule?.moduleId ?? message.weaponHardpointId;
    const weapon = weaponDefinitions.find((entry) => entry.id === weaponId) ?? weaponDefinitions[0];
    const direction = normalize({
      x: (message.targetWorld?.x ?? player.position.x + 1) - player.position.x,
      y: (message.targetWorld?.y ?? player.position.y) - player.position.y
    });
    const projectileId = asEntityId(`projectile-${this.tickCounter}-${Math.random().toString(16).slice(2, 6)}`);
    map.projectiles[projectileId] = {
      id: projectileId,
      mapId: player.mapId,
      ownerPlayerId: player.playerId,
      position: { ...player.position },
      velocity: scaleVec2(direction, weapon.range),
      damage: weapon.damage,
      lifetimeMs: weapon.cooldownMs * 3
    };
  }

  private async interact(playerId: ReturnType<typeof asPlayerId>, _message: InteractMessage): Promise<ServerMessage[]> {
    if (!this.isBuilderSiteNearby(playerId)) {
      return [];
    }

    const player = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!player) {
      return [];
    }

    const synced = await this.syncCompletedShipBuilds(player);
    return [this.createBuilderState(synced)];
  }

  private changeMap(playerId: ReturnType<typeof asPlayerId>, message: ChangeMapMessage): void {
    const sourceMap = this.getPlayerMap(playerId);
    const player = sourceMap.players[playerId];
    const connection = sourceMap.connections.find((entry) => entry.id === message.connectionId);
    if (!connection?.destinationMapId) {
      return;
    }
    const destinationMap = this.runtime.maps[connection.destinationMapId];
    delete sourceMap.players[playerId];
    player.mapId = connection.destinationMapId;
    player.position = {
      x: (connection.destinationAnchor?.x ?? 1) * 32,
      y: (connection.destinationAnchor?.y ?? 1) * 32
    };
    destinationMap.players[playerId] = player;
  }

  private async handleBuilderAction(playerId: ReturnType<typeof asPlayerId>, message: BuilderActionMessage): Promise<ServerMessage[]> {
    if (!this.isBuilderSiteNearby(playerId)) {
      return [];
    }

    let playerSave = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!playerSave) {
      return [];
    }

    playerSave = await this.syncCompletedShipBuilds(playerSave);

    if (message.action === "craftModule") {
      const definition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      if (definition && hasEnoughResources(playerSave.resourceCounts, definition.buildCost)) {
        playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, definition.buildCost);
        playerSave.craftedModules = this.addCraftedModule(playerSave.craftedModules, definition.id, 1);
      }
    }

    if (message.action === "startShipBuild") {
      const hull = getHullDefinition(message.targetId);
      if (hasEnoughResources(playerSave.resourceCounts, hull.buildCost)) {
        playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, hull.buildCost);
        const builtShipId = asShipId(`ship-${message.targetId}-${Date.now()}`);
        playerSave.shipStable[builtShipId] = {
          id: builtShipId,
          name: hull.name,
          hullId: hull.id,
          modules: [],
          hullIntegrity: hull.baseHull,
          status: hull.buildTimeMs > 0 ? "building" : "stored",
          buildCompleteAt: hull.buildTimeMs > 0 ? Date.now() + hull.buildTimeMs : null
        };
      }
    }

    if (message.action === "swapShip" && playerSave.shipStable[message.targetId] && playerSave.shipStable[message.targetId].status !== "building") {
      const currentShip = playerSave.shipStable[playerSave.activeShipId];
      if (currentShip) {
        currentShip.status = "stored";
      }
      playerSave.activeShipId = asShipId(message.targetId);
      playerSave.shipStable[message.targetId].status = "active";
      this.syncRuntimeShipFromSave(playerId, playerSave);
    }

    if (message.action === "installModule" && message.shipId && message.hardpointId) {
      const ship = playerSave.shipStable[message.shipId];
      const hull = ship ? getHullDefinition(ship.hullId) : null;
      const moduleDefinition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      const hardpoint = hull?.hardpoints.find((entry) => entry.id === message.hardpointId);
      const availableModule = playerSave.craftedModules.find((entry) => entry.moduleId === message.targetId && entry.quantity > 0);
      if (ship && hull && moduleDefinition && hardpoint && availableModule && hardpoint.type === moduleDefinition.slotType) {
        const existingModule = ship.modules.find((entry) => entry.hardpointId === message.hardpointId);
        if (existingModule) {
          playerSave.craftedModules = this.addCraftedModule(playerSave.craftedModules, existingModule.moduleId, 1);
          ship.modules = ship.modules.filter((entry) => entry.hardpointId !== message.hardpointId);
        }
        ship.modules.push({
          moduleId: moduleDefinition.id,
          hardpointId: message.hardpointId,
          currentHealth: moduleDefinition.maxHealth
        });
        playerSave.craftedModules = this.removeCraftedModule(playerSave.craftedModules, moduleDefinition.id, 1);
        this.syncRuntimeShipFromSave(playerId, playerSave);
      }
    }

    if (message.action === "removeModule" && message.shipId && message.hardpointId) {
      const ship = playerSave.shipStable[message.shipId];
      if (ship) {
        const existingModule = ship.modules.find((entry) => entry.hardpointId === message.hardpointId);
        if (existingModule) {
          ship.modules = ship.modules.filter((entry) => entry.hardpointId !== message.hardpointId);
          playerSave.craftedModules = this.addCraftedModule(playerSave.craftedModules, existingModule.moduleId, 1);
          this.syncRuntimeShipFromSave(playerId, playerSave);
        }
      }
    }

    playerSave.updatedAt = Date.now();
    await this.persistence.players.savePlayer(playerSave);
    return [this.createBuilderState(playerSave)];
  }

  private syncRuntimeShipFromSave(playerId: ReturnType<typeof asPlayerId>, playerSave: PlayerSave): void {
    const map = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    if (!map) {
      return;
    }
    const runtimePlayer = map.players[playerId];
    const activeShip = this.resolveActiveShip(playerSave);
    const hull = getHullDefinition(activeShip.hullId);
    runtimePlayer.shipId = activeShip.id;
    runtimePlayer.modules = structuredClone(activeShip.modules);
    runtimePlayer.hull = activeShip.hullIntegrity;
    runtimePlayer.maxHull = hull.baseHull;
    runtimePlayer.maxPower = hull.powerCapacity;
    runtimePlayer.inventory = { ...playerSave.resourceCounts };
  }

  private isBuilderSiteNearby(playerId: ReturnType<typeof asPlayerId>): boolean {
    const map = this.getPlayerMap(playerId);
    const player = map.players[playerId];
    return Object.values(map.structures).some(
      (structure) => structure.structureTypeId === "builder-site" && distance(structure.position, player.position) < 48
    );
  }

  private createBuilderState(player: PlayerSave): ServerMessage {
    return {
      type: "builderState",
      activeShipId: player.activeShipId,
      availableShips: player.shipStable,
      craftedModules: player.craftedModules
    };
  }

  private addCraftedModule(stacks: CraftedModuleStack[], moduleId: string, quantity: number): CraftedModuleStack[] {
    const nextStacks = stacks.map((entry) => ({ ...entry }));
    const existing = nextStacks.find((entry) => entry.moduleId === moduleId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      nextStacks.push({ moduleId, quantity });
    }
    return nextStacks.filter((entry) => entry.quantity > 0);
  }

  private removeCraftedModule(stacks: CraftedModuleStack[], moduleId: string, quantity: number): CraftedModuleStack[] {
    return stacks
      .map((entry) => (entry.moduleId === moduleId ? { ...entry, quantity: entry.quantity - quantity } : { ...entry }))
      .filter((entry) => entry.quantity > 0);
  }

  private async syncCompletedShipBuilds(player: PlayerSave): Promise<PlayerSave> {
    let changed = false;
    for (const ship of Object.values(player.shipStable)) {
      if (ship.status === "building" && ship.buildCompleteAt && ship.buildCompleteAt <= Date.now()) {
        ship.status = ship.id === player.activeShipId ? "active" : "stored";
        ship.buildCompleteAt = null;
        changed = true;
      }
    }
    if (changed) {
      player.updatedAt = Date.now();
      await this.persistence.players.savePlayer(player);
    }
    return player;
  }

  private async processShipBuildCompletions(): Promise<void> {
    for (const session of this.sessions.values()) {
      const player = await this.persistence.players.getPlayer(this.worldId, session.playerId);
      if (!player) {
        continue;
      }
      const beforeActiveShipId = player.activeShipId;
      const synced = await this.syncCompletedShipBuilds(player);
      if (beforeActiveShipId !== synced.activeShipId) {
        this.syncRuntimeShipFromSave(session.playerId, synced);
      }
    }
  }

  private worldToTile(position: { x: number; y: number }): { chunkKey: string; chunkX: number; chunkY: number; cellIndex: number } | null {
    const tileX = Math.floor(position.x / 32);
    const tileY = Math.floor(position.y / 32);
    if (tileX < 0 || tileY < 0) {
      return null;
    }
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);
    const localX = tileX % CHUNK_SIZE;
    const localY = tileY % CHUNK_SIZE;
    return {
      chunkKey: `${chunkX},${chunkY}`,
      chunkX,
      chunkY,
      cellIndex: localY * CHUNK_SIZE + localX
    };
  }

  private applyTerrainHit(map: ActiveMapState, position: { x: number; y: number }): boolean {
    const tile = this.worldToTile(position);
    if (!tile) {
      return false;
    }
    const chunk = map.chunks[tile.chunkKey];
    if (!chunk) {
      return false;
    }
    const currentValue = chunk.cells[tile.cellIndex] ?? 0;
    if (currentValue === 0) {
      return false;
    }

    chunk.cells[tile.cellIndex] = 0;
    chunk.dirty = true;
    map.drops[`terrain-${tile.chunkKey}-${tile.cellIndex}-${this.tickCounter}`] = {
      id: asEntityId(`terrain-${tile.chunkKey}-${tile.cellIndex}-${this.tickCounter}`),
      mapId: map.id,
      position: { x: position.x, y: position.y },
      resources: currentValue === 1 ? { ferrite: 2 } : { ferrite: 1, "plasma-crystal": 1 }
    };
    void this.persistence.maps.saveMapState(this.worldId, this.serializeMapState(map.id));
    return true;
  }

  private applyPersistedMapState(mapId: string, persisted: PersistedMapState): void {
    const runtimeMap = this.runtime.maps[mapId];
    if (!runtimeMap) {
      return;
    }
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
  }

  private serializeMapState(mapId: string): PersistedMapState {
    const runtimeMap = this.runtime.maps[mapId];
    const summary = this.persistentWorld.maps[mapId];
    const chunkDeltas: ChunkDelta[] = Object.entries(runtimeMap.chunks).map(([chunkKey, chunk]) => ({
      chunkKey,
      changedCells: chunk.cells.map((value, index) => ({ index, value }))
    }));
    return {
      map: summary,
      chunkDeltas
    };
  }

  private async saveDirtyMaps(): Promise<void> {
    for (const [mapId, map] of Object.entries(this.runtime.maps)) {
      if (Object.values(map.chunks).some((chunk) => chunk.dirty)) {
        await this.persistence.maps.saveMapState(this.worldId, this.serializeMapState(mapId));
        for (const chunk of Object.values(map.chunks)) {
          chunk.dirty = false;
        }
      }
    }
  }
}
