export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorldId = Brand<string, "WorldId">;
export type MapId = Brand<string, "MapId">;
export type ConnectionId = Brand<string, "ConnectionId">;
export type PlayerId = Brand<string, "PlayerId">;
export type EntityId = Brand<string, "EntityId">;
export type ShipId = Brand<string, "ShipId">;
export type StructureId = Brand<string, "StructureId">;

export function asWorldId(value: string): WorldId {
  return value as WorldId;
}

export function asMapId(value: string): MapId {
  return value as MapId;
}

export function asConnectionId(value: string): ConnectionId {
  return value as ConnectionId;
}

export function asPlayerId(value: string): PlayerId {
  return value as PlayerId;
}

export function asEntityId(value: string): EntityId {
  return value as EntityId;
}

export function asShipId(value: string): ShipId {
  return value as ShipId;
}

export function asStructureId(value: string): StructureId {
  return value as StructureId;
}

