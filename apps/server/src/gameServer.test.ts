import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { GameServer } from "./gameServer.js";

// Small helper client that records every parsed server message and close event.
class TestClient {
  readonly socket: WebSocket;
  readonly messages: Array<{ type: string; [key: string]: unknown }> = [];
  closeCode: number | null = null;

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on("message", (data) => this.messages.push(JSON.parse(data.toString())));
    this.socket.on("close", (code) => {
      this.closeCode = code;
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
  }

  send(payload: unknown): void {
    this.socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  }

  snapshotCount(): number {
    return this.messages.filter((message) => message.type === "snapshot").length;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("GameServer", () => {
  let server: GameServer | null = null;
  const clients: TestClient[] = [];

  async function startServer(): Promise<GameServer> {
    server = new GameServer({ port: 0, tickRateHz: 30, snapshotRateHz: 20, worldId: "world-alpha", logLevel: "normal" });
    await server.start();
    return server;
  }

  async function connect(playerId: string): Promise<TestClient> {
    const client = new TestClient(server!.port);
    clients.push(client);
    await client.open();
    client.send({ type: "joinWorld", playerId });
    await waitFor(() => client.messages.some((message) => message.type === "joinedWorld"));
    return client;
  }

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.socket.terminate();
    }
    await server?.stop();
    server = null;
  });

  it("survives malformed and schema-invalid client messages", async () => {
    await startServer();
    const client = await connect("pilot-bad-input");

    client.send("{not json");
    client.send({ type: "moveInput" });
    client.send({ type: "fireWeapon", weaponHardpointId: 42 });
    client.send({ type: "joinWorld" });

    const snapshotsBefore = client.snapshotCount();
    await waitFor(() => client.snapshotCount() > snapshotsBefore + 2);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("drops gameplay messages from sockets that have not joined", async () => {
    await startServer();
    const client = new TestClient(server!.port);
    clients.push(client);
    await client.open();

    client.send({ type: "moveInput", thrustForward: true, thrustReverse: false, rotateLeft: false, rotateRight: false, tick: 1 });
    const other = await connect("pilot-observer");
    const snapshotsBefore = other.snapshotCount();
    await waitFor(() => other.snapshotCount() > snapshotsBefore + 2);
    expect(client.messages).toHaveLength(0);
  });

  it("replaces an older socket for the same player without breaking snapshots", async () => {
    await startServer();
    const first = await connect("pilot-duplicate");
    const second = await connect("pilot-duplicate");

    await waitFor(() => first.closeCode !== null);
    expect(first.closeCode).toBe(4000);

    // Only one runtime ship should exist for the player after the takeover.
    const shipCount = Object.values(server!.world.runtime.maps).filter((map) => !!map.players["pilot-duplicate"]).length;
    expect(shipCount).toBe(1);

    const snapshotsBefore = second.snapshotCount();
    await waitFor(() => second.snapshotCount() > snapshotsBefore + 2);
    expect(second.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("keeps serving other players after one disconnects", async () => {
    await startServer();
    const leaving = await connect("pilot-leaving");
    const staying = await connect("pilot-staying");

    leaving.socket.close();
    await waitFor(() => leaving.closeCode !== null);

    const snapshotsBefore = staying.snapshotCount();
    await waitFor(() => staying.snapshotCount() > snapshotsBefore + 2);
    expect(Object.values(server!.world.runtime.maps).some((map) => !!map.players["pilot-leaving"])).toBe(false);
  });
});
