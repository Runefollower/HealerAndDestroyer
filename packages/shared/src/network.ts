import { z } from "zod";
import type { EntityId, MapId, PlayerId, ShipId } from "./ids.js";
import type { InstalledModule } from "./content.js";
import type { PlayerSave, StoredShip } from "./persistence.js";
import type { ActiveMapState, PlayerShipState } from "./world.js";
import type { ResourceMap } from "./resources.js";
import type { EffectEvent } from "./effects.js";

export const vec2Schema = z.object({
  x: z.number(),
  y: z.number()
});

export const moveInputSchema = z.object({
  type: z.literal("moveInput"),
  thrustForward: z.boolean(),
  thrustReverse: z.boolean(),
  rotateLeft: z.boolean(),
  rotateRight: z.boolean(),
  tick: z.number().int().nonnegative()
});

export const fireWeaponSchema = z.object({
  type: z.literal("fireWeapon"),
  weaponHardpointId: z.string(),
  targetWorld: vec2Schema.optional(),
  targetEntityId: z.string().optional(),
  tick: z.number().int().nonnegative()
});

export const activateModuleSchema = z.object({
  type: z.literal("activateModule"),
  moduleId: z.string(),
  targetWorld: vec2Schema.optional(),
  targetEntityId: z.string().optional(),
  tick: z.number().int().nonnegative()
});

export const interactSchema = z.object({
  type: z.literal("interact"),
  targetEntityId: z.string().optional()
});

export const changeMapSchema = z.object({
  type: z.literal("changeMap"),
  connectionId: z.string()
});

const builderDesignModuleSchema = z.object({
  hardpointId: z.string(),
  moduleId: z.string()
});

const legacyBuilderActionSchema = z.object({
  type: z.literal("builderAction"),
  action: z.enum(["craftModule", "startShipBuild", "swapShip", "installModule", "removeModule"]),
  targetId: z.string(),
  shipId: z.string().optional(),
  hardpointId: z.string().optional()
});

const submitShipDesignActionSchema = z.object({
  type: z.literal("builderAction"),
  action: z.literal("submitShipDesign"),
  mode: z.enum(["new", "refit"]),
  hullId: z.string(),
  shipId: z.string().optional(),
  modules: z.array(builderDesignModuleSchema)
});

export const builderActionSchema = z.discriminatedUnion("action", [legacyBuilderActionSchema, submitShipDesignActionSchema]);

export const joinWorldSchema = z.object({
  type: z.literal("joinWorld"),
  playerId: z.string()
});

export const clientMessageSchema = z.union([
  moveInputSchema,
  fireWeaponSchema,
  activateModuleSchema,
  interactSchema,
  changeMapSchema,
  builderActionSchema,
  joinWorldSchema
]);

export type MoveInputMessage = z.infer<typeof moveInputSchema>;
export type FireWeaponMessage = z.infer<typeof fireWeaponSchema>;
export type ActivateModuleMessage = z.infer<typeof activateModuleSchema>;
export type InteractMessage = z.infer<typeof interactSchema>;
export type ChangeMapMessage = z.infer<typeof changeMapSchema>;
export type BuilderActionMessage = z.infer<typeof builderActionSchema>;
export type JoinWorldMessage = z.infer<typeof joinWorldSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PlayerSnapshot {
  id: EntityId;
  playerId: PlayerId;
  shipId: ShipId;
  hullId: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  rotation: number;
  hull: number;
  maxHull: number;
  modules: InstalledModule[];
}

export interface EnemySnapshot {
  id: EntityId;
  enemyTypeId: string;
  position: { x: number; y: number };
  rotation: number;
  // velocity is world-space pixels per second, used by the client to dead-reckon between snapshots.
  velocity: { x: number; y: number };
  health: number;
}

export interface ProjectileSnapshot {
  id: EntityId;
  position: { x: number; y: number };
  // velocity is world-space pixels per second; projectiles fly straight, so the client can extrapolate exactly.
  velocity: { x: number; y: number };
  // hostile marks enemy fire so the client can draw it differently from player bolts.
  hostile?: boolean;
}

export interface StructureSnapshot {
  id: EntityId;
  structureTypeId: string;
  position: { x: number; y: number };
  health: number;
  buildState: string;
}

export interface FoundrySnapshot {
  id: EntityId;
  position: { x: number; y: number };
  health: number;
  active: boolean;
  spawnCooldownMs: number;
  spawnCap: number;
  activeEnemyCount: number;
}

export interface DropSnapshot {
  id: EntityId;
  position: { x: number; y: number };
  resources: ResourceMap;
  // Drift state so the client can extrapolate between snapshots (see DROP_DRIFT / driftOffset).
  velocity: { x: number; y: number };
  rotation: number;
  angularVelocity: number;
}

// ExitSnapshot is one map connection endpoint on the player's current map.
export interface ExitSnapshot {
  connectionId: string;
  // position is the world-space center of the exit tile.
  position: { x: number; y: number };
  // "descend" leads deeper (possibly to a map nobody has generated yet); "ascend" leads back toward root.
  direction: "descend" | "ascend";
  // discovered is false until some player has gone through, which generates the destination map.
  discovered: boolean;
  // locked exits refuse travel until the map's foundries are destroyed.
  locked: boolean;
}

export type TerrainVisibilityState = 0 | 1 | 2;

export interface ChunkSnapshot {
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  cells: number[];
  visibility: TerrainVisibilityState[];
}

