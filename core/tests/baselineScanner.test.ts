/**
 * BaselineScanner chain + hardening.
 *
 * Pins the chain wiring (an empty target yields only the rug-pull baseline) and
 * the four security/robustness fixes:
 *  - rug-pull drift must NOT auto-accept the changed snapshot as the new baseline
 *    (else a second run silently PASSes — the rug pull launders itself);
 *  - an empty baseline file must not be treated as a clean "first run";
 *  - a corrupt baseline must not crash the whole run;
 *  - a resource whose content starts with "ERROR: " must not be misclassified as a
 *    read failure (the old in-band sentinel), and a genuine read failure (throw)
 *    must surface as an ERROR result.
 *
 * The rug-pull cases are LLM-free (pure hashing); the resource cases use a local
 * fake judge server. console is silenced so the scan's log burst can't race the
 * node:test worker's result channel.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setEnvProvider } from "../src/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

const { runBaselineScans } = await import("../src/execute/baselineScanner.js");

let server: Server;
let port: number;
let origLog: typeof console.log;

function chatCompletion(content: string): string {
  return JSON.stringify({
    id: "t",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

// The judge always returns PASS here; the resource tests only care that the judge
// was reached at all (not misclassified as a read error).
function judgePass(): string {
  return chatCompletion(
    JSON.stringify({
      verdict: "PASS",
      score: 10,
      confidence: 90,
      evidence: "N/A",
      reasoning: "safe",
    })
  );
}

before(async () => {
  origLog = console.log;
  console.log = () => {};
  port = await new Promise<number>((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        if ((req.url ?? "").startsWith("/v1/chat/completions")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(judgePass());
          return;
        }
        res.writeHead(404);
        res.end("no");
      });
    });
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
});

after(async () => {
  console.log = origLog;
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

// --- helpers ---------------------------------------------------------------

function emptyTarget(over: Record<string, unknown> = {}) {
  return {
    async callTool() {
      return { response: "" };
    },
    async listTools() {
      return [];
    },
    async listResources() {
      return [];
    },
    async readResource() {
      return "";
    },
    async close() {},
    ...over,
  };
}

async function tmp() {
  return mkdtemp(path.join(tmpdir(), "opfor-baseline-"));
}

function baselinePath(outputDir: string) {
  return path.join(outputDir, "baselines", "test-srv-tools.json");
}

async function seedBaseline(outputDir: string, content: string) {
  const p = baselinePath(outputDir);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

async function scan(outputDir: string, { target = emptyTarget(), tools = [] as unknown[] } = {}) {
  return runBaselineScans({
    target: target as never,
    tools: tools as never,
    judgeModelConfig: {
      provider: "openai-compatible",
      model: "m",
      apiKeyEnv: "K",
      baseURL: `http://127.0.0.1:${port}/v1`,
    },
    config: { target: { kind: "mcp", name: "test-srv", transport: "stdio" } } as never,
    outputDir,
    notify: () => {},
  });
}

const rugPull = (results: Awaited<ReturnType<typeof scan>>) =>
  results.find((r) => r.evaluatorId === "rug-pull-detection")!;
const resourceScan = (results: Awaited<ReturnType<typeof scan>>) =>
  results.find((r) => r.evaluatorId === "resource-exposure")!;

// --- chain wiring ----------------------------------------------------------

test("empty target: only the rug-pull baseline scan contributes a result", async () => {
  const dir = await tmp();
  try {
    const results = await scan(dir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(rugPull(results).attacks[0].judge.verdict, "PASS");
    assert.match(rugPull(results).attacks[0].judge.reasoning, /baseline recorded/i);
    assert.strictEqual(await readFile(baselinePath(dir), "utf8"), "[]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- rug-pull hardening ----------------------------------------------------

test("detected drift does NOT overwrite the baseline, and stays FAIL on re-run", async () => {
  const dir = await tmp();
  try {
    // Seed a baseline that differs from the current (empty) tool set → drift.
    const original = JSON.stringify(
      [{ name: "old-tool", description: "does a thing", inputSchema: null }],
      null,
      2
    );
    await seedBaseline(dir, original);

    const first = await scan(dir);
    assert.strictEqual(rugPull(first).attacks[0].judge.verdict, "FAIL");
    // The trusted baseline must be untouched — not auto-accepted as the new state.
    assert.strictEqual(await readFile(baselinePath(dir), "utf8"), original);

    // A second run keeps flagging it (sticky) instead of silently passing.
    const second = await scan(dir);
    assert.strictEqual(rugPull(second).attacks[0].judge.verdict, "FAIL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty baseline file is not treated as a clean first run", async () => {
  const dir = await tmp();
  try {
    await seedBaseline(dir, "");
    const results = await scan(dir);
    assert.strictEqual(rugPull(results).attacks[0].judge.verdict, "ERROR");
    // Fail closed: the empty file is left as-is (not silently re-recorded).
    assert.strictEqual(await readFile(baselinePath(dir), "utf8"), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt baseline file yields ERROR instead of crashing the run", async () => {
  const dir = await tmp();
  try {
    await seedBaseline(dir, "{ this is not valid json");
    const results = await scan(dir); // must not throw
    assert.strictEqual(rugPull(results).attacks[0].judge.verdict, "ERROR");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("matching baseline passes with no drift", async () => {
  const dir = await tmp();
  try {
    await seedBaseline(dir, "[]"); // matches the empty current snapshot
    const results = await scan(dir);
    assert.strictEqual(rugPull(results).attacks[0].judge.verdict, "PASS");
    assert.match(rugPull(results).attacks[0].judge.reasoning, /no drift/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- resource read hardening -----------------------------------------------

test('resource content starting with "ERROR: " is judged, not misclassified', async () => {
  const dir = await tmp();
  try {
    const target = emptyTarget({
      listResources: async () => [{ uri: "res://log", name: "log" }],
      readResource: async () => "ERROR: 500 — legitimate diagnostic log content",
    });
    const results = await scan(dir, { target });
    // Reached the judge (canned PASS) rather than being flagged as a read error.
    assert.strictEqual(resourceScan(results).attacks[0].judge.verdict, "PASS");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a genuine resource read failure (throw) surfaces as an ERROR result", async () => {
  const dir = await tmp();
  try {
    const target = emptyTarget({
      listResources: async () => [{ uri: "res://x", name: "x" }],
      readResource: async () => {
        throw new Error("connection reset");
      },
    });
    const results = await scan(dir, { target });
    const attack = resourceScan(results).attacks[0];
    assert.strictEqual(attack.judge.verdict, "ERROR");
    assert.match(attack.toolError ?? "", /connection reset/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
