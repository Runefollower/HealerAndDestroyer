import type { ServerMessage, SnapshotMessage } from "@healer/shared";

export type ToastTone = "info" | "warning" | "success";
export type ModuleSelectionCapability = "weapon" | "mining" | "support";

export interface UiToast {
  // id deduplicates/keys transient messages in the notification stack.
  id: string;
  // title and body are rendered directly into the toast UI.
  title: string;
  body: string;
  // expiresAt is a browser Date.now timestamp used by the ticker to prune old toasts.
  expiresAt: number;
  // tone maps server feedback level into toast styling.
  tone: ToastTone;
}

export interface ClientStore {
  // latestSnapshot is the client-side source of truth for rendering and local UI labels.
  latestSnapshot: SnapshotMessage | null;
  // builderState caches the latest server builder payload while the panel is open.
  builderState: Extract<ServerMessage, { type: "builderState" }> | null;
  // builderOpen and hudMinimized are local UI preferences, not server state.
  builderOpen: boolean;
  hudMinimized: boolean;
  // fpsVisible is toggled with 0 and controls the frame-rate overlay.
  fpsVisible: boolean;
  // toasts contains transient server/client feedback messages.
  toasts: UiToast[];
  // selectedModuleHardpoints records the active hardpoint per module capability for hotkey cycling.
  selectedModuleHardpoints: Record<ModuleSelectionCapability, string | null>;
}

// Creates the mutable client UI store used by the app loop and server message handlers.
export function createClientStore(): ClientStore {
  return {
    latestSnapshot: null,
    builderState: null,
    builderOpen: false,
    hudMinimized: false,
    fpsVisible: false,
    toasts: [],
    selectedModuleHardpoints: {
      weapon: null,
      mining: null,
      support: null
    }
  };
}