export interface SnapshotMessage {
  type: "snapshot";
  tick: number;
  // lastProcessedInputTick is the newest moveInput tick the server applied for this player, so the
  // client can replay only the inputs the server has not seen yet when predicting its own ship.
  lastProcessedInputTick: number;
  selfPlayerId: PlayerId;
  mapId: MapId;
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  structures: StructureSnapshot[];
  foundries: FoundrySnapshot[];
  drops: DropSnapshot[];
  // effects are recent visible cosmetic events; an event repeats in consecutive snapshots, so dedupe by id.
  effects: EffectEvent[];
  chunks: ChunkSnapshot[];
  inventory: ResourceMap;
  selfModules: InstalledModule[];
  builderSiteNearby: boolean;
  deeperPathUnlocked: boolean;
  exits: ExitSnapshot[];
  // nearbyExitId is the exit close enough to travel through with the interact key, if any.
  nearbyExitId: string | null;
}

export interface JoinedWorldMessage {
  type: "joinedWorld";
  player: PlayerSave;
}

export interface BuilderShipState {
  shipId: ShipId;
  ship: StoredShip;
  remainingBuildMs: number;
}

export interface BuilderStateMessage {
  type: "builderState";
  serverTime: number;
  activeShipId: PlayerSave["activeShipId"];
  ships: BuilderShipState[];
  craftedModules: PlayerSave["craftedModules"];
}

export interface ShipBuildCompletedMessage {
  type: "shipBuildCompleted";
  serverTime: number;
  shipId: ShipId;
  shipName: string;
  hullId: string;
}

export interface ActionFeedbackMessage {
  type: "actionFeedback";
  serverTime: number;
  level: "info" | "warning";
  code: string;
  title: string;
  detail: string;
}

export type ServerMessage =
  | SnapshotMessage
  | JoinedWorldMessage
  | BuilderStateMessage
  | ShipBuildCompletedMessage
  | ActionFeedbackMessage;

export interface SnapshotMessageOverrides {
  lastProcessedInputTick?: number;
  players?: PlayerSnapshot[];
  enemies?: EnemySnapshot[];
  projectiles?: ProjectileSnapshot[];
  structures?: StructureSnapshot[];
  foundries?: FoundrySnapshot[];
  drops?: DropSnapshot[];
  effects?: EffectEvent[];
  chunks?: ChunkSnapshot[];
  exits?: ExitSnapshot[];
  nearbyExitId?: string | null;
}

export function createSnapshotMessage(
  tick: number,
  selfPlayerId: PlayerId,
  mapId: MapId,
  map: ActiveMapState,
  self: PlayerShipState,
  builderSiteNearby: boolean,
  deeperPathUnlocked: boolean,
  overrides: SnapshotMessageOverrides = {}
): SnapshotMessage {
  return {
    type: "snapshot",
    tick,
    lastProcessedInputTick: overrides.lastProcessedInputTick ?? 0,
    selfPlayerId,
    mapId,
    players:
      overrides.players ??
      Object.values(map.players).map((player) => ({
        id: player.id,
        playerId: player.playerId,
        shipId: player.shipId,
        hullId: player.hullId,
        position: player.position,
        velocity: player.velocity,
        rotation: player.rotation,
        hull: player.hull,
        maxHull: player.maxHull,
        modules: structuredClone(player.modules)
      })),
    enemies:
      overrides.enemies ??
      Object.values(map.enemies).map((enemy) => ({
        id: enemy.id,
        enemyTypeId: enemy.enemyTypeId,
        position: enemy.position,
        rotation: enemy.rotation,
        velocity: enemy.velocity,
        health: enemy.health
      })),
    projectiles:
      overrides.projectiles ??
      Object.values(map.projectiles).map((projectile) => ({
        id: projectile.id,
        position: projectile.position,
        velocity: projectile.velocity,
        hostile: projectile.faction === "enemy"
      })),
    structures:
      overrides.structures ??
      Object.values(map.structures).map((structure) => ({
        id: structure.id,
        structureTypeId: structure.structureTypeId,
        position: structure.position,
        health: structure.health,
        buildState: structure.buildState
      })),
    foundries:
      overrides.foundries ??
      Object.values(map.foundries).map((foundry) => ({
        id: foundry.id,
        position: foundry.position,
        health: foundry.health,
        active: foundry.active,
        spawnCooldownMs: foundry.spawnCooldownMs,
        spawnCap: foundry.spawnCap,
        activeEnemyCount: foundry.activeEnemyCount
      })),
    drops:
      overrides.drops ??
      Object.values(map.drops).map(toDropSnapshot),
    effects: overrides.effects ?? [...(map.effects ?? [])],
    chunks:
      overrides.chunks ??
      Object.entries(map.chunks).map(([chunkKey, chunk]) => ({
        chunkKey,
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        cells: [...chunk.cells],
        visibility: chunk.cells.map(() => 2 as TerrainVisibilityState)
      })),
    inventory: self.inventory,
    selfModules: structuredClone(self.modules),
    builderSiteNearby,
    deeperPathUnlocked,
    exits: overrides.exits ?? [],
    nearbyExitId: overrides.nearbyExitId ?? null
  };
}

// Converts live resource drop state into the network snapshot shape, defaulting unlaunched drift to rest.
export function toDropSnapshot(drop: ActiveMapState["drops"][string]): DropSnapshot {
  return {
    id: drop.id,
    position: drop.position,
    resources: drop.resources,
    velocity: drop.velocity ?? { x: 0, y: 0 },
    rotation: drop.rotation ?? 0,
    angularVelocity: drop.angularVelocity ?? 0
  };
}
