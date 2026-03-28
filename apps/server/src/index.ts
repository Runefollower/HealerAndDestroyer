import { loadServerConfig } from "./config.js";
import { GameServer } from "./gameServer.js";
import { createLogger } from "./logger.js";

const logger = createLogger("server");
const config = loadServerConfig();
const server = new GameServer(config);

server.start().then(() => {
  logger.info("Healer and Destroyer server listening", { port: config.port, tickRateHz: config.tickRateHz, snapshotRateHz: config.snapshotRateHz });
});
