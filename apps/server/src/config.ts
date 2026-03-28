import type { LogLevel } from "./logger.js";
import { parseLogLevel } from "./logger.js";

export interface ServerConfig {
  port: number;
  tickRateHz: number;
  snapshotRateHz: number;
  worldId: string;
  logLevel: LogLevel;
  configuredLogLevel?: string;
  postgresUrl?: string;
}

export function loadServerConfig(): ServerConfig {
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
