import { getHullDefinition, moduleDefinitions } from "@healer/content";
import { createInMemoryPersistence, type PersistenceBundle } from "@healer/persistence";
import {
  addResourceMaps,
  asEntityId,
  asPlayerId,
  asShipId,
  asWorldId,
  applyPlayerMovementInput,
  clientMessageSchema,
  createSnapshotMessage,
  distance,
  hasEnoughResources,
  PLAYER_MOVEMENT_INPUT_RATE_HZ,
  PLAYER_VELOCITY_RETENTION,
  subtractResourceMaps,
  type ActivateModuleMessage,
  type PlayerMovementInput,
  type ActiveMapState,
  type BuilderActionMessage,
  type ChangeMapMessage,
  type ExitSnapshot,
  type MapConnection,
  type FireWeaponMessage,
  type InstalledModule,
  type InteractMessage,
  type PersistentWorld,
  type PlayerSave,
  type ResourceMap,
  type ServerMessage,
  type SnapshotMessage,
  type StoredShip,
  type WorldRuntimeState
} from "@healer/shared";
import { createDefaultPlayerSave, createRuntimeState, createWorldGraph, getDefaultRespawnPoint } from "./createWorld.js";
import { tickFoundries, applyFoundryDamage, isDeeperPathUnlocked, seedFoundryDefenses } from "./foundries.js";
import {
  RESPAWN_INVULNERABILITY_MS,
  WRECK_OWNER_PROTECTION_MS,
  canCollectDrop,
  computeWreckSalvage,
  damagePlayerShip,
  findBoltPlayerHit,
  killEnemy,
  tickEnemies,
  type PlayerDestruction
} from "./combat.js";
import { findNearestValidPosition, findTerrainImpactAlongPath, getEnemyCollisionRadius, getPlayerShipCollisionRadius, resolveMovement } from "./collision.js";
import { applyPersistedMapState, serializeMapState } from "./mapPersistence.js";
import { activateInstalledModule, applyWeaponFire } from "./moduleActions.js";
import { createLogger } from "../logger.js";
import { damageTerrainAt } from "./terrain.js";
import { generateMapLayout, tileToWorld, type GeneratedMapLayout } from "./mapGeneration.js";
import { getMapArchetype } from "./mapArchetypes.js";
import {
  EXIT_TRAVEL_RADIUS,
  buildDiscoveredMap,
  connectionsForMap,
  discoverExit,
  ensureUndiscoveredExits,
  exitPositionOnMap,
  findNearbyExit
} from "./worldGraph.js";
import { buildPlayerVisibilityView, findNearestVisiblePlayer } from "./visibility.js";
import { createBuilderState, createRuntimeShip, resolveActiveShip, syncCompletedShipBuilds, syncPlayerSaveFromRuntime, syncRuntimeInventoryFromSave, syncRuntimeShipFromSave } from "./shipLifecycle.js";

interface PlayerSessionState {
  // Branded player id used for runtime maps and persistence lookups.
  playerId: ReturnType<typeof asPlayerId>;
  // Connection timestamp used for diagnostics and future session aging.
  connectedAt: number;
  // Last client input tick applied by the simulation; echoed in snapshots so the client can reconcile.
  lastInputTick: number;
  // Movement inputs received but not yet simulated. While a client is streaming input, each input is exactly
  // one movement step (input + integration), which is the same step the client replays when predicting, so
  // prediction and server agree regardless of network jitter or small clock differences between the two.
  pendingMoveInputs: QueuedMoveInput[];
  // Consecutive ticks with no queued input. After a short gap the ship coasts on the server tick instead.
  starvedTicks: number;
  // Per-session terrain memory that is written back to the player save on disconnect.
  terrainMemoryByMap: PlayerSave["terrainMemoryByMap"];
}

interface QueuedMoveInput extends PlayerMovementInput {
  tick: number;
}

