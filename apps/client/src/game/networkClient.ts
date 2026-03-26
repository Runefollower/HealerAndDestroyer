import type { BuilderActionMessage, ServerMessage, SnapshotMessage } from "@healer/shared";

export class NetworkClient {
  private socket: WebSocket | null = null;
  private snapshotListener: ((message: SnapshotMessage) => void) | null = null;
  private serverMessageListener: ((message: ServerMessage) => void) | null = null;

  connect(playerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket("ws://localhost:8080");
      this.socket.addEventListener("open", () => {
        this.send({ type: "joinWorld", playerId });
        resolve();
      });
      this.socket.addEventListener("error", () => reject(new Error("Failed to connect to server.")));
      this.socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        this.serverMessageListener?.(message);
        if (message.type === "snapshot") {
          this.snapshotListener?.(message);
        }
      });
    });
  }

  send(message: object): void {
    this.socket?.send(JSON.stringify(message));
  }

  onSnapshot(listener: (message: SnapshotMessage) => void): void {
    this.snapshotListener = listener;
  }

  onServerMessage(listener: (message: ServerMessage) => void): void {
    this.serverMessageListener = listener;
  }

  sendBuilderAction(message: BuilderActionMessage): void {
    this.send(message);
  }
}

