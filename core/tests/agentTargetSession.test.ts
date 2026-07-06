/**
 * End-to-end session handling for the HTTP run path (createAgentTarget -> callHttp)
 * against a real local server. Verifies the actual fetch/Headers behavior, not
 * just the pure helpers in sessionPlan.test.ts:
 *  - client-owned: the configured id is sent (body or header) every turn;
 *  - server-owned: turn 1 sends no id, the returned id is captured via the
 *    `captureSession` callback and echoed on the next turn.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { createAgentTarget } from "../src/targets/agentTarget.js";
import { setEnvProvider } from "../src/lib/env.js";

setEnvProvider(() => undefined);

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
        // Server mints its own id and returns it in body + a header + a cookie.
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "srv-header-1",
          "Set-Cookie": "sid=cookie-1; Path=/; HttpOnly",
        });
        res.end(JSON.stringify({ response: "ok", session_id: "srv-body-1" }));
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

function resetReceived(): void {
  received.length = 0;
}

test("client-owned: sends the minted id in the configured body field every turn", async () => {
  resetReceived();
  const target = createAgentTarget({
    kind: "agent",
    name: "t",
    description: "",
    type: "http-endpoint",
    endpoint: `http://localhost:${port}/chat`,
    requestFormat: "json",
    stateful: true,
    session: { send: { in: "body", name: "sessionId" } },
  });
  await target.send("hi", { sessionId: "client-abc" });
  assert.equal(received[0].body.sessionId, "client-abc");
});

test("server-owned (body): turn 1 sends nothing, returned id captured then echoed", async () => {
  resetReceived();
  const target = createAgentTarget({
    kind: "agent",
    name: "t",
    description: "",
    type: "http-endpoint",
    endpoint: `http://localhost:${port}/chat`,
    requestFormat: "json",
    stateful: true,
    session: {
      send: { in: "body", name: "sessionId" },
      receive: { in: "body", name: "session_id" },
    },
  });

  let captured: string | undefined;
  // Turn 1: driver passes no id in server mode.
  await target.send("turn1", { sessionId: undefined, captureSession: (id) => (captured = id) });
  assert.equal(received[0].body.sessionId, undefined, "turn 1 must not send an id");
  assert.equal(captured, "srv-body-1", "id captured from response body");

  // Turn 2: driver echoes the captured id.
  await target.send("turn2", { sessionId: captured });
  assert.equal(received[1].body.sessionId, "srv-body-1", "turn 2 echoes captured id");
});

test("server-owned (header): id captured from a response header", async () => {
  resetReceived();
  const target = createAgentTarget({
    kind: "agent",
    name: "t",
    description: "",
    type: "http-endpoint",
    endpoint: `http://localhost:${port}/chat`,
    requestFormat: "json",
    stateful: true,
    session: {
      send: { in: "header", name: "X-Session-Id" },
      receive: { in: "header", name: "Mcp-Session-Id" },
    },
  });
  let captured: string | undefined;
  await target.send("turn1", { sessionId: undefined, captureSession: (id) => (captured = id) });
  assert.equal(captured, "srv-header-1");

  await target.send("turn2", { sessionId: captured });
  assert.equal(received[1].sessionHeader, "srv-header-1", "turn 2 echoes id in the send header");
});

test("server-owned (set-cookie): cookie pair captured for Cookie echo", async () => {
  resetReceived();
  const target = createAgentTarget({
    kind: "agent",
    name: "t",
    description: "",
    type: "http-endpoint",
    endpoint: `http://localhost:${port}/chat`,
    requestFormat: "json",
    stateful: true,
    session: { send: { in: "header", name: "Cookie" }, receive: { in: "set-cookie", name: "sid" } },
  });
  let captured: string | undefined;
  await target.send("turn1", { sessionId: undefined, captureSession: (id) => (captured = id) });
  assert.equal(captured, "sid=cookie-1");
});
