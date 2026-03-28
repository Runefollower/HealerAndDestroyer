import { enemyDefinitions, getHullDefinition, moduleDefinitions } from "@healer/content";
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
  type ActivateModuleMessage,
  type ActiveMapState,
  type BuilderActionMessage,
  type ChangeMapMessage,
  type FireWeaponMessage,
  type InteractMessage,
  type PersistentWorld,
  type PlayerSave,
  type ServerMessage,
  type SnapshotMessage,
  type WorldRuntimeState
} from "@healer/shared";
import { createDefaultPlayerSave, createRuntimeState, createWorldGraph } from "./createWorld.js";
import { tickFoundries, applyFoundryDamage, isDeeperPathUnlocked, refreshFoundryEnemyCounts } from "./foundries.js";
import { applyPersistedMapState, serializeMapState } from "./mapPersistence.js";
import { activateInstalledModule, applyWeaponFire } from "./moduleActions.js";
import { createLogger } from "../logger.js";
import { createBuilderState, createRuntimeShip, resolveActiveShip, syncCompletedShipBuilds, syncPlayerSaveFromRuntime, syncRuntimeInventoryFromSave, syncRuntimeShipFromSave } from "./shipLifecycle.js";

interface PlayerSessionState {
  playerId: ReturnType<typeof asPlayerId>;
  connectedAt: number;
  lastInputTick: number;
}

const logger = createLogger("gameWorld");

