import type { ServerMessage, SnapshotMessage } from "@healer/shared";

export interface ClientStore {
  latestSnapshot: SnapshotMessage | null;
  builderState: Extract<ServerMessage, { type: "builderState" }> | null;
}

export function createClientStore(): ClientStore {
  return {
    latestSnapshot: null,
    builderState: null
  };
}

