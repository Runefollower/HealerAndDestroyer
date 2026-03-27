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
  aimWorld: vec2Schema,
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

export const builderActionSchema = z.object({
  type: z.literal("builderAction"),
  action: z.enum(["craftModule", "startShipBuild", "swapShip", "installModule", "removeModule"]),
  targetId: z.string(),
  shipId: z.string().optional(),
  hardpointId: z.string().optional()
});

export const joinWorldSchema = z.object({
  type: z.literal("joinWorld"),
  playerId: z.string()
});

export const clientMessageSchema = z.discriminatedUnion("type", [
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
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  rotation: number;
  hull: number;
  maxHull: number;
}

export interface EnemySnapshot {
  id: EntityId;
  enemyTypeId: string;
  position: { x: number; y: number };
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

export interface ChunkSnapshot {
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  cells: number[];
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

export type ServerMessage = SnapshotMessage | JoinedWorldMessage | BuilderStateMessage;

export function createSnapshotMessage(
  tick: number,
  selfPlayerId: PlayerId,
  mapId: MapId,
  map: ActiveMapState,
  self: PlayerShipState,
  builderSiteNearby: boolean,
  deeperPathUnlocked: boolean
): SnapshotMessage {
  return {
    type: "snapshot",
    tick,
    selfPlayerId,
    mapId,
    players: Object.values(map.players).map((player) => ({
      id: player.id,
      playerId: player.playerId,
      position: player.position,
      velocity: player.velocity,
      rotation: player.rotation,
      hull: player.hull,
      maxHull: player.maxHull
    })),
    enemies: Object.values(map.enemies).map((enemy) => ({
      id: enemy.id,
      enemyTypeId: enemy.enemyTypeId,
      position: enemy.position,
      health: enemy.health
    })),
    projectiles: Object.values(map.projectiles).map((projectile) => ({
      id: projectile.id,
      position: projectile.position
    })),
    structures: Object.values(map.structures).map((structure) => ({
      id: structure.id,
      structureTypeId: structure.structureTypeId,
      position: structure.position,
      health: structure.health,
      buildState: structure.buildState
    })),
    foundries: Object.values(map.foundries).map((foundry) => ({
      id: foundry.id,
      position: foundry.position,
      health: foundry.health,
      active: foundry.active,
      spawnCooldownMs: foundry.spawnCooldownMs,
      spawnCap: foundry.spawnCap,
      activeEnemyCount: foundry.activeEnemyCount
    })),
    drops: Object.values(map.drops).map((drop) => ({
      id: drop.id,
      position: drop.position,
      resources: drop.resources
    })),
    chunks: Object.entries(map.chunks).map(([chunkKey, chunk]) => ({
      chunkKey,
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      cells: [...chunk.cells]
    })),
    inventory: self.inventory,
    selfModules: structuredClone(self.modules),
    builderSiteNearby,
    deeperPathUnlocked
  };
}
