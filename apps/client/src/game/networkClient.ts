import type { BuilderActionMessage, ServerMessage, SnapshotMessage } from "@healer/shared";

export class NetworkClient {
  // Active browser WebSocket, null until connect() succeeds.
  private socket: WebSocket | null = null;
  // Optional snapshot-only listener kept for callers that care only about world state.
  private snapshotListener: ((message: SnapshotMessage) => void) | null = null;
  // General listener receives every parsed server message.
  private serverMessageListener: ((message: ServerMessage) => void) | null = null;

  // Opens the local game server socket and sends joinWorld once the socket is ready.
  connect(playerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket("ws://localhost:8080");
      this.socket.addEventListener("open", () => {
        this.send({ type: "joinWorld", playerId });
        resolve();
      });
      this.socket.addEventListener("error", () => reject(new Error("Failed to connect to server.")));
      this.socket.addEventListener("message", (event) => {
        // Server messages are trusted through shared typing at compile time and parsed at runtime here.
        const message = JSON.parse(event.data) as ServerMessage;
        this.serverMessageListener?.(message);
        if (message.type === "snapshot") {
          this.snapshotListener?.(message);
        }
      });
    });
  }

  // Sends a raw client message object to the authoritative server.
  send(message: object): void {
    this.socket?.send(JSON.stringify(message));
  }

  // Registers a listener for snapshot messages only.
  onSnapshot(listener: (message: SnapshotMessage) => void): void {
    this.snapshotListener = listener;
  }

  // Registers a listener for all server message types.
  onServerMessage(listener: (message: ServerMessage) => void): void {
    this.serverMessageListener = listener;
  }

  // Convenience wrapper for builder actions so call sites retain the stronger shared type.
  sendBuilderAction(message: BuilderActionMessage): void {
    this.send(message);
  }
}
