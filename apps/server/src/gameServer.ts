import { WebSocketServer, type WebSocket } from "ws";
import { GameWorld } from "./simulation/gameWorld.js";
import type { ServerConfig } from "./config.js";

interface ClientConnection {
  socket: WebSocket;
  playerId: string | null;
}

export class GameServer {
  readonly world: GameWorld;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<ClientConnection>();
  private tickHandle?: NodeJS.Timeout;
  private snapshotHandle?: NodeJS.Timeout;

  constructor(private readonly config: ServerConfig) {
    this.world = new GameWorld();
    this.wss = new WebSocketServer({ port: config.port });
  }

  async start(): Promise<void> {
    await this.world.initialize();

    this.wss.on("connection", (socket) => {
      const connection: ClientConnection = { socket, playerId: null };
      this.clients.add(connection);

      socket.on("message", async (payload) => {
        const message = JSON.parse(payload.toString());
        if (message.type === "joinWorld") {
          connection.playerId = message.playerId;
          const player = await this.world.connectPlayer(message.playerId);
          socket.send(JSON.stringify({ type: "joinedWorld", player }));
          return;
        }

        if (!connection.playerId) {
          return;
        }

        const responses = await this.world.handleMessage(connection.playerId, message);
        for (const response of responses) {
          socket.send(JSON.stringify(response));
        }
      });

      socket.on("close", async () => {
        this.clients.delete(connection);
        if (connection.playerId) {
          await this.world.disconnectPlayer(connection.playerId);
        }
      });
    });

    this.tickHandle = setInterval(() => {
      void this.tickWorld();
    }, 1000 / this.config.tickRateHz);
    this.snapshotHandle = setInterval(() => this.broadcastSnapshots(), 1000 / this.config.snapshotRateHz);
  }

  async stop(): Promise<void> {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
    }
    if (this.snapshotHandle) {
      clearInterval(this.snapshotHandle);
    }
    this.wss.close();
  }

  private async tickWorld(): Promise<void> {
    await this.world.tick(1000 / this.config.tickRateHz);
    this.flushPendingMessages();
  }

  private flushPendingMessages(): void {
    for (const connection of this.clients) {
      if (!connection.playerId) {
        continue;
      }

      for (const message of this.world.drainPendingMessages(connection.playerId)) {
        connection.socket.send(JSON.stringify(message));
      }
    }
  }

  private broadcastSnapshots(): void {
    for (const connection of this.clients) {
      if (!connection.playerId) {
        continue;
      }
      connection.socket.send(JSON.stringify(this.world.getSnapshot(connection.playerId)));
    }
  }
}
