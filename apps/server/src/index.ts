import { loadServerConfig } from "./config.js";
import { GameServer } from "./gameServer.js";
import { createLogger, setGlobalLogLevel } from "./logger.js";

// Startup config is loaded once so all long-lived services share the same runtime settings.
const config = loadServerConfig();
setGlobalLogLevel(config.logLevel);

// The logger and server are process-lifetime singletons for this executable entry point.
const logger = createLogger("server");
const server = new GameServer(config);

// Emit the resolved log level early so deployment issues can be diagnosed from startup logs.
logger.info("Server log level configured", {
  configuredLogLevel: config.configuredLogLevel ?? null,
  resolvedLogLevel: config.logLevel,
  envKeysChecked: ["SERVER_LOG_LEVEL", "LOG_LEVEL"]
});

// Warn when an environment value was present but did not map to a supported log level.
if (config.configuredLogLevel && config.logLevel === "normal" && config.configuredLogLevel.trim().toLowerCase() !== "normal") {
  logger.warn("Unrecognized server log level, falling back to normal", {
    configuredLogLevel: config.configuredLogLevel,
    acceptedValues: ["normal", "verbose", "very-verbose"]
  });
}

// Start the authoritative runtime and report the network/timing settings once it is ready.
server.start().then(() => {
  logger.info("Healer and Destroyer server listening", {
    port: config.port,
    tickRateHz: config.tickRateHz,
    snapshotRateHz: config.snapshotRateHz,
    logLevel: config.logLevel
  });
});
