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
import { findNearestValidPosition, findTerrainImpactAlongPath, getEnemyCollisionRadius, getPlayerShipCollisionRadius, resolveMovement } from "./collision.js";
import { applyPersistedMapState, serializeMapState } from "./mapPersistence.js";
import { activateInstalledModule, applyWeaponFire } from "./moduleActions.js";
import { createLogger } from "../logger.js";
import { damageTerrainAt } from "./terrain.js";
import { buildPlayerVisibilityView, findNearestVisiblePlayer } from "./visibility.js";
import { createBuilderState, createRuntimeShip, resolveActiveShip, syncCompletedShipBuilds, syncPlayerSaveFromRuntime, syncRuntimeInventoryFromSave, syncRuntimeShipFromSave } from "./shipLifecycle.js";

interface PlayerSessionState {
  // Branded player id used for runtime maps and persistence lookups.
  playerId: ReturnType<typeof asPlayerId>;
  // Connection timestamp used for diagnostics and future session aging.
  connectedAt: number;
  // Last client input tick processed for this session.
  lastInputTick: number;
  // Per-session terrain memory that is written back to the player save on disconnect.
  terrainMemoryByMap: PlayerSave["terrainMemoryByMap"];
}

const logger = createLogger("gameWorld");
// Rotation and thrust constants tune the prototype ship movement model.
const rotationStep = 0.1;
const forwardThrust = 80;
const reverseThrust = 40;

export class GameWorld {
  // persistence owns all durable repositories used by the authoritative simulation.
  readonly persistence: PersistenceBundle;
  // worldId scopes saves/maps for the current prototype world.
  readonly worldId = asWorldId("world-alpha");
  // runtime holds in-memory active maps, entities, drops, projectiles, and players.
  readonly runtime: WorldRuntimeState;
  // sessions track connected players and per-session visibility memory.
  private readonly sessions = new Map<string, PlayerSessionState>();
  // pendingMessages stores one-off server messages until GameServer flushes them to sockets.
  private readonly pendingMessages = new Map<string, ServerMessage[]>();
  // feedbackTimestamps throttle repeated action feedback by player and feedback code.
  private readonly feedbackTimestamps = new Map<string, Map<string, number>>();
  // tickCounter gives snapshots and generated entity ids a monotonic runtime counter.
  private tickCounter = 0;
  // persistentWorld stores graph/map summary metadata alongside active runtime maps.
  private persistentWorld: PersistentWorld = createWorldGraph(this.worldId);

  // Creates an authoritative game world with injected persistence for tests or alternate storage.
  constructor(persistence: PersistenceBundle = createInMemoryPersistence()) {
    this.persistence = persistence;
    this.runtime = createRuntimeState();
  }

  // Loads or seeds world/map persistence before clients connect.
  async initialize(): Promise<void> {
    // Load the persistent graph first because map persistence needs the map summaries inside it.
    const storedWorld = await this.persistence.worlds.getWorld(this.worldId);
    this.persistentWorld = storedWorld ?? createWorldGraph(this.worldId);
    if (!storedWorld) {
      await this.persistence.worlds.saveWorld(this.persistentWorld);
    }

    // Hydrate every known map from storage or save the fresh runtime template on first boot.
    for (const mapSummary of Object.values(this.persistentWorld.maps)) {
      const persisted = await this.persistence.maps.getMapState(this.worldId, mapSummary.id);
      if (persisted) {
        applyPersistedMapState(this.runtime.maps[mapSummary.id], persisted);
      } else {
        await this.persistence.maps.saveMapState(this.worldId, serializeMapState(this.runtime.maps[mapSummary.id], mapSummary));
      }
    }
  }

  // Connects a player, loading their save into the active runtime map and creating one if needed.
  async connectPlayer(rawPlayerId: string): Promise<PlayerSave> {
    // Player saves are keyed by branded ids under the current world id.
    const playerId = asPlayerId(rawPlayerId);
    let player = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!player) {
      player = createDefaultPlayerSave(this.worldId, playerId);
      await this.persistence.players.savePlayer(player);
    }

