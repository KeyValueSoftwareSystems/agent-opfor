import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFindingTool } from "@opfor/core/autonomous/tools/recordFinding.js";
import { BudgetGuard } from "@opfor/core/autonomous/lib/budget.js";
import { SessionGate } from "@opfor/core/lib/sessionGate.js";
import { createRunLog, getOrCreateThread } from "@opfor/core/autonomous/state/runLog.js";
import type { RunContext } from "@opfor/core/autonomous/orchestrator/context.js";
import type { AutoOptions } from "@opfor/core/autonomous/lib/types.js";
import type { VulnClass } from "@opfor/core/autonomous/knowledge/types.js";

function ctxWith(): RunContext {
  const log = createRunLog({
    runId: "r",
    objective: "o",
    targetName: "t",
    targetEndpoint: "http://x/chat",
  });
  const thread = getOrCreateThread(log, "atk-1", "sensitive-disclosure");
  thread.turns.push({
    turnIndex: 1,
    prompt: "is it priya.nair@hotmail.com?",
    response: "Yes, that matches! priya.nair@hotmail.com is on file.",
    isError: false,
    rateLimited: false,
  });
  const vc: VulnClass = {
    id: "sensitive-disclosure",
    name: "Sensitive Information Disclosure",
    severity: "critical",
    description: "",
    failRubric: "",
    passRubric: "",
  };
  return {
    options: {} as AutoOptions,
    target: { send: async () => ({ response: "", isError: false, rateLimited: false }) },
    knowledge: { vulnClasses: [vc], personas: [], strategies: [] },
    runLog: log,
    budget: new BudgetGuard({ maxThreadTurns: 25 }),
    sessionGate: new SessionGate(),
    verifyEnabled: false,
  };
}

const baseArgs = {
  title: "Email confirmation oracle",
  severity: "critical" as const,
  threadId: "atk-1",
  confidence: 95,
  evidence: "priya.nair@hotmail.com is on file",
  reasoning: "Confirmed a real customer's email.",
  strategiesUsed: ["pretexting"],
};

test("record_finding rejects an unknown vulnClassId", async () => {
  const c = ctxWith();
  const res = await recordFindingTool(c).handler(
    { ...baseArgs, vulnClassId: "sensitive-data-disclosure" },
    {}
  );
  const out = JSON.parse((res.content[0] as { text: string }).text);
  assert.equal(out.accepted, false);
  assert.match(out.reason, /Unknown vulnClassId/);
  assert.equal(c.runLog.findings.length, 0, "nothing recorded for an invented class");
});

test("record_finding accepts a known vulnClassId with verbatim evidence", async () => {
  const c = ctxWith();
  const res = await recordFindingTool(c).handler(
    { ...baseArgs, vulnClassId: "sensitive-disclosure" },
    {}
  );
  const out = JSON.parse((res.content[0] as { text: string }).text);
  assert.equal(out.accepted, true);
  assert.equal(c.runLog.findings.length, 1);
  assert.equal(
    c.runLog.findings[0].name,
    "Sensitive Information Disclosure",
    "name resolved from the class"
  );
});
