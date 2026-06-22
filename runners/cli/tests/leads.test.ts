import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRunLog,
  getOrCreateThread,
  addLead,
  markLead,
  forkThread,
} from "@agent-opfor/core/autonomous/state/runLog.js";
import { BudgetGuard } from "@agent-opfor/core/autonomous/lib/budget.js";
import { SessionGate } from "@agent-opfor/core/lib/sessionGate.js";

function baseLog() {
  return createRunLog({
    runId: "r",
    objective: "probe",
    targetName: "t",
    targetEndpoint: "http://localhost/chat",
  });
}

test("addLead computes gen = fromGen+1 and dedups a re-flagged seam", () => {
  const log = baseLog();
  const a = addLead(log, {
    threadId: "atk-1",
    atTurn: 3,
    recommend: "continue",
    rationale: "wavering on refunds",
    fromGen: 0,
  });
  assert.ok(a);
  assert.equal(a!.gen, 1, "gen = fromGen + 1");
  assert.equal(a!.status, "open");

  const dup = addLead(log, {
    threadId: "atk-1",
    atTurn: 5,
    recommend: "new",
    rationale: "Wavering on REFUNDS",
    fromGen: 0,
  });
  assert.equal(dup, null, "same threadId + normalized rationale dedups");
  assert.equal(log.leads.length, 1, "duplicate not queued");

  const other = addLead(log, {
    threadId: "atk-2",
    atTurn: 1,
    recommend: "new",
    rationale: "different seam",
    fromGen: 1,
  });
  assert.equal(other!.gen, 2);
  assert.equal(log.leads.length, 2);
});

test("markLead updates status (so it leaves the open set)", () => {
  const log = baseLog();
  const lead = addLead(log, {
    threadId: "atk-1",
    atTurn: 1,
    recommend: "continue",
    rationale: "x",
  })!;
  markLead(log, lead.id, "spawned");
  assert.equal(log.leads.find((l) => l.id === lead.id)!.status, "spawned");
});

test("forkThread(atTurn) truncates inherited history/turns to the seam", () => {
  const log = baseLog();
  const parent = getOrCreateThread(log, "atk-1", "jailbreak");
  for (let i = 1; i <= 4; i++) {
    parent.turns.push({
      turnIndex: i,
      prompt: `p${i}`,
      response: `r${i}`,
      isError: false,
      rateLimited: false,
    });
    parent.history.push({ role: "user", content: `p${i}` });
    parent.history.push({ role: "assistant", content: `r${i}` });
  }
  const child = forkThread(log, "atk-1", 2)!;
  assert.equal(child.turns.length, 2, "only turns up to the seam are inherited");
  assert.equal(child.forkedFromTurn, 2);
  assert.equal(
    child.history.length,
    4,
    "history rebuilt from the 2 inherited turns (user+assistant each)"
  );
  assert.equal(child.history[3].content, "r2", "last inherited reply is from turn 2, not turn 4");
});

test("depthAllowed blocks a lead past maxDepth", () => {
  const budget = new BudgetGuard({ maxThreadTurns: 25, maxDepth: 2 });
  assert.equal(budget.depthAllowed(2), true, "gen at the cap is allowed");
  assert.equal(budget.depthAllowed(3), false, "gen past the cap is blocked");
});

test("SessionGate serializes same-threadId sends but runs distinct threadIds concurrently", async () => {
  const gate = new SessionGate();
  const order: string[] = [];
  const slow = (label: string, ms: number) =>
    gate.run("same", async () => {
      order.push(`${label}-start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${label}-end`);
    });

  // Two tasks on the SAME threadId must not interleave.
  await Promise.all([slow("A", 30), slow("B", 1)]);
  assert.deepEqual(
    order,
    ["A-start", "A-end", "B-start", "B-end"],
    "same-threadId is serialized in order"
  );

  // Distinct threadIds run concurrently (both start before either ends).
  const events: string[] = [];
  const onDistinct = (id: string) =>
    gate.run(id, async () => {
      events.push(`${id}-start`);
      await new Promise((r) => setTimeout(r, 10));
      events.push(`${id}-end`);
    });
  await Promise.all([onDistinct("x"), onDistinct("y")]);
  assert.equal(events.indexOf("x-start") < events.indexOf("y-end"), true);
  assert.equal(
    events.indexOf("y-start") < events.indexOf("x-end"),
    true,
    "distinct threadIds overlap"
  );
});
