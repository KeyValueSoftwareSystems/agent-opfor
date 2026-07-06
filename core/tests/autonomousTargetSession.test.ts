/**
 * Session handling for the autonomous (hunt) target client over a real local
 * server. The operator owns `threadId`; for server-owned targets the client
 * must capture the target's returned id per threadId and echo it on that
 * thread's later turns, while a new threadId (a fork) starts a fresh session.
 * Also checks client/legacy body send and header-send parity.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { createTargetClient } from "../src/autonomous/target/http.js";

interface Received {
  body: Record<string, unknown>;
  sessionHeader: string | undefined;
}

let server: Server;
let port: number;
const received: Received[] = [];

before(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        received.push({ body, sessionHeader: req.headers["x-session-id"] as string | undefined });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: "ok", session_id: "srv-1" }));
      });
    });
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset(): void {
  received.length = 0;
}

test("server-owned: turn 1 sends no id, returned id is captured and echoed per threadId", async () => {
  reset();
  const client = createTargetClient({
    name: "t",
    endpoint: `http://localhost:${port}/chat`,
    mode: "stateful",
    responsePath: "response",
    session: {
      send: { in: "body", name: "sessionId" },
      receive: { in: "body", name: "session_id" },
    },
  });

  await client.send("t1-turn1", { threadId: "t1", history: [] });
  assert.equal(received[0].body.sessionId, undefined, "thread t1 turn 1 sends no id");

  await client.send("t1-turn2", { threadId: "t1", history: [] });
  assert.equal(received[1].body.sessionId, "srv-1", "t1 turn 2 echoes captured id");

  // A different threadId (fork) has no captured id yet -> fresh server session.
  await client.send("t2-turn1", { threadId: "t2", history: [] });
  assert.equal(received[2].body.sessionId, undefined, "new thread starts a fresh session");
});

test("client/legacy sessionField: threadId is sent as the body field every turn", async () => {
  reset();
  const client = createTargetClient({
    name: "t",
    endpoint: `http://localhost:${port}/chat`,
    mode: "stateful",
    responsePath: "response",
    sessionField: "sessionId",
  });

  await client.send("turn1", { threadId: "atk-1", history: [] });
  await client.send("turn2", { threadId: "atk-1", history: [] });
  assert.equal(received[0].body.sessionId, "atk-1");
  assert.equal(received[1].body.sessionId, "atk-1");
});

test("header-send parity: session id is sent in a request header", async () => {
  reset();
  const client = createTargetClient({
    name: "t",
    endpoint: `http://localhost:${port}/chat`,
    mode: "stateful",
    responsePath: "response",
    session: { send: { in: "header", name: "X-Session-Id" } },
  });

  await client.send("turn1", { threadId: "atk-9", history: [] });
  assert.equal(received[0].sessionHeader, "atk-9", "id sent in header");
  assert.equal(received[0].body.sessionId, undefined, "not duplicated into the body");
});
