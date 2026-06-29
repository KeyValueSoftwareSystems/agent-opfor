import { test } from "node:test";
import assert from "node:assert/strict";
import { sendToTargetTool } from "@keyvaluesystems/agent-opfor-core/autonomous/tools/sendToTarget.js";
import { createTargetClient } from "@keyvaluesystems/agent-opfor-core/autonomous/target/http.js";
import { BudgetGuard } from "@keyvaluesystems/agent-opfor-core/autonomous/lib/budget.js";
import { SessionGate } from "@keyvaluesystems/agent-opfor-core/lib/sessionGate.js";
import { createRunLog } from "@keyvaluesystems/agent-opfor-core/autonomous/state/runLog.js";
import type { RunContext } from "@keyvaluesystems/agent-opfor-core/autonomous/orchestrator/context.js";
import type { HuntOptions } from "@keyvaluesystems/agent-opfor-core/autonomous/lib/types.js";

function stubFetch(reply: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  return () => (globalThis.fetch = original);
}

function ctx(): RunContext {
  const options = {
    target: { name: "t", endpoint: "http://localhost/chat", mode: "stateless" },
    objective: "probe",
    maxThreadTurns: 25,
  } as unknown as HuntOptions;
  return {
    options,
    target: createTargetClient(options.target),
    knowledge: { vulnClasses: [], personas: [], strategies: [] },
    runLog: createRunLog({
      runId: "r",
      objective: "probe",
      targetName: "t",
      targetEndpoint: "http://localhost/chat",
    }),
    budget: new BudgetGuard({ maxThreadTurns: 25 }),
    sessionGate: new SessionGate(),
    verifyEnabled: false,
  };
}

test("send_to_target records priorTurnScore against the prior turn", async () => {
  const restore = stubFetch("I can't help with that.");
  try {
    const c = ctx();
    const handler = sendToTargetTool(c).handler;

    // Turn 1 — no prior turn to score yet.
    await handler({ threadId: "atk-1", prompt: "hi", vulnClassId: "jailbreak" }, {});
    // Turn 2 — supply the self-judged score for turn 1's reply.
    await handler({ threadId: "atk-1", prompt: "again", priorTurnScore: 4 }, {});

    const thread = c.runLog.threads.get("atk-1")!;
    assert.equal(thread.turns[0].score, 4, "prior turn's score is recorded");
    assert.equal(thread.turns[1].score, undefined, "current turn has no score yet");
  } finally {
    restore();
  }
});

test("send_to_target refuses past the depth safety ceiling", async () => {
  const restore = stubFetch("ok");
  try {
    const options = {
      target: { name: "t", endpoint: "http://localhost/chat", mode: "stateless" },
      objective: "probe",
      maxThreadTurns: 2,
    } as unknown as HuntOptions;
    const c: RunContext = {
      options,
      target: createTargetClient(options.target),
      knowledge: { vulnClasses: [], personas: [], strategies: [] },
      runLog: createRunLog({
        runId: "r",
        objective: "probe",
        targetName: "t",
        targetEndpoint: "http://localhost/chat",
      }),
      budget: new BudgetGuard({ maxThreadTurns: 2 }),
      sessionGate: new SessionGate(),
      verifyEnabled: false,
    };
    const handler = sendToTargetTool(c).handler;

    await handler({ threadId: "a", prompt: "1" }, {});
    await handler({ threadId: "a", prompt: "2" }, {});
    const res = await handler({ threadId: "a", prompt: "3" }, {});

    const text = (res.content[0] as { text: string }).text;
    assert.match(text, /safety ceiling/i, "third send past the ceiling is refused");
    assert.equal(c.runLog.threads.get("a")!.turns.length, 2, "no turn recorded past the ceiling");
  } finally {
    restore();
  }
});
