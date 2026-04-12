import type { LogLevel } from "./logger.js";
import { parseLogLevel } from "./logger.js";

export interface ServerConfig {
  // Port controls the WebSocket listener used by browser clients.
  port: number;
  // Tick rate controls authoritative simulation updates per second.
  tickRateHz: number;
  // Snapshot rate controls how often clients receive rendered world state.
  snapshotRateHz: number;
  // World id scopes persistence records for the active prototype world.
  worldId: string;
  // Resolved logging verbosity used by the shared logger.
  logLevel: LogLevel;
  // Raw environment value retained so startup can warn about invalid input.
  configuredLogLevel?: string;
  // Optional Postgres connection string for non-memory persistence adapters.
  postgresUrl?: string;
}

// Reads server runtime settings from the environment and applies prototype defaults.
export function loadServerConfig(): ServerConfig {
  // Prefer the server-specific setting while keeping LOG_LEVEL as a convenient fallback.
  const configuredLogLevel = process.env.SERVER_LOG_LEVEL ?? process.env.LOG_LEVEL;

  return {
    port: Number(process.env.PORT ?? 8080),
    tickRateHz: Number(process.env.TICK_RATE_HZ ?? 30),
    snapshotRateHz: Number(process.env.SNAPSHOT_RATE_HZ ?? 10),
    worldId: process.env.WORLD_ID ?? "world-alpha",
    logLevel: parseLogLevel(configuredLogLevel),
    configuredLogLevel,
    postgresUrl: process.env.POSTGRES_URL
  };
}
