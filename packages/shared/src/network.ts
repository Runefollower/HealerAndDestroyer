import { z } from "zod";
import type { EntityId, MapId, PlayerId, ShipId } from "./ids.js";
import type { InstalledModule } from "./content.js";
import type { PlayerSave, StoredShip } from "./persistence.js";
import type { ActiveMapState, PlayerShipState } from "./world.js";
import type { ResourceMap } from "./resources.js";

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
  health: number;
}

export interface ProjectileSnapshot {
  id: EntityId;
  position: { x: number; y: number };
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
  selfPlayerId: PlayerId;
  mapId: MapId;
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  structures: StructureSnapshot[];
  foundries: FoundrySnapshot[];
  drops: DropSnapshot[];
  chunks: ChunkSnapshot[];
  inventory: ResourceMap;
  selfModules: InstalledModule[];
  builderSiteNearby: boolean;
  deeperPathUnlocked: boolean;
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
  players?: PlayerSnapshot[];
  enemies?: EnemySnapshot[];
  projectiles?: ProjectileSnapshot[];
  structures?: StructureSnapshot[];
  foundries?: FoundrySnapshot[];
  drops?: DropSnapshot[];
  chunks?: ChunkSnapshot[];
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
        health: enemy.health
      })),
    projectiles:
      overrides.projectiles ??
      Object.values(map.projectiles).map((projectile) => ({
        id: projectile.id,
        position: projectile.position
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
      Object.values(map.drops).map((drop) => ({
        id: drop.id,
        position: drop.position,
        resources: drop.resources
      })),
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
    deeperPathUnlocked
  };
}
