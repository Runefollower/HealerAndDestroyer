import { WebSocket, WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { createLogger } from "./logger.js";
import type { ServerConfig } from "./config.js";
import { GameWorld } from "./simulation/gameWorld.js";

interface ClientConnection {
  // Live WebSocket used for request/response messages and periodic snapshots.
  socket: WebSocket;
  // Null until a joinWorld message has finished associating the socket with a saved player.
  playerId: string | null;
  // True while joinWorld is still loading the player, so gameplay messages are dropped instead of failing.
  joining: boolean;
  // Count of rejected messages, used to keep a misbehaving client from flooding the log.
  rejectedMessages: number;
}

const logger = createLogger("gameServer");
// Only the first few rejected messages per socket are logged; later ones are counted silently.
const maxLoggedRejectionsPerConnection = 5;

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
  // Prevents a slow async tick from overlapping the next interval callback.
  private tickInFlight = false;

  // Wires the network listener to a fresh authoritative world instance.
  constructor(private readonly config: ServerConfig, world: GameWorld = new GameWorld()) {
    this.world = world;
    this.wss = new WebSocketServer({ port: config.port });
    // Listener-level errors (e.g. port in use) are logged instead of crashing as an unhandled 'error' event.
    this.wss.on("error", (error) => {
      logger.error("WebSocket server error", { error: describeError(error) });
    });
  }

  // Port the listener is bound to; useful when the config requested an ephemeral port (0).
  get port(): number {
    return (this.wss.address() as AddressInfo).port;
  }

  // Initializes persistence-backed world state and begins accepting socket traffic.
  async start(): Promise<void> {
    await this.world.initialize();

    // Each socket starts anonymous and must send joinWorld before gameplay messages are honored.
    this.wss.on("connection", (socket) => {
      const connection: ClientConnection = { socket, playerId: null, joining: false, rejectedMessages: 0 };
      this.clients.add(connection);

      // Without an 'error' listener, a socket-level error (bad frame, reset) is thrown and kills the process.
      socket.on("error", (error) => {
        logger.warn("Client socket error", { playerId: connection.playerId, error: describeError(error) });
      });

      socket.on("message", (payload) => {
        // Every message is handled inside a catch so one bad payload can never become an unhandled rejection.
        this.handleSocketMessage(connection, payload.toString()).catch((error) => {
          this.logRejectedMessage(connection, error);
        });
      });

      socket.on("close", () => {
        this.handleSocketClose(connection).catch((error) => {
          logger.error("Failed to disconnect player cleanly", { playerId: connection.playerId, error: describeError(error) });
        });
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
    for (const connection of this.clients) {
      connection.socket.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  // Parses and routes one raw socket payload. Throws on malformed input; the caller logs and drops it.
  private async handleSocketMessage(connection: ClientConnection, raw: string): Promise<void> {
    const message = JSON.parse(raw) as { type?: unknown; playerId?: unknown };

    // joinWorld hydrates or creates the player save before normal message handling begins.
    if (message.type === "joinWorld") {
      await this.joinWorld(connection, message.playerId);
      return;
    }

    if (!connection.playerId) {
      return;
    }

    // Non-join messages are delegated to GameWorld, then any immediate responses are sent back.
    const responses = await this.world.handleMessage(connection.playerId, message);
    for (const response of responses) {
      sendJson(connection.socket, response);
    }
  }

  // Associates a socket with a player, replacing any older socket that is still bound to the same player.
  private async joinWorld(connection: ClientConnection, rawPlayerId: unknown): Promise<void> {
    if (typeof rawPlayerId !== "string" || rawPlayerId.length === 0) {
      throw new Error("joinWorld requires a non-empty playerId");
    }
    if (connection.playerId || connection.joining) {
      // A socket joins once; repeat joins are ignored rather than spawning duplicate runtime ships.
      return;
    }

    connection.joining = true;
    try {
      // Two live sockets for one player would leave two runtime ships and let either close event remove
      // the other's ship mid-snapshot, so the newest socket wins and the old one is detached first.
      for (const existing of this.clients) {
        if (existing !== connection && existing.playerId === rawPlayerId) {
          existing.playerId = null;
          existing.socket.close(4000, "Replaced by a newer connection");
          await this.world.disconnectPlayer(rawPlayerId);
          logger.info("Replaced existing connection for player", { playerId: rawPlayerId });
        }
      }

      const player = await this.world.connectPlayer(rawPlayerId);
      if (connection.socket.readyState !== WebSocket.OPEN) {
        // The socket closed while the save was loading; release the ship we just spawned.
        await this.world.disconnectPlayer(rawPlayerId);
        return;
      }

      // playerId is only set once the runtime ship exists, so snapshots and gameplay messages never see a half-joined player.
      connection.playerId = rawPlayerId;
      logger.info("Client connected", {
        playerId: rawPlayerId,
        mapId: player.spawnPoint.mapId,
        clientCount: this.clients.size
      });
      sendJson(connection.socket, { type: "joinedWorld", player });
    } finally {
      connection.joining = false;
    }
  }

  // Disconnect persists the player's runtime state before removing the socket record.
  private async handleSocketClose(connection: ClientConnection): Promise<void> {
    this.clients.delete(connection);
    const playerId = connection.playerId;
    connection.playerId = null;
    if (!playerId) {
      logger.info("Anonymous client disconnected", { clientCount: this.clients.size });
      return;
    }

    await this.world.disconnectPlayer(playerId);
    logger.info("Client disconnected", {
      playerId,
      clientCount: this.clients.size
    });
  }

  // Logs a dropped client message without letting a noisy client flood the server log.
  private logRejectedMessage(connection: ClientConnection, error: unknown): void {
    connection.rejectedMessages += 1;
    if (connection.rejectedMessages > maxLoggedRejectionsPerConnection) {
      return;
    }
    logger.warn("Rejected client message", {
      playerId: connection.playerId,
      rejectedMessages: connection.rejectedMessages,
      error: describeError(error),
      ...(connection.rejectedMessages === maxLoggedRejectionsPerConnection ? { note: "further rejections from this socket are not logged" } : {})
    });
  }

  // Advances the simulation once and flushes queued server messages generated during the tick.
  private async tickWorld(): Promise<void> {
    if (this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      await this.world.tick(1000 / this.config.tickRateHz);
      this.flushPendingMessages();
    } catch (error) {
      // A failed tick is logged and the next interval tries again instead of taking the server down.
      logger.error("Simulation tick failed", { error: describeError(error) });
    } finally {
      this.tickInFlight = false;
    }
  }

  // Sends queued one-off messages such as action feedback and ship build completion notices.
  private flushPendingMessages(): void {
    for (const connection of this.clients) {
      if (!connection.playerId) {
        continue;
      }

      for (const message of this.world.drainPendingMessages(connection.playerId)) {
        sendJson(connection.socket, message);
      }
    }
  }

  // Sends the current visibility-filtered snapshot to each joined player.
  private broadcastSnapshots(): void {
    for (const connection of this.clients) {
      if (!connection.playerId || connection.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      try {
        sendJson(connection.socket, this.world.getSnapshot(connection.playerId));
      } catch (error) {
        // One player's broken state must not stop snapshots for everyone else or crash the timer.
        logger.error("Failed to build snapshot", { playerId: connection.playerId, error: describeError(error) });
      }
    }
  }
}

// Sends a JSON message only while the socket is open, so late sends during close are skipped.
function sendJson(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}

// Produces a compact, log-friendly description of an unknown thrown value.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message.slice(0, 300)}`;
  }
  return String(error).slice(0, 300);
}
