import { loadServerConfig } from "./config.js";
import { GameServer } from "./gameServer.js";

const config = loadServerConfig();
const server = new GameServer(config);

server.start().then(() => {
  console.log(`Healer and Destroyer server listening on port ${config.port}`);
});

