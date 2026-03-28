import { loadServerConfig } from "./config.js";
import { GameServer } from "./gameServer.js";
import { createLogger, setGlobalLogLevel } from "./logger.js";

const config = loadServerConfig();
setGlobalLogLevel(config.logLevel);

const logger = createLogger("server");
const server = new GameServer(config);

logger.info("Server log level configured", {
  configuredLogLevel: config.configuredLogLevel ?? null,
  resolvedLogLevel: config.logLevel,
  envKeysChecked: ["SERVER_LOG_LEVEL", "LOG_LEVEL"]
});

if (config.configuredLogLevel && config.logLevel === "normal" && config.configuredLogLevel.trim().toLowerCase() !== "normal") {
  logger.warn("Unrecognized server log level, falling back to normal", {
    configuredLogLevel: config.configuredLogLevel,
    acceptedValues: ["normal", "verbose", "very-verbose"]
  });
}

server.start().then(() => {
  logger.info("Healer and Destroyer server listening", {
    port: config.port,
    tickRateHz: config.tickRateHz,
    snapshotRateHz: config.snapshotRateHz,
    logLevel: config.logLevel
  });
});
