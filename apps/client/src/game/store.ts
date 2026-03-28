import type { ServerMessage, SnapshotMessage } from "@healer/shared";

export type ToastTone = "info" | "warning" | "success";
export type ModuleSelectionCapability = "weapon" | "mining" | "support";

export interface UiToast {
  id: string;
  title: string;
  body: string;
  expiresAt: number;
  tone: ToastTone;
}

export interface ClientStore {
  latestSnapshot: SnapshotMessage | null;
  builderState: Extract<ServerMessage, { type: "builderState" }> | null;
  builderOpen: boolean;
  hudMinimized: boolean;
  toasts: UiToast[];
  selectedModuleHardpoints: Record<ModuleSelectionCapability, string | null>;
}

export function createClientStore(): ClientStore {
  return {
    latestSnapshot: null,
    builderState: null,
    builderOpen: false,
    hudMinimized: false,
    toasts: [],
    selectedModuleHardpoints: {
      weapon: null,
      mining: null,
      support: null
    }
  };
}
