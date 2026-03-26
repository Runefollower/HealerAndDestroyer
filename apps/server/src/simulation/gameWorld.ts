import { enemyDefinitions, getHullDefinition, moduleDefinitions, weaponDefinitions } from "@healer/content";
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
  type BuilderActionMessage,
  type ChangeMapMessage,
  type FireWeaponMessage,
  type InteractMessage,
  type MoveInputMessage,
  type PlayerSave,
  type ServerMessage,
  type SnapshotMessage,
  type WorldRuntimeState
} from "@healer/shared";
import { createDefaultPlayerSave, createRuntimeState, createWorldGraph } from "./createWorld.js";

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

  constructor(persistence: PersistenceBundle = createInMemoryPersistence()) {
    this.persistence = persistence;
    this.runtime = createRuntimeState();
  }

  async initialize(): Promise<void> {
    await this.persistence.worlds.saveWorld(createWorldGraph(this.worldId));
  }

  async connectPlayer(rawPlayerId: string): Promise<PlayerSave> {
    const playerId = asPlayerId(rawPlayerId);
    let player = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!player) {
      player = createDefaultPlayerSave(this.worldId, playerId);
      await this.persistence.players.savePlayer(player);
    }

    const activeShip = player.shipStable[player.activeShipId];
    const map = this.runtime.maps[player.spawnPoint.mapId];
    map.players[playerId] = {
      id: asEntityId(`entity-${player.activeShipId}`),
      playerId,
      shipId: player.activeShipId,
      mapId: player.spawnPoint.mapId,
      position: { ...player.spawnPoint.position },
      velocity: { x: 0, y: 0 },
      rotation: 0,
      angularVelocity: 0,
      hull: activeShip.hullIntegrity,
      maxHull: getHullDefinition(activeShip.hullId).baseHull,
      power: 30,
      maxPower: getHullDefinition(activeShip.hullId).powerCapacity,
      modules: activeShip.modules,
      inventory: { ...player.resourceCounts }
    };

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
        } else if (projectile.lifetimeMs <= 0) {
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

  private applyMovementInput(player: ReturnType<GameWorld["getPlayerShip"]>, input: MoveInputMessage): void {
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

  private fireWeapon(player: ReturnType<GameWorld["getPlayerShip"]>, message: FireWeaponMessage): void {
    const map = this.runtime.maps[player.mapId];
    const weapon = weaponDefinitions.find((entry) => entry.id === message.weaponHardpointId || entry.id === "pulse-cannon") ?? weaponDefinitions[0];
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

    return [
      {
        type: "builderState",
        availableShips: player.shipStable
      }
    ];
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

    const playerSave = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!playerSave) {
      return [];
    }

    if (message.action === "craftModule") {
      const definition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      if (definition && hasEnoughResources(playerSave.resourceCounts, definition.buildCost)) {
        playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, definition.buildCost);
        playerSave.updatedAt = Date.now();
        await this.persistence.players.savePlayer(playerSave);
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
          status: "building",
          buildCompleteAt: Date.now() + hull.buildTimeMs
        };
        playerSave.updatedAt = Date.now();
        await this.persistence.players.savePlayer(playerSave);
      }
    }

    if (message.action === "swapShip" && playerSave.shipStable[message.targetId]) {
      playerSave.activeShipId = asShipId(message.targetId);
      playerSave.updatedAt = Date.now();
      await this.persistence.players.savePlayer(playerSave);
    }

    return [
      {
        type: "builderState",
        availableShips: playerSave.shipStable
      }
    ];
  }

  private isBuilderSiteNearby(playerId: ReturnType<typeof asPlayerId>): boolean {
    const map = this.getPlayerMap(playerId);
    const player = map.players[playerId];
    return Object.values(map.structures).some(
      (structure) => structure.structureTypeId === "builder-site" && distance(structure.position, player.position) < 48
    );
  }
}

