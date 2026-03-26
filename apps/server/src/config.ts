export interface ServerConfig {
  port: number;
  tickRateHz: number;
  snapshotRateHz: number;
  worldId: string;
  postgresUrl?: string;
}

export function loadServerConfig(): ServerConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    tickRateHz: Number(process.env.TICK_RATE_HZ ?? 30),
    snapshotRateHz: Number(process.env.SNAPSHOT_RATE_HZ ?? 10),
    worldId: process.env.WORLD_ID ?? "world-alpha",
    postgresUrl: process.env.POSTGRES_URL
  };
}