export class GameWorld {
  readonly persistence: PersistenceBundle;
  readonly worldId = asWorldId("world-alpha");
  readonly runtime: WorldRuntimeState;
  private readonly sessions = new Map<string, PlayerSessionState>();
  private readonly pendingMessages = new Map<string, ServerMessage[]>();
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
        applyPersistedMapState(this.runtime.maps[mapSummary.id], persisted);
      } else {
        await this.persistence.maps.saveMapState(this.worldId, serializeMapState(this.runtime.maps[mapSummary.id], mapSummary));
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

    const synced = syncCompletedShipBuilds(player, Date.now());
    player = synced.player;
    if (synced.changed) {
      player.updatedAt = Date.now();
      await this.persistence.players.savePlayer(player);
    }

    const activeShip = resolveActiveShip(player);
    const map = this.runtime.maps[player.spawnPoint.mapId];
    map.players[playerId] = createRuntimeShip(playerId, activeShip, player);

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
    await this.saveAllMaps();
    this.sessions.delete(playerId);
    this.pendingMessages.delete(playerId);
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
    const now = Date.now();

    switch (parsed.type) {
      case "moveInput":
        this.applyMovementInput(player, parsed);
        this.sessions.get(playerId)!.lastInputTick = parsed.tick;
        return [];
      case "fireWeapon":
        this.fireWeapon(player, parsed, now);
        return [];
      case "activateModule":
        this.activateModule(player, parsed, now);
        return [];
      case "interact":
        return this.interact(playerId, parsed, now);
      case "changeMap":
        this.changeMap(playerId, parsed);
        return [];
      case "builderAction":
        return this.handleBuilderAction(playerId, parsed, now);
      default:
        return [];
    }
  }

  async tick(deltaMs = 1000 / 30): Promise<void> {
    this.tickCounter += 1;
    const deltaSeconds = deltaMs / 1000;
    const now = Date.now();

    for (const map of Object.values(this.runtime.maps)) {
      this.tickPlayers(map, deltaSeconds);
      this.tickProjectiles(map, deltaMs);
      this.tickEnemies(map, deltaSeconds);
      await this.collectDrops(map);
      tickFoundries(map, now, () => `enemy-${this.tickCounter}-${Math.random().toString(16).slice(2, 6)}`);
    }

    await this.processShipBuildCompletions(now);
  }

  drainPendingMessages(rawPlayerId: string): ServerMessage[] {
    const playerId = asPlayerId(rawPlayerId);
    const pending = this.pendingMessages.get(playerId) ?? [];
    this.pendingMessages.delete(playerId);
    return pending;
  }

  getSnapshot(rawPlayerId: string): SnapshotMessage {
    const playerId = asPlayerId(rawPlayerId);
    const map = this.getPlayerMap(playerId);
    const player = this.getPlayerShip(playerId);
    return createSnapshotMessage(
      this.tickCounter,
      playerId,
      player.mapId,
      map,
      player,
      this.isBuilderSiteNearby(playerId),
      isDeeperPathUnlocked(this.runtime.maps["map-root"])
    );
  }

  private tickPlayers(map: ActiveMapState, deltaSeconds: number): void {
    for (const player of Object.values(map.players)) {
      player.position.x += player.velocity.x * deltaSeconds;
      player.position.y += player.velocity.y * deltaSeconds;
      player.velocity.x *= 0.92;
      player.velocity.y *= 0.92;
    }
  }

  private tickProjectiles(map: ActiveMapState, deltaMs: number): void {
    for (const projectile of Object.values(map.projectiles)) {
      projectile.position.x += projectile.velocity.x * (deltaMs / 1000);
      projectile.position.y += projectile.velocity.y * (deltaMs / 1000);
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
          refreshFoundryEnemyCounts(map);
        }
        continue;
      }

      if (applyFoundryDamage(map, projectile.position, projectile.damage, this.tickCounter)) {
        delete map.projectiles[projectile.id];
        continue;
      }

      if (projectile.lifetimeMs <= 0) {
        delete map.projectiles[projectile.id];
      }
    }
  }

  private tickEnemies(map: ActiveMapState, deltaSeconds: number): void {
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
        const previousHull = nearestPlayer.hull;
        nearestPlayer.hull = Math.max(0, nearestPlayer.hull - 4);
        if (previousHull > 0 && nearestPlayer.hull === 0) {
          logger.info("Player ship destroyed", {
            playerId: nearestPlayer.playerId,
            mapId: nearestPlayer.mapId,
            enemyId: enemy.id,
            enemyTypeId: enemy.enemyTypeId,
            position: nearestPlayer.position
          });
        }
      }
    }
    refreshFoundryEnemyCounts(map);
  }

  private async collectDrops(map: ActiveMapState): Promise<void> {
    for (const [dropId, drop] of Object.entries(map.drops)) {
      const collector = Object.values(map.players).find((entry) => distance(entry.position, drop.position) < 16);
      if (!collector) {
        continue;
      }

      collector.inventory = addResourceMaps(collector.inventory, drop.resources);
      logger.verbose("Resource pickup", {
        playerId: collector.playerId,
        mapId: collector.mapId,
        dropId,
        pickedUp: drop.resources,
        updatedInventory: collector.inventory
      });
      delete map.drops[dropId];
      await this.syncRuntimeInventoryToPersistence(collector.playerId);
    }
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

  private applyMovementInput(player: ReturnType<GameWorld["getPlayerShip"]>, input: { thrustForward: boolean; thrustReverse: boolean; rotateLeft: boolean; rotateRight: boolean; aimWorld: { x: number; y: number } }): void {
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

  private fireWeapon(player: ReturnType<GameWorld["getPlayerShip"]>, message: FireWeaponMessage, now: number): void {
    const map = this.runtime.maps[player.mapId];
    applyWeaponFire(map, player, message, now, () => asEntityId(`projectile-${this.tickCounter}-${Math.random().toString(16).slice(2, 6)}`));
  }

  private activateModule(player: ReturnType<GameWorld["getPlayerShip"]>, message: ActivateModuleMessage, now: number): void {
    const map = this.runtime.maps[player.mapId];
    const activated = activateInstalledModule(map, player, message, now, this.tickCounter);
    if (activated) {
      void this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[map.id]));
    }
  }

  private async interact(playerId: ReturnType<typeof asPlayerId>, _message: InteractMessage, now: number): Promise<ServerMessage[]> {
    if (!this.isBuilderSiteNearby(playerId)) {
      return [];
    }

    const player = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!player) {
      return [];
    }

    const synced = syncCompletedShipBuilds(player, now).player;
    const hydrated = await this.syncPlayerSaveWithRuntime(playerId, synced);
    return [createBuilderState(hydrated, now)];
  }

  private changeMap(playerId: ReturnType<typeof asPlayerId>, message: ChangeMapMessage): void {
    const sourceMap = this.getPlayerMap(playerId);
    const player = sourceMap.players[playerId];
    const connection = sourceMap.connections.find((entry) => entry.id === message.connectionId);
    if (!connection?.destinationMapId) {
      return;
    }
    if (sourceMap.id === "map-root" && !isDeeperPathUnlocked(this.runtime.maps["map-root"])) {
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

  private async handleBuilderAction(playerId: ReturnType<typeof asPlayerId>, message: BuilderActionMessage, now: number): Promise<ServerMessage[]> {
    if (!this.isBuilderSiteNearby(playerId)) {
      if (message.action === "startShipBuild") {
        logger.warn("Ship build request rejected", {
          playerId,
          hullId: message.targetId,
          reason: "not_near_builder_site"
        });
      }
      return [];
    }

    let playerSave = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!playerSave) {
      if (message.action === "startShipBuild") {
        logger.warn("Ship build request rejected", {
          playerId,
          hullId: message.targetId,
          reason: "player_save_missing"
        });
      }
      return [];
    }

    playerSave = syncCompletedShipBuilds(playerSave, now).player;
    playerSave = await this.syncPlayerSaveWithRuntime(playerId, playerSave);
    const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    const runtimePlayer = runtimeMap?.players[playerId];
    let resourcesChanged = false;

    if (message.action === "craftModule") {
      const definition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      if (definition && hasEnoughResources(playerSave.resourceCounts, definition.buildCost)) {
        playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, definition.buildCost);
        playerSave.craftedModules = this.addCraftedModule(playerSave.craftedModules, definition.id, 1);
        resourcesChanged = true;
      }
    }

    if (message.action === "startShipBuild") {
      let hull;
      try {
        hull = getHullDefinition(message.targetId);
      } catch {
        logger.warn("Ship build request rejected", {
          playerId,
          hullId: message.targetId,
          reason: "unknown_hull"
        });
        playerSave.updatedAt = now;
        await this.persistence.players.savePlayer(playerSave);
        return [createBuilderState(playerSave, now)];
      }

      if (!hasEnoughResources(playerSave.resourceCounts, hull.buildCost)) {
        logger.warn("Ship build request rejected", {
          playerId,
          hullId: hull.id,
          reason: "insufficient_resources",
          required: hull.buildCost,
          available: playerSave.resourceCounts
        });
      } else {
        playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, hull.buildCost);
        resourcesChanged = true;
        const builtShipId = asShipId(`ship-${message.targetId}-${Date.now()}`);
        const buildCompleteAt = hull.buildTimeMs > 0 ? now + hull.buildTimeMs : null;
        playerSave.shipStable[builtShipId] = {
          id: builtShipId,
          name: hull.name,
          hullId: hull.id,
          modules: [],
          hullIntegrity: hull.baseHull,
          status: hull.buildTimeMs > 0 ? "building" : "ready",
          buildStartedAt: now,
          buildCompleteAt
        };
        logger.info("Ship build request accepted", {
          playerId,
          hullId: hull.id,
          shipId: builtShipId,
          status: playerSave.shipStable[builtShipId].status,
          buildCompleteAt
        });
      }
    }

    if (message.action === "swapShip" && playerSave.shipStable[message.targetId] && playerSave.shipStable[message.targetId].status === "ready") {
      const currentShip = playerSave.shipStable[playerSave.activeShipId];
      if (currentShip) {
        currentShip.status = "ready";
      }
      playerSave.activeShipId = asShipId(message.targetId);
      playerSave.shipStable[message.targetId].status = "active";
      const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
      if (runtimeMap) {
        syncRuntimeShipFromSave(runtimeMap.players[playerId], playerSave);
      }
    }

    if (message.action === "installModule" && message.shipId && message.hardpointId) {
      const ship = playerSave.shipStable[message.shipId];
      const hull = ship ? getHullDefinition(ship.hullId) : null;
      const moduleDefinition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      const hardpoint = hull?.hardpoints.find((entry) => entry.id === message.hardpointId);
      const availableModule = playerSave.craftedModules.find((entry) => entry.moduleId === message.targetId && entry.quantity > 0);
      if (ship && ship.status !== "building" && hull && moduleDefinition && hardpoint && availableModule && hardpoint.type === moduleDefinition.slotType) {
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
        const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
        if (runtimeMap && ship.id === playerSave.activeShipId) {
          syncRuntimeShipFromSave(runtimeMap.players[playerId], playerSave);
        }
      }
    }

    if (message.action === "removeModule" && message.shipId && message.hardpointId) {
      const ship = playerSave.shipStable[message.shipId];
      if (ship && ship.status !== "building") {
        const existingModule = ship.modules.find((entry) => entry.hardpointId === message.hardpointId);
        if (existingModule) {
          ship.modules = ship.modules.filter((entry) => entry.hardpointId !== message.hardpointId);
          playerSave.craftedModules = this.addCraftedModule(playerSave.craftedModules, existingModule.moduleId, 1);
          const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
          if (runtimeMap && ship.id === playerSave.activeShipId) {
            syncRuntimeShipFromSave(runtimeMap.players[playerId], playerSave);
          }
        }
      }
    }

    if (resourcesChanged && runtimePlayer) {
      syncRuntimeInventoryFromSave(runtimePlayer, playerSave);
    }

    playerSave.updatedAt = now;
    await this.persistence.players.savePlayer(playerSave);
    return [createBuilderState(playerSave, now)];
  }

  private async syncPlayerSaveWithRuntime(playerId: ReturnType<typeof asPlayerId>, playerSave: PlayerSave): Promise<PlayerSave> {
    const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    const runtimePlayer = runtimeMap?.players[playerId];
    if (!runtimePlayer) {
      return playerSave;
    }

    const synced = syncPlayerSaveFromRuntime(runtimePlayer, playerSave);
    logger.veryVerbose("Hydrated player save from runtime", {
      playerId,
      mapId: runtimePlayer.mapId,
      resourceCounts: synced.resourceCounts,
      activeShipId: synced.activeShipId
    });
    return synced;
  }

  private async syncRuntimeInventoryToPersistence(playerId: ReturnType<typeof asPlayerId>): Promise<void> {
    const playerSave = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!playerSave) {
      return;
    }

    const synced = await this.syncPlayerSaveWithRuntime(playerId, playerSave);
    synced.updatedAt = Date.now();
    await this.persistence.players.savePlayer(synced);
    logger.veryVerbose("Persisted runtime inventory", {
      playerId,
      resourceCounts: synced.resourceCounts,
      updatedAt: synced.updatedAt
    });
  }

  private isBuilderSiteNearby(playerId: ReturnType<typeof asPlayerId>): boolean {
    const map = this.getPlayerMap(playerId);
    const player = map.players[playerId];
    return Object.values(map.structures).some(
      (structure) => structure.structureTypeId === "builder-site" && distance(structure.position, player.position) < 48
    );
  }

  private addCraftedModule(stacks: PlayerSave["craftedModules"], moduleId: string, quantity: number): PlayerSave["craftedModules"] {
    const nextStacks = stacks.map((entry) => ({ ...entry }));
    const existing = nextStacks.find((entry) => entry.moduleId === moduleId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      nextStacks.push({ moduleId, quantity });
    }
    return nextStacks.filter((entry) => entry.quantity > 0);
  }

  private removeCraftedModule(stacks: PlayerSave["craftedModules"], moduleId: string, quantity: number): PlayerSave["craftedModules"] {
    return stacks
      .map((entry) => (entry.moduleId === moduleId ? { ...entry, quantity: entry.quantity - quantity } : { ...entry }))
      .filter((entry) => entry.quantity > 0);
  }

  private async processShipBuildCompletions(now: number): Promise<void> {
    for (const session of this.sessions.values()) {
      const player = await this.persistence.players.getPlayer(this.worldId, session.playerId);
      if (!player) {
        continue;
      }
      const synced = syncCompletedShipBuilds(player, now);
      if (synced.changed) {
        synced.player.updatedAt = now;
        await this.persistence.players.savePlayer(synced.player);
        for (const ship of synced.completedShips) {
          this.queueMessage(session.playerId, {
            type: "shipBuildCompleted",
            serverTime: now,
            shipId: ship.id,
            shipName: ship.name,
            hullId: ship.hullId
          });
        }
      }
    }
  }

  private queueMessage(playerId: ReturnType<typeof asPlayerId>, message: ServerMessage): void {
    const existing = this.pendingMessages.get(playerId) ?? [];
    existing.push(message);
    this.pendingMessages.set(playerId, existing);
  }

  private async saveAllMaps(): Promise<void> {
    for (const [mapId, map] of Object.entries(this.runtime.maps)) {
      await this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[mapId]));
      for (const chunk of Object.values(map.chunks)) {
        chunk.dirty = false;
      }
    }
  }
}