    player.terrainMemoryByMap ??= {};

    // Finish any offline ship builds before the player sees builder state or active ship data.
    const synced = syncCompletedShipBuilds(player, Date.now());
    player = synced.player;
    if (synced.changed) {
      player.updatedAt = Date.now();
      await this.persistence.players.savePlayer(player);
    }

    // Create the live ship and nudge it to a valid position if the saved spawn is now blocked.
    const activeShip = resolveActiveShip(player);
    const map = this.runtime.maps[player.spawnPoint.mapId];
    const runtimeShip = createRuntimeShip(playerId, activeShip, player);
    runtimeShip.position = findNearestValidPosition(map, runtimeShip.position, getPlayerShipCollisionRadius(runtimeShip), {
      includePlayers: true,
      includeEnemies: true
    });
    map.players[playerId] = runtimeShip;

    // Session state intentionally clones terrain memory so visibility updates stay local until save time.
    this.sessions.set(playerId, {
      playerId,
      connectedAt: Date.now(),
      lastInputTick: 0,
      terrainMemoryByMap: structuredClone(player.terrainMemoryByMap)
    });

    return player;
  }

  // Disconnects a player, persists their live ship/session state, and removes runtime references.
  async disconnectPlayer(rawPlayerId: string): Promise<void> {
    // Find the player's live map because they may have changed maps since their save was loaded.
    const playerId = asPlayerId(rawPlayerId);
    const player = await this.persistence.players.getPlayer(this.worldId, playerId);
    const map = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    if (player && map) {
      // Copy active runtime ship state back into the player's durable save before deleting it.
      const ship = map.players[playerId];
      const session = this.sessions.get(playerId);
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
        terrainMemoryByMap: structuredClone(session?.terrainMemoryByMap ?? player.terrainMemoryByMap ?? {}),
        updatedAt: Date.now()
      });
      delete map.players[playerId];
    }
    // Map state is saved on disconnect so terrain/foundry/objective changes survive process restarts.
    await this.saveAllMaps();
    this.sessions.delete(playerId);
    this.pendingMessages.delete(playerId);
    this.feedbackTimestamps.delete(playerId);
  }

  // Parses and routes one client message through the authoritative server-side handler.
  async handleMessage(rawPlayerId: string, message: unknown): Promise<ServerMessage[]> {
    // Shared schema parsing rejects malformed client payloads at the server boundary.
    const parsed = clientMessageSchema.parse(message);
    const playerId = asPlayerId(rawPlayerId);

    // A duplicate joinWorld is treated as idempotent and does not emit extra responses.
    if (parsed.type === "joinWorld") {
      const connected = Object.values(this.runtime.maps).some((map) => !!map.players[playerId]);
      if (!connected) {
        await this.connectPlayer(playerId);
      }
      return [];
    }

    // All gameplay messages require an already-connected runtime ship.
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

  // Advances all active maps by one simulation frame.
  async tick(deltaMs = 1000 / 30): Promise<void> {
    // deltaSeconds is used by velocity integration while deltaMs is used by timers/lifetimes.
    this.tickCounter += 1;
    const deltaSeconds = deltaMs / 1000;
    const now = Date.now();

    // Each map ticks independently so future active maps can simulate at the same cadence.
    for (const map of Object.values(this.runtime.maps)) {
      this.tickPlayers(map, deltaSeconds);
      this.tickProjectiles(map, deltaMs);
      this.tickEnemies(map, deltaSeconds);
      await this.collectDrops(map);
      tickFoundries(map, now, () => `enemy-${this.tickCounter}-${Math.random().toString(16).slice(2, 6)}`);
    }

    // Build completions are checked after map simulation so player notifications are queued once per tick.
    await this.processShipBuildCompletions(now);
  }

  // Returns and clears queued one-off messages for a player.
  drainPendingMessages(rawPlayerId: string): ServerMessage[] {
    const playerId = asPlayerId(rawPlayerId);
    const pending = this.pendingMessages.get(playerId) ?? [];
    this.pendingMessages.delete(playerId);
    return pending;
  }

  // Builds the current snapshot for one player, filtered through that player's visibility memory.
  getSnapshot(rawPlayerId: string): SnapshotMessage {
    const playerId = asPlayerId(rawPlayerId);
    const map = this.getPlayerMap(playerId);
    const player = this.getPlayerShip(playerId);
    const session = this.sessions.get(playerId);
    if (!session) {
      throw new Error(`Player ${playerId} is missing a session state.`);
    }

    // Visibility shaping hides unknown terrain/entities while preserving remembered terrain cells.
    const visibility = buildPlayerVisibilityView(map, player, session.terrainMemoryByMap);
    return createSnapshotMessage(
      this.tickCounter,
      playerId,
      player.mapId,
      map,
      player,
      this.isBuilderSiteNearby(playerId),
      isDeeperPathUnlocked(this.runtime.maps["map-root"]),
      {
        players: visibility.players,
        enemies: visibility.enemies,
        projectiles: visibility.projectiles,
        structures: visibility.structures,
        foundries: visibility.foundries,
        drops: visibility.drops,
        chunks: visibility.chunks
      }
    );
  }

  // Integrates player ship movement and applies simple drag after collision resolution.
  private tickPlayers(map: ActiveMapState, deltaSeconds: number): void {
    for (const player of Object.values(map.players)) {
      // Resolve against terrain, structures, players, and enemies so ships cannot overlap blockers.
      const resolved = resolveMovement(map, player.position, player.velocity, deltaSeconds, {
        radius: getPlayerShipCollisionRadius(player),
        excludeEntityId: player.id,
        includePlayers: true,
        includeEnemies: true
      });
      player.position = resolved.position;
      player.velocity = resolved.velocity;
      player.velocity.x *= 0.92;
      player.velocity.y *= 0.92;
    }
  }

  // Advances projectiles, applies impact damage, creates drops, and removes expired projectiles.
  private tickProjectiles(map: ActiveMapState, deltaMs: number): void {
    for (const projectile of Object.values(map.projectiles)) {
      // Move first, then sample the previous-to-current path for terrain collision.
      const previousPosition = { ...projectile.position };
      projectile.position.x += projectile.velocity.x * (deltaMs / 1000);
      projectile.position.y += projectile.velocity.y * (deltaMs / 1000);
      projectile.lifetimeMs -= deltaMs;

      const terrainImpact = findTerrainImpactAlongPath(map, previousPosition, projectile.position, 2);
      if (terrainImpact) {
        // Terrain destruction is persisted immediately so mined walls survive later reconnects.
        projectile.position = terrainImpact;
        const terrainDamage = damageTerrainAt(map, terrainImpact, projectile.damage, this.tickCounter, 0.75);
        if (terrainDamage.destroyed) {
          void this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[map.id]));
        }
        delete map.projectiles[projectile.id];
        continue;
      }

      // Enemy impacts create salvage drops and refresh foundry spawn counts after kills.
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

      // Foundry hits may unlock the deeper path and broadcast objective feedback to the whole map.
      const foundryDamage = applyFoundryDamage(map, projectile.position, projectile.damage, this.tickCounter);
      if (foundryDamage.hit) {
        if (foundryDamage.destroyedFoundry) {
          const unlocked = map.id === "map-root" && isDeeperPathUnlocked(this.runtime.maps["map-root"]);
          this.queueMapFeedback(
            map.id,
            unlocked ? "deeper_path_unlocked" : "foundry_destroyed",
            unlocked ? "Deeper Path Unlocked" : "Foundry Destroyed",
            unlocked
              ? "The root foundry is down. The deeper route is now open."
              : "Enemy production has been disrupted in this sector.",
            "info",
            true
          );
          void this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[map.id]));
        }
        delete map.projectiles[projectile.id];
        continue;
      }

      // Lifetime cleanup prevents old projectiles from accumulating in runtime state.
      if (projectile.lifetimeMs <= 0) {
        delete map.projectiles[projectile.id];
      }
    }
  }

  // Updates enemy AI by chasing the nearest visible player and applying contact damage.
  private tickEnemies(map: ActiveMapState, deltaSeconds: number): void {
    for (const enemy of Object.values(map.enemies)) {
      // Enemy vision uses the same terrain line-of-sight rules as player snapshots.
      const nearestPlayer = findNearestVisiblePlayer(map, enemy);
      if (!nearestPlayer) {
        enemy.aiState = "idle";
        enemy.velocity = { x: 0, y: 0 };
        continue;
      }

      // Chasing enemies steer directly toward the current target using content-defined speed.
      enemy.aiState = "chasing";
      const direction = normalize({
        x: nearestPlayer.position.x - enemy.position.x,
        y: nearestPlayer.position.y - enemy.position.y
      });
      enemy.rotation = Math.atan2(direction.y, direction.x);
      const enemyDefinition = enemyDefinitions.find((entry) => entry.id === enemy.enemyTypeId);
      enemy.velocity = scaleVec2(direction, enemyDefinition?.speed ?? 20);
      const resolved = resolveMovement(map, enemy.position, enemy.velocity, deltaSeconds, {
        radius: getEnemyCollisionRadius(enemy),
        excludeEntityId: enemy.id,
        includePlayers: true,
        includeEnemies: true
      });
      enemy.position = resolved.position;
      enemy.velocity = resolved.velocity;

      // Contact damage is intentionally simple for the current vertical slice.
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

  // Transfers nearby resource drops into player runtime inventory and persists the new totals.
  private async collectDrops(map: ActiveMapState): Promise<void> {
    for (const [dropId, drop] of Object.entries(map.drops)) {
      const collector = Object.values(map.players).find((entry) => distance(entry.position, drop.position) < 16);
      if (!collector) {
        continue;
      }

      // Runtime inventory is the source of truth while connected, then synced back into persistence.
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

  // Finds the active runtime map containing a connected player.
  private getPlayerMap(playerId: ReturnType<typeof asPlayerId>) {
    const map = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    if (!map) {
      throw new Error(`Player ${playerId} is not in an active map.`);
    }
    return map;
  }

  // Returns the connected player's live ship from its active runtime map.
  private getPlayerShip(playerId: ReturnType<typeof asPlayerId>) {
    const map = this.getPlayerMap(playerId);
    return map.players[playerId];
  }

  // Applies raw movement input by rotating the ship and adding thrust along its current facing.
  private applyMovementInput(player: ReturnType<GameWorld["getPlayerShip"]>, input: { thrustForward: boolean; thrustReverse: boolean; rotateLeft: boolean; rotateRight: boolean }): void {
    if (input.rotateLeft) {
      player.rotation -= rotationStep;
    }
    if (input.rotateRight) {
      player.rotation += rotationStep;
    }

    // Thrust is integrated at the prototype target tick rate to keep input handling simple.
    const thrust = input.thrustForward ? forwardThrust : input.thrustReverse ? -reverseThrust : 0;
    if (thrust === 0) {
      return;
    }

    const forward = {
      x: Math.cos(player.rotation),
      y: Math.sin(player.rotation)
    };
    player.velocity.x += forward.x * thrust * (1 / 30);
    player.velocity.y += forward.y * thrust * (1 / 30);
  }

  // Handles weapon fire and queues feedback for non-cooldown failures.
  private fireWeapon(player: ReturnType<GameWorld["getPlayerShip"]>, message: FireWeaponMessage, now: number): void {
    const map = this.runtime.maps[player.mapId];
    const result = applyWeaponFire(map, player, message, now, () => asEntityId(`projectile-${this.tickCounter}-${Math.random().toString(16).slice(2, 6)}`));
    if (!result.ok && result.code !== "weapon_on_cooldown") {
      this.queueAttemptFailure(player.playerId, result.code, now);
    }
  }

  // Handles module activation and persists map changes caused by successful actions.
  private activateModule(player: ReturnType<GameWorld["getPlayerShip"]>, message: ActivateModuleMessage, now: number): void {
    const map = this.runtime.maps[player.mapId];
    const result = activateInstalledModule(map, player, message, now, this.tickCounter);
    if (result.ok) {
      void this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[map.id]));
      return;
    }

    if (result.code !== "module_on_cooldown") {
      this.queueAttemptFailure(player.playerId, result.code, now);
    }
  }

  // Returns builder state when the player interacts near a builder site.
  private async interact(playerId: ReturnType<typeof asPlayerId>, _message: InteractMessage, now: number): Promise<ServerMessage[]> {
    if (!this.isBuilderSiteNearby(playerId)) {
      return [];
    }

    const player = await this.persistence.players.getPlayer(this.worldId, playerId);
    if (!player) {
      return [];
    }

    // Sync runtime ship/inventory into the save before sending builder data to the client.
    const synced = syncCompletedShipBuilds(player, now).player;
    const hydrated = await this.syncPlayerSaveWithRuntime(playerId, synced);
    return [createBuilderState(hydrated, now)];
  }

  // Moves a player through a map connection when progression gates allow the route.
  private changeMap(playerId: ReturnType<typeof asPlayerId>, message: ChangeMapMessage): void {
    const sourceMap = this.getPlayerMap(playerId);
    const player = sourceMap.players[playerId];
    const connection = sourceMap.connections.find((entry) => entry.id === message.connectionId);
    if (!connection?.destinationMapId) {
      this.queueActionFeedback(playerId, "map_connection_missing", "Route Unavailable", "That navigation route is no longer available.", "warning", Date.now(), 1200);
      return;
    }
    if (sourceMap.id === "map-root" && !isDeeperPathUnlocked(this.runtime.maps["map-root"])) {
      this.queueActionFeedback(playerId, "deeper_path_locked", "Path Locked", "Destroy the root foundry to unlock the deeper route.", "info", Date.now(), 1500);
      return;
    }
    // Transfer the same runtime ship object so hull, modules, inventory, and cooldowns remain intact.
    const destinationMap = this.runtime.maps[connection.destinationMapId];
    delete sourceMap.players[playerId];
    player.mapId = connection.destinationMapId;
    player.position = findNearestValidPosition(
      destinationMap,
      {
        x: (connection.destinationAnchor?.x ?? 1) * 32,
        y: (connection.destinationAnchor?.y ?? 1) * 32
      },
      getPlayerShipCollisionRadius(player),
      {
        includePlayers: true,
        includeEnemies: true
      }
    );
    player.velocity = { x: 0, y: 0 };
    destinationMap.players[playerId] = player;
  }

  // Handles all builder UI actions that mutate saved ships, resources, modules, or active ship state.
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

    // Load the persisted player, then hydrate it from runtime so recent pickups/modules are included.
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
    // resourcesChanged tells us whether the live connected ship inventory needs to mirror save changes.
    let resourcesChanged = false;

    if (message.action === "craftModule") {
      // Crafting spends resources and adds one module stack when the player can afford the recipe.
      const definition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      if (definition && hasEnoughResources(playerSave.resourceCounts, definition.buildCost)) {
        playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, definition.buildCost);
        playerSave.craftedModules = this.addCraftedModule(playerSave.craftedModules, definition.id, 1);
        resourcesChanged = true;
      }
    }

    if (message.action === "startShipBuild") {
      // Starting a build validates the hull id, spends resources, and creates a stable entry.
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
        // Built ship ids include hull and timestamp so repeated builds remain unique.
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
      // Swapping makes the old active ship ready and pushes the new active ship into runtime immediately.
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
      // Installation validates ship status, hardpoint type, module inventory, and slot compatibility.
      const ship = playerSave.shipStable[message.shipId];
      const hull = ship ? getHullDefinition(ship.hullId) : null;
      const moduleDefinition = moduleDefinitions.find((entry) => entry.id === message.targetId);
      const hardpoint = hull?.hardpoints.find((entry) => entry.id === message.hardpointId);
      const availableModule = playerSave.craftedModules.find((entry) => entry.moduleId === message.targetId && entry.quantity > 0);
      if (ship && ship.status !== "building" && hull && moduleDefinition && hardpoint && availableModule && hardpoint.type === moduleDefinition.slotType) {
        const existingModule = ship.modules.find((entry) => entry.hardpointId === message.hardpointId);
        if (existingModule) {
          // Replacing a module returns the previous module to crafted inventory before installing the new one.
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
      // Removal returns the installed module to crafted inventory and syncs runtime if this is the active ship.
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
      // Keep connected runtime inventory aligned with builder save changes before the next snapshot.
      syncRuntimeInventoryFromSave(runtimePlayer, playerSave);
    }

    playerSave.updatedAt = now;
    await this.persistence.players.savePlayer(playerSave);
    return [createBuilderState(playerSave, now)];
  }

  // Hydrates the saved player record with connected runtime ship, inventory, position, and terrain memory.
  private async syncPlayerSaveWithRuntime(playerId: ReturnType<typeof asPlayerId>, playerSave: PlayerSave): Promise<PlayerSave> {
    const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
    const runtimePlayer = runtimeMap?.players[playerId];
    if (!runtimePlayer) {
      return playerSave;
    }

    const synced = syncPlayerSaveFromRuntime(runtimePlayer, playerSave);
    synced.terrainMemoryByMap = structuredClone(this.sessions.get(playerId)?.terrainMemoryByMap ?? synced.terrainMemoryByMap ?? {});
    logger.veryVerbose("Hydrated player save from runtime", {
      playerId,
      mapId: runtimePlayer.mapId,
      resourceCounts: synced.resourceCounts,
      activeShipId: synced.activeShipId
    });
    return synced;
  }

  // Persists runtime inventory/resource state for a connected player after pickup collection.
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

  // Checks whether a connected player is close enough to use the builder site.
  private isBuilderSiteNearby(playerId: ReturnType<typeof asPlayerId>): boolean {
    const map = this.getPlayerMap(playerId);
    const player = map.players[playerId];
    return Object.values(map.structures).some(
      (structure) => structure.structureTypeId === "builder-site" && distance(structure.position, player.position) < 48
    );
  }

  // Adds quantity to a crafted module stack and removes any empty stacks from the returned list.
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

  // Removes quantity from a crafted module stack and drops empty stacks from the returned list.
  private removeCraftedModule(stacks: PlayerSave["craftedModules"], moduleId: string, quantity: number): PlayerSave["craftedModules"] {
    return stacks
      .map((entry) => (entry.moduleId === moduleId ? { ...entry, quantity: entry.quantity - quantity } : { ...entry }))
      .filter((entry) => entry.quantity > 0);
  }

  // Checks connected players for newly completed ship builds and queues completion messages.
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

  // Appends a one-off server message to the player's pending outbound queue.
  private queueMessage(playerId: ReturnType<typeof asPlayerId>, message: ServerMessage): void {
    const existing = this.pendingMessages.get(playerId) ?? [];
    existing.push(message);
    this.pendingMessages.set(playerId, existing);
  }

  // Queues throttled player-facing action feedback for rejected or informational actions.
  private queueActionFeedback(
    playerId: ReturnType<typeof asPlayerId>,
    code: string,
    title: string,
    detail: string,
    level: "info" | "warning",
    now: number,
    throttleMs = 1200,
    force = false
  ): void {
    // The timestamp map prevents the same warning from spamming the client every tick/input repeat.
    const timestamps = this.feedbackTimestamps.get(playerId) ?? new Map<string, number>();
    const lastSentAt = timestamps.get(code) ?? 0;
    if (!force && now - lastSentAt < throttleMs) {
      this.feedbackTimestamps.set(playerId, timestamps);
      return;
    }

    timestamps.set(code, now);
    this.feedbackTimestamps.set(playerId, timestamps);
    this.queueMessage(playerId, {
      type: "actionFeedback",
      serverTime: now,
      level,
      code,
      title,
      detail
    });
  }

  // Broadcasts the same action feedback to every player currently on a map.
  private queueMapFeedback(
    mapId: string,
    code: string,
    title: string,
    detail: string,
    level: "info" | "warning",
    force = false
  ): void {
    const map = this.runtime.maps[mapId];
    if (!map) {
      return;
    }

    const now = Date.now();
    for (const player of Object.values(map.players)) {
      this.queueActionFeedback(player.playerId, code, title, detail, level, now, 1200, force);
    }
  }

  // Converts internal action failure codes into localized-enough prototype UI feedback.
  private queueAttemptFailure(playerId: ReturnType<typeof asPlayerId>, code: string, now: number): void {
    switch (code) {
      case "weapon_not_installed":
        this.queueActionFeedback(playerId, code, "Weapon Offline", "No weapon is installed on the selected hardpoint.", "warning", now);
        return;
      case "weapon_capability_missing":
        this.queueActionFeedback(playerId, code, "Weapon Offline", "The selected hardpoint is not carrying a weapon-capable module.", "warning", now);
        return;
      case "weapon_definition_missing":
        this.queueActionFeedback(playerId, code, "Weapon Data Missing", "The selected weapon module is missing its weapon profile.", "warning", now);
        return;
      case "module_not_installed":
        this.queueActionFeedback(playerId, code, "Module Offline", "That module is not installed on your active ship.", "warning", now);
        return;
      case "mining_target_missing":
        this.queueActionFeedback(playerId, code, "Mining Target Missing", "Aim at a terrain tile to fire the mining laser.", "warning", now);
        return;
      case "mining_target_out_of_range":
        this.queueActionFeedback(playerId, code, "Mining Out of Range", "Move closer before attempting to mine that tile.", "warning", now);
        return;
      case "no_terrain_to_mine":
        this.queueActionFeedback(playerId, code, "No Ore Here", "That tile is already clear. Aim at intact terrain to mine resources.", "info", now);
        return;
      case "support_target_missing":
        this.queueActionFeedback(playerId, code, "Repair Target Missing", "Pick a valid allied ship or yourself before activating the repair beam.", "warning", now);
        return;
      case "support_target_out_of_range":
        this.queueActionFeedback(playerId, code, "Repair Out of Range", "Move closer to your ally before firing the repair beam.", "warning", now);
        return;
      case "support_self_target_forbidden":
        this.queueActionFeedback(playerId, code, "Repair Denied", "That support module cannot target your own ship.", "warning", now);
        return;
      case "support_target_full_hull":
        this.queueActionFeedback(playerId, code, "Hull Stable", "That ship is already at full hull integrity.", "info", now);
        return;
      case "module_capability_missing":
        this.queueActionFeedback(playerId, code, "Module Offline", "The selected module cannot perform that action.", "warning", now);
        return;
      default:
        this.queueActionFeedback(playerId, code, "Action Rejected", "The requested action could not be completed.", "warning", now);
        return;
    }
  }

  // Persists all active maps and clears dirty chunk markers after successful writes.
  private async saveAllMaps(): Promise<void> {
    for (const [mapId, map] of Object.entries(this.runtime.maps)) {
      await this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[mapId]));
      for (const chunk of Object.values(map.chunks)) {
        chunk.dirty = false;
      }
    }
  }
}
