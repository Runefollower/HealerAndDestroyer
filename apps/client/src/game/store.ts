import type { ServerMessage, SnapshotMessage } from "@healer/shared";

export type ToastTone = "info" | "warning" | "success";
export type ModuleSelectionCapability = "weapon" | "mining" | "support";
export type BuilderDraftMode = "new" | "refit";

export interface BuilderDesignDraft {
  // mode selects whether the workstation is creating a hull or refitting an existing ship.
  mode: BuilderDraftMode;
  // hullIndex and shipIndex are cycled by Prev/Next controls in the builder popup.
  hullIndex: number;
  shipIndex: number;
  // hardpointIndex selects the currently edited mount on the chosen hull.
  hardpointIndex: number;
  // selectedModules stores the chosen module id per hardpoint, with null meaning empty.
  selectedModules: Record<string, string | null>;
}

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
  // latestSnapshotReceivedAt is a performance timestamp used for render prediction.
  latestSnapshotReceivedAt: number | null;
  // builderState caches the latest server builder payload while the panel is open.
  builderState: Extract<ServerMessage, { type: "builderState" }> | null;
  // builderOpen and hudMinimized are local UI preferences, not server state.
  builderOpen: boolean;
  hudMinimized: boolean;
  // fpsVisible is toggled with 0 and controls the frame-rate overlay.
  fpsVisible: boolean;
  // builderDraft tracks local workstation choices between builderState renders.
  builderDraft: BuilderDesignDraft;
  // toasts contains transient server/client feedback messages.
  toasts: UiToast[];
  // selectedModuleHardpoints records the active hardpoint per module capability for hotkey cycling.
  selectedModuleHardpoints: Record<ModuleSelectionCapability, string | null>;
}

// Creates the mutable client UI store used by the app loop and server message handlers.
export function createClientStore(): ClientStore {
  return {
    latestSnapshot: null,
    latestSnapshotReceivedAt: null,
    builderState: null,
    builderOpen: false,
    hudMinimized: false,
    fpsVisible: false,
    builderDraft: {
      mode: "new",
      hullIndex: 0,
      shipIndex: 0,
      hardpointIndex: 0,
      selectedModules: {}
    },
    toasts: [],
    selectedModuleHardpoints: {
      weapon: null,
      mining: null,
      support: null
    }
  };
}
