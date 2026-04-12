import { WebSocketServer, type WebSocket } from "ws";
import { createLogger } from "./logger.js";
import type { ServerConfig } from "./config.js";
import { GameWorld } from "./simulation/gameWorld.js";

interface ClientConnection {
  // Live WebSocket used for request/response messages and periodic snapshots.
  socket: WebSocket;
  // Null until a joinWorld message associates the socket with a saved player.
  playerId: string | null;
}

const logger = createLogger("gameServer");

export class GameServer {
  // GameWorld owns all authoritative simulation and persistence state.
  readonly world: GameWorld;
  // WebSocketServer accepts browser clients on the configured port.
  private readonly wss: WebSocketServer;
  // ClientConnection records let the server broadcast by connected player id.
  private readonly clients = new Set<ClientConnection>();
  // Timer for deterministic-ish simulation ticks.
  private tickHandle?: NodeJS.Timeout;
  // Timer for client snapshot fanout, separate from simulation cadence.
  private snapshotHandle?: NodeJS.Timeout;

  // Wires the network listener to a fresh authoritative world instance.
  constructor(private readonly config: ServerConfig) {
    this.world = new GameWorld();
    this.wss = new WebSocketServer({ port: config.port });
  }

  // Initializes persistence-backed world state and begins accepting socket traffic.
  async start(): Promise<void> {
    await this.world.initialize();

    // Each socket starts anonymous and must send joinWorld before gameplay messages are honored.
    this.wss.on("connection", (socket) => {
      const connection: ClientConnection = { socket, playerId: null };
      this.clients.add(connection);

      socket.on("message", async (payload) => {
        const message = JSON.parse(payload.toString());
        // joinWorld hydrates or creates the player save before normal message handling begins.
        if (message.type === "joinWorld") {
          connection.playerId = message.playerId;
          const player = await this.world.connectPlayer(message.playerId);
          logger.info("Client connected", {
            playerId: message.playerId,
            mapId: player.spawnPoint.mapId,
            clientCount: this.clients.size
          });
          socket.send(JSON.stringify({ type: "joinedWorld", player }));
          return;
        }

        if (!connection.playerId) {
          return;
        }

        // Non-join messages are delegated to GameWorld, then any immediate responses are sent back.
        const responses = await this.world.handleMessage(connection.playerId, message);
        for (const response of responses) {
          socket.send(JSON.stringify(response));
        }
      });

      socket.on("close", async () => {
        // Disconnect persists the player's runtime state before removing the socket record.
        this.clients.delete(connection);
        if (connection.playerId) {
          await this.world.disconnectPlayer(connection.playerId);
          logger.info("Client disconnected", {
            playerId: connection.playerId,
            clientCount: this.clients.size
          });
          return;
        }

        logger.info("Anonymous client disconnected", { clientCount: this.clients.size });
      });
    });

    // Simulation and snapshot timers are intentionally independent so rendering cadence can differ from game rules.
    this.tickHandle = setInterval(() => {
      void this.tickWorld();
    }, 1000 / this.config.tickRateHz);
    this.snapshotHandle = setInterval(() => this.broadcastSnapshots(), 1000 / this.config.snapshotRateHz);
  }

  // Stops periodic work and closes the listener for tests or controlled shutdown.
  async stop(): Promise<void> {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
    }
    if (this.snapshotHandle) {
      clearInterval(this.snapshotHandle);
    }
    this.wss.close();
  }

  // Advances the simulation once and flushes queued server messages generated during the tick.
  private async tickWorld(): Promise<void> {
    await this.world.tick(1000 / this.config.tickRateHz);
    this.flushPendingMessages();
  }

  // Sends queued one-off messages such as action feedback and ship build completion notices.
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

  // Sends the current visibility-filtered snapshot to each joined player.
  private broadcastSnapshots(): void {
    for (const connection of this.clients) {
      if (!connection.playerId) {
        continue;
      }
      connection.socket.send(JSON.stringify(this.world.getSnapshot(connection.playerId)));
    }
  }
}