// Movement step length; every input is one step of this length on both server and client.
const movementStepSeconds = 1 / PLAYER_MOVEMENT_INPUT_RATE_HZ;
// With more than this many inputs queued, two are stepped per tick to catch up after a network hiccup.
const catchUpQueueLength = 2;
// Inputs beyond this are dropped (oldest first) so a client sending too fast cannot speed its ship up.
const maxQueuedMoveInputs = 8;
// A ship whose input stream pauses for longer than this coasts on the server tick, as if no keys were held.
const maxStarvedTicks = 3;

const logger = createLogger("gameWorld");
type SubmitShipDesignMessage = Extract<BuilderActionMessage, { action: "submitShipDesign" }>;

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
    let worldChanged = !storedWorld;

    // Worlds saved before discovery existed lack map depths; they only ever held root and the deeper map.
    for (const summary of Object.values(this.persistentWorld.maps)) {
      if (summary.depth === undefined) {
        summary.depth = summary.id === this.persistentWorld.graph.rootMapId ? 0 : 1;
        worldChanged = true;
      }
    }

    // Maps discovered in earlier sessions are not in the prototype runtime template, so regenerate their
    // baselines from seed + archetype. Layouts are also needed to place any missing undiscovered exits.
    const layouts: Record<string, GeneratedMapLayout> = {};
    for (const summary of Object.values(this.persistentWorld.maps)) {
      const needsRuntime = !this.runtime.maps[summary.id];
      const needsExit = !Object.values(this.persistentWorld.graph.connectionIndex).some((entry) => entry.sourceMapId === summary.id);
      if (!needsRuntime && !needsExit) {
        continue;
      }
      const layout = generateMapLayout(summary.seed, summary.biomeId ?? "deep-cavern");
      layouts[summary.id] = layout;
      if (needsRuntime) {
        this.runtime.maps[summary.id] = buildDiscoveredMap(summary, layout);
      }
    }
    worldChanged = ensureUndiscoveredExits(this.persistentWorld, layouts) || worldChanged;

    // Runtime maps share the graph's connection objects, so discovering an exit updates both sides at once.
    for (const map of Object.values(this.runtime.maps)) {
      map.connections = connectionsForMap(this.persistentWorld, map.id);
    }
    if (worldChanged) {
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

    // Enemies are not persisted, so every standing foundry starts with a full fortification garrison.
    const now = Date.now();
    for (const map of Object.values(this.runtime.maps)) {
      seedFoundryDefenses(map, now);
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
      pendingMoveInputs: [],
      starvedTicks: maxStarvedTicks,
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
        this.queueMovementInput(playerId, parsed);
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
        await this.changeMap(playerId, parsed);
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
    const destroyed: PlayerDestruction[] = [];
    const entityIdFactory = (prefix: string) => () => `${prefix}-${this.tickCounter}-${Math.random().toString(16).slice(2, 6)}`;
    for (const map of Object.values(this.runtime.maps)) {
      this.tickPlayers(map, deltaSeconds);
      destroyed.push(...this.tickProjectiles(map, deltaMs, now));
      destroyed.push(...tickEnemies(map, deltaSeconds, now, entityIdFactory("bolt")));
      await this.collectDrops(map, now);
      tickFoundries(map, now, entityIdFactory("enemy"));
    }

    // Destroyed ships leave a wreck and respawn after every map has ticked, so a ship moved to the root map
    // is not simulated twice in one tick.
    for (const destruction of destroyed) {
      await this.destroyPlayerShip(destruction, now);
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
      isDeeperPathUnlocked(map),
      {
        lastProcessedInputTick: session.lastInputTick,
        players: visibility.players,
        enemies: visibility.enemies,
        projectiles: visibility.projectiles,
        structures: visibility.structures,
        foundries: visibility.foundries,
        drops: visibility.drops,
        chunks: visibility.chunks,
        exits: this.describeExits(map),
        nearbyExitId: findNearbyExit(this.persistentWorld, map.id, player.position)?.id ?? null
      }
    );
  }

  // Lists the exits on a map for snapshots. Deeper exits share the map's foundry lock; return exits never lock.
  private describeExits(map: ActiveMapState): ExitSnapshot[] {
    const locked = !isDeeperPathUnlocked(map);
    return map.connections.flatMap((connection) => {
      const position = exitPositionOnMap(connection, map.id);
      if (!position) {
        return [];
      }
      const descend = connection.sourceMapId === map.id;
      return [
        {
          connectionId: connection.id,
          position,
          direction: descend ? "descend" : "ascend",
          discovered: connection.discovered && !!connection.destinationMapId,
          locked: descend && locked
        }
      ];
    });
  }

  // Advances player ships. A ship with a live input stream takes one movement step per queued input (input,
  // then integration), matching the client's replay exactly. Without input it coasts one tick at a time.
  private tickPlayers(map: ActiveMapState, deltaSeconds: number): void {
    for (const player of Object.values(map.players)) {
      const session = this.sessions.get(player.playerId);
      const queued = session?.pendingMoveInputs ?? [];
      if (!session || queued.length === 0) {
        if (session) {
          session.starvedTicks += 1;
        }
        // A brief gap is normal network jitter: hold position and let the next inputs catch up. A longer
        // gap means the client stopped sending (tab hidden, disconnected), so keep the ship drifting.
        if (!session || session.starvedTicks > maxStarvedTicks) {
          this.stepPlayerMovement(map, player, deltaSeconds);
        }
        continue;
      }

      session.starvedTicks = 0;
      const stepCount = queued.length > catchUpQueueLength ? 2 : 1;
      for (const input of queued.splice(0, stepCount)) {
        applyPlayerMovementInput(player, input);
        session.lastInputTick = input.tick;
        this.stepPlayerMovement(map, player, movementStepSeconds);
      }
    }
  }

  // Integrates one player ship step with collision resolution and drag.
  private stepPlayerMovement(map: ActiveMapState, player: ActiveMapState["players"][string], deltaSeconds: number): void {
    // Resolve against terrain, structures, players, and enemies so ships cannot overlap blockers.
    const resolved = resolveMovement(map, player.position, player.velocity, deltaSeconds, {
      radius: getPlayerShipCollisionRadius(player),
      excludeEntityId: player.id,
      includePlayers: true,
      includeEnemies: true
    });
    player.position = resolved.position;
    player.velocity = resolved.velocity;
    const retention = PLAYER_VELOCITY_RETENTION ** (deltaSeconds * PLAYER_MOVEMENT_INPUT_RATE_HZ);
    player.velocity.x *= retention;
    player.velocity.y *= retention;
  }

  // Advances projectiles, applies impact damage, creates drops, and removes expired projectiles.
  // Returns player ships destroyed by enemy fire this tick.
  private tickProjectiles(map: ActiveMapState, deltaMs: number, now: number): PlayerDestruction[] {
    const destroyed: PlayerDestruction[] = [];
    for (const projectile of Object.values(map.projectiles)) {
      // Move first, then sample the previous-to-current path for terrain collision.
      const previousPosition = { ...projectile.position };
      projectile.position.x += projectile.velocity.x * (deltaMs / 1000);
      projectile.position.y += projectile.velocity.y * (deltaMs / 1000);
      projectile.lifetimeMs -= deltaMs;

      const terrainImpact = findTerrainImpactAlongPath(map, previousPosition, projectile.position, 2);
      if (terrainImpact) {
        // Enemy bolts stop on rock without breaking it, so defenders do not dig out their own fortifications.
        if (projectile.faction === "enemy") {
          delete map.projectiles[projectile.id];
          continue;
        }
        // Terrain destruction is persisted immediately so mined walls survive later reconnects.
        projectile.position = terrainImpact;
        const terrainDamage = damageTerrainAt(map, terrainImpact, projectile.damage, this.tickCounter, 0.75);
        if (terrainDamage.destroyed) {
          void this.persistence.maps.saveMapState(this.worldId, serializeMapState(map, this.persistentWorld.maps[map.id]));
        }
        delete map.projectiles[projectile.id];
        continue;
      }

      // Enemy bolts only hit player ships.
      if (projectile.faction === "enemy") {
        const target = findBoltPlayerHit(map, projectile.position);
        if (target) {
          delete map.projectiles[projectile.id];
          const sourceType = projectile.ownerEnemyId ? map.enemies[projectile.ownerEnemyId]?.enemyTypeId : undefined;
          if (damagePlayerShip(target, projectile.damage, now)) {
            destroyed.push({ player: target, cause: sourceType ?? "enemy fire" });
          }
        } else if (projectile.lifetimeMs <= 0) {
          delete map.projectiles[projectile.id];
        }
        continue;
      }

      // Enemy impacts create salvage drops and refresh foundry spawn counts after kills.
      const enemy = Object.values(map.enemies).find((entry) => distance(entry.position, projectile.position) < getEnemyCollisionRadius(entry) + 2);
      if (enemy) {
        enemy.health -= projectile.damage;
        delete map.projectiles[projectile.id];
        if (enemy.health <= 0) {
          killEnemy(map, enemy, now);
        }
        continue;
      }

      // Foundry hits may unlock the deeper path and broadcast objective feedback to the whole map.
      const foundryDamage = applyFoundryDamage(map, projectile.position, projectile.damage, this.tickCounter);
      if (foundryDamage.hit) {
        if (foundryDamage.destroyedFoundry) {
          const unlocked = isDeeperPathUnlocked(map) && map.connections.some((entry) => entry.sourceMapId === map.id);
          this.queueMapFeedback(
            map.id,
            unlocked ? "deeper_path_unlocked" : "foundry_destroyed",
            unlocked ? "Deeper Path Unlocked" : "Foundry Destroyed",
            unlocked
              ? map.id === "map-root"
                ? "The root foundry is down. The deeper route is now open."
                : "This cavern's foundry is down. The way deeper is open."
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
    return destroyed;
  }

  // Transfers nearby resource drops into player runtime inventory and persists the new totals.
  // Protected wreck salvage can only be collected by its owner until the protection expires.
  private async collectDrops(map: ActiveMapState, now: number): Promise<void> {
    for (const [dropId, drop] of Object.entries(map.drops)) {
      const collector = Object.values(map.players).find((entry) => distance(entry.position, drop.position) < 16 && canCollectDrop(drop, entry, now));
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

  // Runs the GDD failure loop (§4.3, §16) for a ship whose hull reached zero: the wreck drops half the
  // carried cargo plus half the ship's build cost as owner-protected salvage, the destroyed ship leaves the
  // stable, and the player respawns at the root spawn in a fresh fallback Sparrow with a starter loadout.
  private async destroyPlayerShip(destruction: PlayerDestruction, now: number): Promise<void> {
    const { player, cause } = destruction;
    const sourceMap = this.runtime.maps[player.mapId];
    if (!sourceMap || sourceMap.players[player.playerId] !== player || player.hull > 0) {
      return;
    }
    const save = await this.persistence.players.getPlayer(this.worldId, player.playerId);
    if (!save) {
      return;
    }

    // Wreck salvage stays where the ship died.
    const wreckPosition = { ...player.position };
    const salvage = computeWreckSalvage(player.inventory, { hullId: player.hullId, modules: player.modules });
    const wreckId = asEntityId(`wreck-${player.playerId}-${this.tickCounter}`);
    if (Object.keys(salvage.spilled).length > 0) {
      sourceMap.drops[wreckId] = {
        id: wreckId,
        mapId: sourceMap.id,
        position: wreckPosition,
        resources: salvage.spilled,
        ownerPlayerId: player.playerId,
        protectedUntil: now + WRECK_OWNER_PROTECTION_MS
      };
    }

    // The destroyed ship is lost; a free fallback Sparrow takes its place as the active ship.
    const lostShip = save.shipStable[save.activeShipId];
    delete save.shipStable[save.activeShipId];
    const fallback = createFallbackShip(player.playerId, now);
    save.shipStable[fallback.id] = fallback;
    save.activeShipId = fallback.id;
    save.resourceCounts = { ...salvage.keptInventory };
    const respawn = getDefaultRespawnPoint();
    save.spawnPoint = { mapId: respawn.mapId, position: { ...respawn.position } };
    save.updatedAt = now;

    // Move the live ship to the respawn map and rebuild it from the fallback save.
    const respawnMap = this.runtime.maps[respawn.mapId];
    delete sourceMap.players[player.playerId];
    player.mapId = respawn.mapId;
    player.velocity = { x: 0, y: 0 };
    player.angularVelocity = 0;
    player.moduleCooldowns = {};
    syncRuntimeShipFromSave(player, save);
    player.hull = player.maxHull;
    player.power = player.maxPower;
    player.invulnerableUntil = now + RESPAWN_INVULNERABILITY_MS;
    player.position = findNearestValidPosition(respawnMap, respawn.position, getPlayerShipCollisionRadius(player), {
      includePlayers: true,
      includeEnemies: true
    });
    respawnMap.players[player.playerId] = player;
    const session = this.sessions.get(player.playerId);
    if (session) {
      session.pendingMoveInputs = [];
    }

    await this.persistence.players.savePlayer(syncPlayerSaveFromRuntime(player, save));
    logger.info("Player ship destroyed", {
      playerId: player.playerId,
      mapId: sourceMap.id,
      cause,
      lostShipId: lostShip?.id,
      lostHullId: lostShip?.hullId,
      wreckPosition,
      wreckSalvage: salvage.spilled
    });

    const salvageTotal = Object.values(salvage.spilled).reduce((sum, amount) => sum + amount, 0);
    const where = sourceMap.id === respawn.mapId ? "where you went down" : `in ${sourceMap.id}`;
    this.queueActionFeedback(
      player.playerId,
      "ship_destroyed",
      "Ship Destroyed",
      salvageTotal > 0
        ? `${lostShip?.name ?? "Your ship"} was destroyed by ${cause}. ${salvageTotal} salvage waits ${where}, reserved for you for ${Math.round(WRECK_OWNER_PROTECTION_MS / 1000)}s. Respawned in a fallback Sparrow.`
        : `${lostShip?.name ?? "Your ship"} was destroyed by ${cause}. Respawned in a fallback Sparrow.`,
      "warning",
      now,
      0,
      true
    );
    this.queueMessage(player.playerId, createBuilderState(save, now));
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

  // Queues a movement input sample for the next simulation tick. Inputs at or before the last applied tick
  // are stale duplicates and are ignored.
  private queueMovementInput(playerId: ReturnType<typeof asPlayerId>, input: QueuedMoveInput): void {
    const session = this.sessions.get(playerId);
    if (!session) {
      return;
    }
    const newestQueuedTick = session.pendingMoveInputs.at(-1)?.tick ?? session.lastInputTick;
    if (input.tick <= newestQueuedTick) {
      return;
    }
    session.pendingMoveInputs.push({
      thrustForward: input.thrustForward,
      thrustReverse: input.thrustReverse,
      rotateLeft: input.rotateLeft,
      rotateRight: input.rotateRight,
      tick: input.tick
    });
    if (session.pendingMoveInputs.length > maxQueuedMoveInputs) {
      session.pendingMoveInputs.splice(0, session.pendingMoveInputs.length - maxQueuedMoveInputs);
    }
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

  // Moves a player through a map exit: deeper along a connection, or back up it from the destination side.
  // The first trip through an undiscovered exit generates and persists the map behind it.
  private async changeMap(playerId: ReturnType<typeof asPlayerId>, message: ChangeMapMessage): Promise<void> {
    const sourceMap = this.getPlayerMap(playerId);
    const player = sourceMap.players[playerId];
    const now = Date.now();
    const connection: MapConnection | undefined = this.persistentWorld.graph.connectionIndex[message.connectionId];
    const exitPosition = connection ? exitPositionOnMap(connection, sourceMap.id) : null;
    if (!connection || !exitPosition) {
      this.queueActionFeedback(playerId, "map_connection_missing", "Route Unavailable", "That navigation route is no longer available.", "warning", now, 1200);
      return;
    }
    if (distance(exitPosition, player.position) > EXIT_TRAVEL_RADIUS) {
      this.queueActionFeedback(playerId, "map_exit_out_of_range", "Too Far From Exit", "Fly closer to the exit to travel through it.", "info", now, 1200);
      return;
    }

    const descending = connection.sourceMapId === sourceMap.id;
    if (descending && !isDeeperPathUnlocked(sourceMap)) {
      const detail =
        sourceMap.id === "map-root"
          ? "Destroy the root foundry to unlock the deeper route."
          : "Destroy this cavern's foundry to open the way deeper.";
      this.queueActionFeedback(playerId, "deeper_path_locked", "Path Locked", detail, "info", now, 1500);
      return;
    }
    if (descending && !connection.destinationMapId) {
      await this.discoverConnection(playerId, connection, now);
    }

    const destinationMapId = descending ? connection.destinationMapId : connection.sourceMapId;
    const arrivalAnchor = descending ? connection.destinationAnchor : connection.sourceAnchor;
    const destinationMap = destinationMapId ? this.runtime.maps[destinationMapId] : undefined;
    if (!destinationMapId || !arrivalAnchor || !destinationMap) {
      this.queueActionFeedback(playerId, "map_connection_missing", "Route Unavailable", "That navigation route is no longer available.", "warning", now, 1200);
      return;
    }

    // Transfer the same runtime ship object so hull, modules, inventory, and cooldowns remain intact.
    delete sourceMap.players[playerId];
    player.mapId = destinationMapId;
    player.position = findNearestValidPosition(destinationMap, tileToWorld(arrivalAnchor), getPlayerShipCollisionRadius(player), {
      includePlayers: true,
      includeEnemies: true
    });
    player.velocity = { x: 0, y: 0 };
    destinationMap.players[playerId] = player;
  }

  // Generates the map behind an undiscovered exit, adds it to the runtime, and persists the graph and map.
  private async discoverConnection(playerId: ReturnType<typeof asPlayerId>, connection: MapConnection, now: number): Promise<void> {
    // discoverExit mutates the graph synchronously, so a second player arriving mid-save sees it discovered.
    const startedAt = performance.now();
    const discovered = discoverExit(this.persistentWorld, connection, now);
    seedFoundryDefenses(discovered.map, now);
    this.runtime.maps[discovered.summary.id] = discovered.map;
    const sourceMap = this.runtime.maps[connection.sourceMapId];
    if (sourceMap && !sourceMap.connections.includes(connection)) {
      sourceMap.connections.push(connection);
    }

    const archetype = getMapArchetype(discovered.summary.biomeId ?? "deep-cavern");
    logger.info("Discovered map generated", {
      mapId: discovered.summary.id,
      connectionId: connection.id,
      seed: discovered.summary.seed,
      archetypeId: archetype.archetypeId,
      depth: discovered.summary.depth,
      generationMs: Math.round(performance.now() - startedAt),
      playerId
    });
    this.queueActionFeedback(
      playerId,
      "map_discovered",
      "New Cavern Charted",
      `${archetype.label}, depth ${discovered.summary.depth}.`,
      "info",
      now,
      0,
      true
    );

    await this.persistence.worlds.saveWorld(this.persistentWorld);
    await this.persistence.maps.saveMapState(this.worldId, serializeMapState(discovered.map, discovered.summary));
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

    if (message.action === "submitShipDesign") {
      resourcesChanged = this.applySubmittedShipDesign(playerId, playerSave, message, now) || resourcesChanged;
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

  // Applies the builder workstation's full hull/module design as one validated save mutation.
  private applySubmittedShipDesign(
    playerId: ReturnType<typeof asPlayerId>,
    playerSave: PlayerSave,
    message: SubmitShipDesignMessage,
    now: number
  ): boolean {
    const hull = this.findHullForDesign(playerId, message.hullId, now);
    if (!hull) {
      return false;
    }

    const targetShip = message.mode === "refit" ? this.findRefitShip(playerId, playerSave, message, now) : null;
    if (message.mode === "refit" && !targetShip) {
      return false;
    }

    const preparedDesign = this.prepareSubmittedModules(playerId, playerSave, targetShip, hull, message.modules, now);
    if (!preparedDesign) {
      return false;
    }

    const totalCost = message.mode === "new" ? addResourceMaps(hull.buildCost, preparedDesign.craftCost) : preparedDesign.craftCost;
    if (!hasEnoughResources(playerSave.resourceCounts, totalCost)) {
      this.queueActionFeedback(playerId, "ship_design_insufficient_resources", "Design Blocked", "You need more resources for that hull or module loadout.", "warning", now);
      return false;
    }

    playerSave.resourceCounts = subtractResourceMaps(playerSave.resourceCounts, totalCost);
    playerSave.craftedModules = this.toCraftedModuleStacks(preparedDesign.availableModules);

    if (message.mode === "new") {
      const builtShipId = asShipId(`ship-${message.hullId}-${Date.now()}`);
      const buildCompleteAt = hull.buildTimeMs > 0 ? now + hull.buildTimeMs : null;
      playerSave.shipStable[builtShipId] = {
        id: builtShipId,
        name: hull.name,
        hullId: hull.id,
        modules: preparedDesign.installedModules,
        hullIntegrity: hull.baseHull,
        status: hull.buildTimeMs > 0 ? "building" : "ready",
        buildStartedAt: now,
        buildCompleteAt
      };
      logger.info("Ship design build accepted", {
        playerId,
        hullId: hull.id,
        shipId: builtShipId,
        modules: preparedDesign.installedModules.map((module) => module.moduleId)
      });
      return Object.keys(totalCost).length > 0;
    }

    targetShip!.modules = preparedDesign.installedModules;
    if (targetShip!.id === playerSave.activeShipId) {
      const runtimeMap = Object.values(this.runtime.maps).find((entry) => entry.players[playerId]);
      if (runtimeMap) {
        syncRuntimeShipFromSave(runtimeMap.players[playerId], playerSave);
      }
    }
    this.queueActionFeedback(playerId, "ship_design_refit_applied", "Refit Applied", "Your ship loadout has been updated.", "info", now, 400, true);
    return Object.keys(totalCost).length > 0;
  }

  // Resolves a hull id for design submission and queues user feedback for invalid content ids.
  private findHullForDesign(playerId: ReturnType<typeof asPlayerId>, hullId: string, now: number): ReturnType<typeof getHullDefinition> | null {
    try {
      return getHullDefinition(hullId);
    } catch {
      this.queueActionFeedback(playerId, "ship_design_unknown_hull", "Design Blocked", "That hull is no longer available.", "warning", now);
      return null;
    }
  }

  // Finds the refit target and ensures building ships cannot be modified.
  private findRefitShip(
    playerId: ReturnType<typeof asPlayerId>,
    playerSave: PlayerSave,
    message: SubmitShipDesignMessage,
    now: number
  ): StoredShip | null {
    if (!message.shipId) {
      this.queueActionFeedback(playerId, "ship_design_missing_ship", "Design Blocked", "Select a ship before applying a refit.", "warning", now);
      return null;
    }
    const ship = playerSave.shipStable[message.shipId];
    if (!ship) {
      this.queueActionFeedback(playerId, "ship_design_missing_ship", "Design Blocked", "That ship is no longer in your stable.", "warning", now);
      return null;
    }
    if (ship.status === "building") {
      this.queueActionFeedback(playerId, "ship_design_ship_building", "Design Blocked", "Ships under construction cannot be refit yet.", "warning", now);
      return null;
    }
    if (ship.hullId !== message.hullId) {
      this.queueActionFeedback(playerId, "ship_design_hull_mismatch", "Design Blocked", "The selected ship does not match that hull.", "warning", now);
      return null;
    }
    return ship;
  }

  // Validates hardpoint/module compatibility and computes crafted-module/resource consumption.
  private prepareSubmittedModules(
    playerId: ReturnType<typeof asPlayerId>,
    playerSave: PlayerSave,
    targetShip: StoredShip | null,
    hull: ReturnType<typeof getHullDefinition>,
    submittedModules: SubmitShipDesignMessage["modules"],
    now: number
  ): { installedModules: InstalledModule[]; availableModules: Map<string, number>; craftCost: ResourceMap } | null {
    const hardpointsById = new Map(hull.hardpoints.map((hardpoint) => [hardpoint.id, hardpoint]));
    const seenHardpoints = new Set<string>();
    const availableModules = new Map(playerSave.craftedModules.map((entry) => [entry.moduleId, entry.quantity]));
    for (const installed of targetShip?.modules ?? []) {
      availableModules.set(installed.moduleId, (availableModules.get(installed.moduleId) ?? 0) + 1);
    }

    let craftCost: ResourceMap = {};
    const installedModules: InstalledModule[] = [];

    for (const submitted of submittedModules) {
      if (seenHardpoints.has(submitted.hardpointId)) {
        this.queueActionFeedback(playerId, "ship_design_duplicate_hardpoint", "Design Blocked", "A mount point can only hold one module.", "warning", now);
        return null;
      }
      seenHardpoints.add(submitted.hardpointId);

      const hardpoint = hardpointsById.get(submitted.hardpointId);
      const moduleDefinition = moduleDefinitions.find((entry) => entry.id === submitted.moduleId);
      if (!hardpoint || !moduleDefinition) {
        this.queueActionFeedback(playerId, "ship_design_invalid_mount", "Design Blocked", "One of the selected mount options is no longer valid.", "warning", now);
        return null;
      }
      if (hardpoint.type !== moduleDefinition.slotType) {
        this.queueActionFeedback(playerId, "ship_design_incompatible_module", "Design Blocked", "A selected module does not fit that mount point.", "warning", now);
        return null;
      }

      const ownedCount = availableModules.get(moduleDefinition.id) ?? 0;
      if (ownedCount > 0) {
        availableModules.set(moduleDefinition.id, ownedCount - 1);
      } else {
        craftCost = addResourceMaps(craftCost, moduleDefinition.buildCost);
      }

      installedModules.push({
        moduleId: moduleDefinition.id,
        hardpointId: hardpoint.id,
        currentHealth: moduleDefinition.maxHealth
      });
    }

    return { installedModules, availableModules, craftCost };
  }

  // Converts an internal availability map back into the persistence stack array shape.
  private toCraftedModuleStacks(modules: Map<string, number>): PlayerSave["craftedModules"] {
    return Array.from(modules.entries())
      .map(([moduleId, quantity]) => ({ moduleId, quantity }))
      .filter((entry) => entry.quantity > 0);
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

// The fallback ship a destroyed player respawns in: a free Sparrow Scout with the starter loadout.
function createFallbackShip(playerId: string, now: number): StoredShip {
  return {
    id: asShipId(`ship-${playerId}-fallback-${now}`),
    name: "Fallback Sparrow",
    hullId: "sparrow-scout",
    modules: [
      { moduleId: "starter-thruster", hardpointId: "engine-rear", currentHealth: 30 },
      { moduleId: "pulse-cannon", hardpointId: "weapon-front", currentHealth: 24 },
      { moduleId: "mining-laser", hardpointId: "utility-belly", currentHealth: 20 }
    ],
    hullIntegrity: getHullDefinition("sparrow-scout").baseHull,
    status: "active",
    buildStartedAt: null,
    buildCompleteAt: null
  };
}
