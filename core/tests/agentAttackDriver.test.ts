/**
 * AgentAttackDriver resume characterization.
 *
 * The extension threads a prior transcript back in via `initialHistory` to
 * resume a paused run. These pin the seeding behavior: turns already in the
 * resumed transcript are reported in the final result, and a run resumed at its
 * last turn judges that transcript instead of reporting "no turns completed".
 *
 * Both cases run zero *new* turns (startTurn > totalTurns), so finalize() is the
 * only work: a fake target + a local judge server exercise it without an
 * attacker LLM or a real agent target.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { setEnvProvider } from "../src/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

interface ServerState {
  server: Server;
  port: number;
}

let srv: ServerState;

// Agent judge output is line-based (Verdict/Score/Confidence/Evidence/Reasoning).
const JUDGE_PASS = "Verdict: PASS\nScore: 10\nConfidence: 90\nEvidence: N/A\nReasoning: safe.";

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

before(async () => {
  srv = await new Promise<ServerState>((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        if ((req.url ?? "").startsWith("/v1/chat/completions")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(chatCompletion(JUDGE_PASS));
          return;
        }
        res.writeHead(404);
        res.end("no");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ server, port });
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    srv.server.close((e) => (e ? reject(e) : resolve()))
  );
});

const { runAgentAttack } = await import("../src/execute/runAgentLoop.js");
const { createModel } = await import("../src/providers/factory.js");
type FakeTarget = Parameters<typeof runAgentAttack>[5];

/** Target whose send() must never be called (these resumes run zero new turns). */
function fakeTarget(): FakeTarget {
  return {
    async send() {
      throw new Error("send() should not run when resuming at/after the last turn");
    },
    async close() {},
  };
}

function judgeModel() {
  return createModel({
    provider: "openai-compatible" as const,
    model: "m",
    apiKeyEnv: "K",
    baseURL: `http://127.0.0.1:${srv.port}/v1`,
  });
}

function agentAttack(turns: number) {
  return {
    kind: "agent" as const,
    id: "att-1",
    evaluatorId: "e1",
    evaluatorName: "Eval",
    severity: "high",
    patternName: "pattern",
    passCriteria: "defended",
    failCriteria: "leaked",
    prompt: "seed prompt",
    turns,
  };
}

test("resume at the last turn judges the transcript instead of reporting no turns", async () => {
  const model = judgeModel();
  const result = await runAgentAttack(agentAttack(1), model, model, "0", [], fakeTarget(), {
    initialHistory: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "I can't help with that." },
    ],
  });
  // Before the fix this errored with "no turns completed" (turns[] was empty on
  // resume); now the seeded turn is judged.
  assert.strictEqual(result.judge.verdict, "PASS");
});

test("resume reports the full pre-resume transcript in turns[]", async () => {
  const model = judgeModel();
  const result = await runAgentAttack(agentAttack(2), model, model, "0", [], fakeTarget(), {
    initialHistory: [
      { role: "user", content: "turn 1 q" },
      { role: "assistant", content: "turn 1 a" },
      { role: "user", content: "turn 2 q" },
      { role: "assistant", content: "turn 2 a" },
    ],
  });
  assert.strictEqual(result.kind, "agent");
  // Both completed turns are seeded and reported, not dropped.
  assert.strictEqual(result.turns?.length, 2);
  assert.strictEqual(result.turns?.[0]?.turnIndex, 1);
  assert.strictEqual(result.turns?.[1]?.turnIndex, 2);
});
