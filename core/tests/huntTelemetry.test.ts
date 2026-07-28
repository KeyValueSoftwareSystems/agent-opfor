/**
 * Trace-aware testing for `opfor hunt`: per-thread trace-id minting/reuse (and fresh id per
 * fork), per-send propagation (headers + body field, with placeholder + env expansion), the
 * curator-model auth gating, and end-to-end propagation through the hunt target send path.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { TelemetryConfig } from "../src/config/types.js";
import {
  createRunLog,
  getOrCreateThread,
  forkThread,
  evidenceFoundInText,
} from "../src/autonomous/state/runLog.js";
import {
  resolveThreadTraceId,
  buildSendPropagation,
  buildCuratorModel,
  telemetryCapabilities,
  selectPrimaryTurn,
  probeTraceRoundTrip,
  fetchThreadTrace,
  traceCacheKey,
  type TraceCache,
} from "../src/autonomous/lib/telemetry.js";
import { parseTelemetry } from "../src/config/schema.js";
import { createTargetClient, type TargetClient } from "../src/autonomous/target/http.js";

const HEX32 = /^[0-9a-f]{32}$/;

function runLog() {
  return createRunLog({
    runId: "run-1",
    objective: "obj",
    targetName: "t",
    targetEndpoint: "http://localhost",
  });
}

const withHeaderProp: TelemetryConfig = {
  provider: "netra",
  propagation: { headers: { "x-trace-id": "{{traceId}}" }, traceIdStrategy: "per-attack" },
};

test("resolveThreadTraceId: undefined when no propagation configured", () => {
  const log = runLog();
  const thread = getOrCreateThread(log, "a");
  assert.equal(resolveThreadTraceId({ provider: "netra" }, log, thread), undefined);
  assert.equal(resolveThreadTraceId(undefined, log, thread), undefined);
});

test("resolveThreadTraceId: per-attack mints once per thread and reuses across turns", () => {
  const log = runLog();
  const thread = getOrCreateThread(log, "a");
  const first = resolveThreadTraceId(withHeaderProp, log, thread);
  const second = resolveThreadTraceId(withHeaderProp, log, thread);
  assert.match(first!, HEX32);
  assert.equal(first, second, "same thread reuses its trace id across sends");
  assert.equal(thread.traceId, first);
});

test("resolveThreadTraceId: a fork gets a fresh id (new session)", () => {
  const log = runLog();
  const parent = getOrCreateThread(log, "a");
  // Give the parent a turn so it can be forked.
  parent.turns.push({
    turnIndex: 1,
    prompt: "p",
    response: "r",
    isError: false,
    rateLimited: false,
  });
  const parentId = resolveThreadTraceId(withHeaderProp, log, parent);
  const child = forkThread(log, "a")!;
  assert.equal(child.traceId, undefined, "fork does not inherit the parent trace id");
  const childId = resolveThreadTraceId(withHeaderProp, log, child);
  assert.match(childId!, HEX32);
  assert.notEqual(childId, parentId, "fork mints a distinct trace id");
});

test("resolveThreadTraceId: per-run shares one id across threads", () => {
  const perRun: TelemetryConfig = {
    provider: "netra",
    propagation: { headers: { "x-trace-id": "{{traceId}}" }, traceIdStrategy: "per-run" },
  };
  const log = runLog();
  const a = resolveThreadTraceId(perRun, log, getOrCreateThread(log, "a"));
  const b = resolveThreadTraceId(perRun, log, getOrCreateThread(log, "b"));
  assert.equal(a, b);
  assert.equal(log.traceId, a);
});

test("buildSendPropagation: expands {{traceId}} + ${ENV} in headers and sets the body field", () => {
  process.env.TEST_TARGET_TOKEN = "secret-xyz";
  const telemetry: TelemetryConfig = {
    provider: "netra",
    propagation: {
      headers: { "x-trace-id": "{{traceId}}", Authorization: "Bearer ${TEST_TARGET_TOKEN}" },
      traceIdBodyField: "trace_id",
    },
  };
  const prop = buildSendPropagation(telemetry, "0bf04abc0000000000000000000000ff", {
    runId: "run-1",
    attackIndex: 2,
  });
  assert.ok(prop);
  assert.equal(prop!.extraHeaders!["x-trace-id"], "0bf04abc0000000000000000000000ff");
  assert.equal(prop!.extraHeaders!["Authorization"], "Bearer secret-xyz");
  assert.equal(prop!.traceIdBodyField, "trace_id");
  delete process.env.TEST_TARGET_TOKEN;
});

test("buildSendPropagation: undefined when trace id is missing or propagation empty", () => {
  assert.equal(
    buildSendPropagation(withHeaderProp, undefined, { runId: "r", attackIndex: 1 }),
    undefined
  );
  assert.equal(
    buildSendPropagation({ provider: "netra" }, "0bf04ff", { runId: "r", attackIndex: 1 }),
    undefined
  );
});

test("buildCuratorModel: undefined without an API key or gateway", () => {
  const saved = {
    key: process.env.ANTHROPIC_API_KEY,
    base: process.env.ANTHROPIC_BASE_URL,
    token: process.env.ANTHROPIC_AUTH_TOKEN,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  assert.equal(buildCuratorModel("sonnet"), undefined);

  process.env.ANTHROPIC_API_KEY = "sk-test";
  assert.ok(buildCuratorModel("sonnet"), "builds a model when ANTHROPIC_API_KEY is set");

  // restore
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.base !== undefined) process.env.ANTHROPIC_BASE_URL = saved.base;
  if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
});

// --- Capability gating: the three legs are independent ---

test("telemetryCapabilities: undefined / none → nothing enabled", () => {
  for (const t of [undefined, { provider: "none" as const }]) {
    const caps = telemetryCapabilities(t);
    assert.deepEqual(caps, { grounding: false, propagation: false, enrichment: false });
  }
});

test("telemetryCapabilities: provider-only → grounding but not propagation/enrichment", () => {
  const caps = telemetryCapabilities({ provider: "netra" });
  assert.deepEqual(caps, { grounding: true, propagation: false, enrichment: false });
});

test("telemetryCapabilities: + propagation unlocks propagation, still no enrichment", () => {
  const caps = telemetryCapabilities(withHeaderProp);
  assert.deepEqual(caps, { grounding: true, propagation: true, enrichment: false });
});

test("telemetryCapabilities: enrichment needs BOTH propagation and enrichJudgeFromTrace", () => {
  // enrichJudgeFromTrace without propagation → no enrichment (there'd be no trace id to fetch).
  assert.equal(
    telemetryCapabilities({ provider: "netra", enrichJudgeFromTrace: true }).enrichment,
    false
  );
  const full: TelemetryConfig = { ...withHeaderProp, enrichJudgeFromTrace: true };
  assert.deepEqual(telemetryCapabilities(full), {
    grounding: true,
    propagation: true,
    enrichment: true,
  });
});

// --- parseTelemetry (shared Zod validation) ---

test("parseTelemetry: undefined for missing / none; unwraps a { telemetry } wrapper", () => {
  assert.equal(parseTelemetry(undefined), undefined);
  assert.equal(parseTelemetry({ provider: "none" }), undefined);
  const unwrapped = parseTelemetry({ telemetry: { provider: "netra" } });
  assert.equal(unwrapped?.provider, "netra");
});

test("parseTelemetry: rejects a bad provider with an actionable message", () => {
  assert.throws(() => parseTelemetry({ provider: "datadog" }), /Invalid telemetry config/);
});

test("parseTelemetry: a supplied-but-malformed block throws instead of silently disabling telemetry", () => {
  // An empty wrapped block was previously indistinguishable from "no telemetry" — it must now
  // fail validation (missing `provider`) rather than returning undefined.
  assert.throws(() => parseTelemetry({ telemetry: {} }), /Invalid telemetry config/);
  // A wrong-shaped wrapped value (e.g. a typo'd bare provider name) must also throw, not vanish.
  assert.throws(() => parseTelemetry({ telemetry: "netra" }), /Invalid telemetry config/);
});

test("parseTelemetry: accepts a valid netra block and preserves passthrough fields", () => {
  const cfg = parseTelemetry({
    provider: "netra",
    netra: { baseUrl: "http://localhost:3000", traceSelection: { lookbackHours: 24 } },
    propagation: { headers: { "x-trace-id": "{{traceId}}" }, traceIdStrategy: "per-attack" },
    enrichJudgeFromTrace: true,
  });
  assert.equal(cfg?.provider, "netra");
  assert.equal((cfg?.netra as Record<string, unknown>).baseUrl, "http://localhost:3000");
  assert.equal(cfg?.enrichJudgeFromTrace, true);
});

// --- Finding trace-id selection across a forked lineage ---

test("selectPrimaryTurn: last cited failing turn wins (inherited parent-id vs new child-id)", () => {
  const log = runLog();
  const thread = getOrCreateThread(log, "a");
  // Turn 1 was inherited from a parent fork (carries the parent's id); turn 2 is the child's own.
  thread.turns.push({
    turnIndex: 1,
    prompt: "p1",
    response: "r1",
    isError: false,
    rateLimited: false,
    traceId: "parent-id",
  });
  thread.turns.push({
    turnIndex: 2,
    prompt: "p2",
    response: "r2",
    isError: false,
    rateLimited: false,
    traceId: "child-id",
  });

  assert.equal(
    selectPrimaryTurn(thread, [1])?.traceId,
    "parent-id",
    "cite inherited turn → parent id"
  );
  assert.equal(selectPrimaryTurn(thread, [2])?.traceId, "child-id", "cite new turn → child id");
  assert.equal(selectPrimaryTurn(thread, [1, 2])?.traceId, "child-id", "last cited turn wins");
  assert.equal(selectPrimaryTurn(thread, undefined)?.traceId, "child-id", "fallback → latest turn");
});

// --- Evidence hallucination guard also matches trace text ---

test("evidenceFoundInText: verbatim (whitespace-normalized) substring match, min length", () => {
  const trace = '{ "tool": "lookup_user", "args": { "email": "victim@example.com" } }';
  assert.equal(evidenceFoundInText(trace, "victim@example.com"), true);
  assert.equal(evidenceFoundInText(trace, "  victim@example.com  "), true);
  assert.equal(evidenceFoundInText(trace, "not-in-trace"), false);
  assert.equal(evidenceFoundInText(undefined, "x"), false);
  assert.equal(evidenceFoundInText(trace, "ab"), false, "needle < 3 chars rejected");
});

// --- Preflight round-trip guard (no network) ---

test("probeTraceRoundTrip: not-detected without propagation (never touches the target)", async () => {
  let sent = false;
  const target: TargetClient = {
    send: async () => {
      sent = true;
      return { response: "", isError: false, rateLimited: false };
    },
  };
  const verdict = await probeTraceRoundTrip({ provider: "netra" }, target, "run-1");
  assert.equal(verdict, "not-detected");
  assert.equal(sent, false, "no propagation → no probe sent");
});

// --- Trace fetch cache short-circuits the backend ---

test("fetchThreadTrace: a cached trace id returns without hitting the backend", async () => {
  const log = runLog();
  const thread = getOrCreateThread(log, "a");
  thread.turns.push({
    turnIndex: 1,
    prompt: "p",
    response: "r",
    isError: false,
    rateLimited: false,
    traceId: "cached-id",
  });
  // The cache is keyed by trace id + a thread/turn anchor (a per-attack trace grows across turns,
  // and the anchor must be turn-specific, not response-text-specific, so two turns with identical
  // replies can't collide) — seed the key the same way fetchThreadTrace will look it up for turn 1.
  const cache: TraceCache = new Map([[traceCacheKey("cached-id", "a#1"), '{"span":"ok"}']]);
  const result = await fetchThreadTrace(withHeaderProp, thread, 1, cache);
  assert.equal(result.available, true);
  if (result.available) {
    assert.equal(result.traceId, "cached-id");
    assert.equal(result.traceJson, '{"span":"ok"}');
  }
});

test("fetchThreadTrace: same trace id + identical response text across turns doesn't collide", async () => {
  // Regression: a per-attack trace shares one id across all its turns, and it's common for a
  // target to reply with byte-identical text on two different turns (e.g. a repeated refusal).
  // The cache must key on the turn anchor, not the response text, or turn 2 would silently
  // receive turn 1's stale cached trace.
  const log = runLog();
  const thread = getOrCreateThread(log, "a");
  const sharedTraceId = "growing-trace";
  const repeatedResponse = "I can't help with that.";
  thread.turns.push({
    turnIndex: 1,
    prompt: "p1",
    response: repeatedResponse,
    isError: false,
    rateLimited: false,
    traceId: sharedTraceId,
  });
  thread.turns.push({
    turnIndex: 2,
    prompt: "p2",
    response: repeatedResponse,
    isError: false,
    rateLimited: false,
    traceId: sharedTraceId,
  });
  const cache: TraceCache = new Map([
    [traceCacheKey(sharedTraceId, "a#1"), '{"turn":1}'],
    [traceCacheKey(sharedTraceId, "a#2"), '{"turn":2}'],
  ]);
  const turn1 = await fetchThreadTrace(withHeaderProp, thread, 1, cache);
  const turn2 = await fetchThreadTrace(withHeaderProp, thread, 2, cache);
  assert.equal(turn1.available, true);
  assert.equal(turn2.available, true);
  if (turn1.available && turn2.available) {
    assert.equal(turn1.traceJson, '{"turn":1}');
    assert.equal(turn2.traceJson, '{"turn":2}', "turn 2 must not get turn 1's stale cached trace");
  }
});

test("fetchThreadTrace: rejects an invalid turnIndex instead of silently falling back to the thread trace id", async () => {
  const log = runLog();
  const thread = getOrCreateThread(log, "a");
  thread.traceId = "thread-level-id"; // e.g. set by a per-run propagation strategy
  thread.turns.push({
    turnIndex: 1,
    prompt: "p",
    response: "r",
    isError: false,
    rateLimited: false,
    traceId: "turn-1-id",
  });

  for (const bad of [0, -1, 1.5, 2, 999]) {
    const result = await fetchThreadTrace(withHeaderProp, thread, bad);
    assert.equal(result.available, false, `turnIndex ${bad} must be rejected`);
    if (!result.available) {
      assert.match(
        result.reason,
        /Invalid turnIndex/,
        `turnIndex ${bad} needs an actionable error`
      );
    }
  }

  // A valid index is unaffected by the new range check (cache-hit, so no network involved).
  const cache: TraceCache = new Map([[traceCacheKey("turn-1-id", "a#1"), '{"ok":true}']]);
  const ok = await fetchThreadTrace(withHeaderProp, thread, 1, cache);
  assert.equal(ok.available, true);
});

test("traceCacheKey: distinct per response anchor so a growing trace isn't served stale", () => {
  // Same trace id, different turn responses → different keys (each turn fetched fresh).
  assert.notEqual(traceCacheKey("id", "turn-1 reply"), traceCacheKey("id", "turn-2 reply"));
  // A finding and its self_check share the same anchor → same key (cache hit, no refetch).
  assert.equal(traceCacheKey("id", "reply"), traceCacheKey("id", "reply"));
  // No anchor → bare id.
  assert.equal(traceCacheKey("id"), "id");
});

// --- End-to-end: trace id reaches the target over the hunt send path ---

interface Received {
  body: Record<string, unknown>;
  traceHeader: string | undefined;
}
let server: Server;
let port: number;
const received: Received[] = [];

before(async () => {
  server = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({
        body: raw ? JSON.parse(raw) : {},
        traceHeader: req.headers["x-trace-id"] as string | undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "ok" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  received.length = 0;
});

test("hunt send path propagates the trace id via header and body field", async () => {
  const client = createTargetClient({
    name: "t",
    endpoint: `http://localhost:${port}/chat`,
    mode: "stateless",
    promptPath: "prompt",
    responsePath: "response",
  });
  await client.send("hello", {
    threadId: "a",
    history: [],
    extraHeaders: { "x-trace-id": "0bf04deadbeef00000000000000000001" },
    traceIdBodyField: "trace_id",
    traceId: "0bf04deadbeef00000000000000000001",
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].traceHeader, "0bf04deadbeef00000000000000000001");
  assert.equal(received[0].body.trace_id, "0bf04deadbeef00000000000000000001");
});
