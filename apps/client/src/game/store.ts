import type { ServerMessage, SnapshotMessage } from "@healer/shared";

export interface UiToast {
  id: string;
  title: string;
  body: string;
  expiresAt: number;
}

export interface ClientStore {
  latestSnapshot: SnapshotMessage | null;
  builderState: Extract<ServerMessage, { type: "builderState" }> | null;
  builderOpen: boolean;
  hudMinimized: boolean;
  toasts: UiToast[];
}

export function createClientStore(): ClientStore {
  return {
    latestSnapshot: null,
    builderState: null,
    builderOpen: false,
    hudMinimized: false,
    toasts: []
  };
}
