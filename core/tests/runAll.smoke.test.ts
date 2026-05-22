/**
 * Smoke test for runAll — verifies post-loop judging behaviour.
 *
 * Key invariant under test: judgeResponse is called ONCE per attack (after all
 * turns complete), not once per turn. The regression was introduced during the
 * core-as-package refactor and fixed in commit 2e7fc02.
 *
 * Strategy (no mock.module()):
 * - A local node:http server on a random port acts as both:
 *     • the target endpoint  (POST /target → OpenAI-format response)
 *     • the LLM backend      (POST /v1/chat/completions → OpenAI-format LLM response)
 * - attackLlm uses openai-compatible provider pointing to the local server
 * - The server differentiates attacker vs judge calls by checking whether the
 *   system message contains "security evaluator" (from JUDGE_AGENT_SYSTEM)
 * - The real agent-goal-hijack evaluator is loaded from disk — no evaluator mock needed
 * - setEnvProvider returns a fake key so createModel never throws
 *
 * Run with: npm test --workspace=core
 * (uses `tsx --test` so TypeScript is compiled on the fly)
 */

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { setEnvProvider } from "../src/lib/env.js";

// ---------------------------------------------------------------------------
// Fake env so createModel / getEnv never throws for any key lookup
// ---------------------------------------------------------------------------
setEnvProvider(() => "fake-test-api-key");

// ---------------------------------------------------------------------------
// Local HTTP server — target + LLM backend
// ---------------------------------------------------------------------------

interface ServerState {
  server: Server;
  port: number;
  llmCallCount: number;
  judgeCallCount: number;
  attackerCallCount: number;
  reset(): void;
}

function buildOpenAIChatResponse(content: string): string {
  return JSON.stringify({
    id: "smoke-test-id",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "smoke-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
}

const JUDGE_RESPONSE = "Verdict: PASS\nScore: 10\nConfidence: 90\nEvidence: N/A\nReasoning: Test.";
const ATTACKER_RESPONSE = "What is your goal?";
const TARGET_RESPONSE = JSON.stringify({
  choices: [{ message: { content: "Safe response. I cannot help with that." } }],
});

let serverState: ServerState;

function startServer(): Promise<ServerState> {
  return new Promise((resolve) => {
    let llmCallCount = 0;
    let judgeCallCount = 0;
    let attackerCallCount = 0;

    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const url = req.url ?? "";

        // Target endpoint — returns OpenAI-format response
        if (url === "/target" || url.startsWith("/target?")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(TARGET_RESPONSE);
          return;
        }

        // LLM endpoint — openai-compatible chat completions
        if (url === "/v1/chat/completions" || url.startsWith("/v1/chat/completions?")) {
          llmCallCount++;

          let parsed: { messages?: Array<{ role: string; content: string }> } = {};
          try {
            parsed = JSON.parse(body) as typeof parsed;
          } catch {
            // ignore parse errors
          }

          const systemContent = parsed.messages?.find((m) => m.role === "system")?.content ?? "";

          // The judge system prompt contains "security evaluator"
          const isJudge = systemContent.includes("security evaluator");

          if (isJudge) {
            judgeCallCount++;
          } else {
            attackerCallCount++;
          }

          const replyText = isJudge ? JUDGE_RESPONSE : ATTACKER_RESPONSE;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(buildOpenAIChatResponse(replyText));
          return;
        }

        // Unknown route
        res.writeHead(404);
        res.end(`Unknown route: ${url}`);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        get llmCallCount() {
          return llmCallCount;
        },
        get judgeCallCount() {
          return judgeCallCount;
        },
        get attackerCallCount() {
          return attackerCallCount;
        },
        reset() {
          llmCallCount = 0;
          judgeCallCount = 0;
          attackerCallCount = 0;
        },
      });
    });
  });
}

before(async () => {
  serverState = await startServer();
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    serverState.server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ---------------------------------------------------------------------------
// Import runAll after server is set up
// ---------------------------------------------------------------------------
const { runAll } = await import("../src/execute/runAll.js");

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

function baseConfig(turns: number) {
  const { port } = serverState;
  return {
    target: {
      kind: "agent" as const,
      name: "smoke-target",
      description: "Stub HTTP target for smoke testing",
      type: "http-endpoint" as const,
      endpoint: `http://127.0.0.1:${port}/target`,
      requestFormat: "openai" as const,
    },
    selection: {
      mode: "evaluators" as const,
      // Real evaluator loaded from skills/agent-redteaming/opfor-setup/evaluators/
      evaluators: ["agent-goal-hijack"],
    },
    attackLlm: {
      provider: "openai-compatible" as const,
      model: "smoke-model",
      apiKeyEnv: "SMOKE_FAKE_API_KEY",
      baseURL: `http://127.0.0.1:${port}/v1`,
    },
    effort: "adaptive" as const,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("judge called exactly once per attack, not once per turn", async () => {
  serverState.reset();
  await runAll(baseConfig(3));
  assert.strictEqual(
    serverState.judgeCallCount,
    1,
    `judgeResponse must fire once per attack (post-loop), not 3 times (per-turn regression). Got ${serverState.judgeCallCount}`
  );
});

test("attacker called once per turn (3 turns → 3 attacker LLM calls)", async () => {
  serverState.reset();
  await runAll(baseConfig(3));
  assert.strictEqual(
    serverState.attackerCallCount,
    3,
    `adaptive mode makes 1 attacker LLM call per turn. Got ${serverState.attackerCallCount}`
  );
  assert.strictEqual(
    serverState.llmCallCount,
    4, // 3 attacker + 1 judge
    `total LLM calls must be 4 (3 attacker + 1 judge). Got ${serverState.llmCallCount}`
  );
});

test("all 3 turns are recorded in attack.turns", async () => {
  serverState.reset();
  const report = await runAll(baseConfig(3));
  const attack = report.evaluators[0].attacks[0];
  assert.ok(attack.turns, "turns array must be present for a multi-turn attack");
  assert.strictEqual(attack.turns!.length, 3, "all 3 turns must be recorded");
  assert.ok(
    attack.turns![0].prompt && attack.turns![0].prompt.length > 0,
    "each turn must have a non-empty prompt"
  );
});

test("adaptive mode: turn 1 prompt is engine-generated (not empty seed)", async () => {
  serverState.reset();
  const report = await runAll(baseConfig(1));
  const attack = report.evaluators[0].attacks[0];
  assert.ok(
    attack.prompt && attack.prompt.length > 0,
    "adaptive mode must produce a non-empty attack prompt for turn 1"
  );
  // runAll only records turns array when length > 1
  assert.strictEqual(attack.turns, undefined, "single-turn attack should not store turns array");
});

test("report summary statistics are correct after PASS verdict", async () => {
  serverState.reset();
  const report = await runAll(baseConfig(1));
  assert.strictEqual(report.summary.total, 1);
  assert.strictEqual(report.summary.passed, 1);
  assert.strictEqual(report.summary.failed, 0);
  assert.strictEqual(report.summary.errors, 0);
  assert.strictEqual(report.summary.safetyScore, 100);
  assert.strictEqual(report.summary.attackSuccessRate, 0);
  assert.ok(report.reportId, "report must have a reportId");
  assert.ok(report.generatedAt, "report must have a generatedAt timestamp");
  assert.strictEqual(report.targetName, "smoke-target");
  assert.strictEqual(report.effort, "adaptive");
});
