import type { BuilderActionMessage, ServerMessage, SnapshotMessage } from "@healer/shared";

export type ConnectionStatus = "connected" | "reconnecting" | "replaced";

// Close code the server uses when a newer socket for the same pilot takes over; reconnecting would just
// steal the session back and forth between the two sockets.
const replacedCloseCode = 4000;

// Reconnect backoff starts quickly and caps so a restarted dev server is picked up within a few seconds.
const reconnectBaseDelayMs = 1000;
const reconnectMaxDelayMs = 8000;

export class NetworkClient {
  // Active browser WebSocket, null until connect() is called.
  private socket: WebSocket | null = null;
  // Player id is remembered so reconnects rejoin as the same pilot.
  private playerId: string | null = null;
  // Consecutive failed reconnect attempts, used for exponential backoff.
  private reconnectAttempts = 0;
  // Pending reconnect timer, so only one reconnect is ever scheduled at a time.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Optional snapshot-only listener kept for callers that care only about world state.
  private snapshotListener: ((message: SnapshotMessage) => void) | null = null;
  // General listener receives every parsed server message.
  private serverMessageListener: ((message: ServerMessage) => void) | null = null;
  // Status listener lets the UI show when the server connection drops and recovers.
  private statusListener: ((status: ConnectionStatus) => void) | null = null;

  constructor(private readonly url = "ws://localhost:8080") {}

  // Opens the game server socket and resolves once the first connection is open and joinWorld is sent.
  // After that, dropped connections are retried automatically with backoff.
  connect(playerId: string): Promise<void> {
    this.playerId = playerId;
    return new Promise((resolve, reject) => {
      this.openSocket(resolve, reject);
    });
  }

  // Sends a raw client message object to the authoritative server. Messages are dropped while disconnected
  // because WebSocket.send throws in the CONNECTING state and gameplay input is resent every frame anyway.
  send(message: object): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  // Registers a listener for snapshot messages only.
  onSnapshot(listener: (message: SnapshotMessage) => void): void {
    this.snapshotListener = listener;
  }

  // Registers a listener for all server message types.
  onServerMessage(listener: (message: ServerMessage) => void): void {
    this.serverMessageListener = listener;
  }

  // Registers a listener for connection status changes.
  onConnectionStatus(listener: (status: ConnectionStatus) => void): void {
    this.statusListener = listener;
  }

  // Convenience wrapper for builder actions so call sites retain the stronger shared type.
  sendBuilderAction(message: BuilderActionMessage): void {
    this.send(message);
  }

  // Creates one socket. The first attempt settles connect(); later attempts are reconnects.
  private openSocket(onFirstOpen?: () => void, onFirstError?: (error: Error) => void): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    let opened = false;

    socket.addEventListener("open", () => {
      opened = true;
      this.reconnectAttempts = 0;
      if (this.playerId) {
        this.send({ type: "joinWorld", playerId: this.playerId });
      }
      this.statusListener?.("connected");
      onFirstOpen?.();
    });

    socket.addEventListener("error", () => {
      if (!opened && onFirstError) {
        onFirstError(new Error("Failed to connect to server."));
      }
    });

    socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        console.warn("Ignoring malformed server message");
        return;
      }
      this.serverMessageListener?.(message);
      if (message.type === "snapshot") {
        this.snapshotListener?.(message);
      }
    });

    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) {
        return;
      }
      if (event.code === replacedCloseCode) {
        this.statusListener?.("replaced");
        return;
      }
      // The very first failure is reported through connect()'s rejection instead of retrying silently.
      if (!opened && onFirstError) {
        return;
      }
      this.scheduleReconnect();
    });
  }

  // Retries the connection with exponential backoff until the server is reachable again.
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.statusListener?.("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}
