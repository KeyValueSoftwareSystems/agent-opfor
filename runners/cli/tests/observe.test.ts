import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRunLog,
  getOrCreateThread,
  forkThread,
  addLead,
} from "@agent-opfor/core/autonomous/state/runLog.js";
import {
  countsLine,
  threadTreeText,
  renderForest,
} from "@agent-opfor/core/autonomous/state/observe.js";

function baseLog() {
  return createRunLog({
    runId: "r",
    objective: "probe",
    targetName: "t",
    targetEndpoint: "http://localhost/chat",
  });
}

function addTurn(thread: ReturnType<typeof getOrCreateThread>, response: string): void {
  thread.turns.push({
    turnIndex: thread.turns.length + 1,
    prompt: "p",
    response,
    isError: false,
    rateLimited: false,
  });
}

test("renderForest nests children under parents and keeps roots separate", () => {
  const text = renderForest(
    ["a", "a/f1", "a/f1/f1", "b"],
    (id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : undefined),
    (id) => id
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "a");
  assert.match(lines[1], /^[└├]─ a\/f1$/);
  assert.match(lines[2], /a\/f1\/f1$/);
  assert.equal(lines[3], "b", "second root is not indented");
});

test("threadTreeText marks confirmed-finding threads and shows lineage", () => {
  const log = baseLog();
  const root = getOrCreateThread(log, "atk-jb-1", "jailbreak");
  addTurn(root, "I can't help with that.");
  const child = forkThread(log, "atk-jb-1")!;
  addTurn(child, "Sure, here is the disallowed content...");
  log.findings.push({
    findingId: "f1",
    vulnClassId: "jailbreak",
    name: "Jailbreak",
    severity: "high",
    threadId: child.threadId,
    strategy: "fictional-framing",
    personaArc: [],
    verdict: "FAIL",
    confidence: 80,
    evidence: "Sure, here is the disallowed content",
    reasoning: "broke",
    at: new Date().toISOString(),
  });

  const tree = threadTreeText(log);
  assert.match(tree, /atk-jb-1 \[jailbreak\]/);
  assert.match(
    tree,
    /atk-jb-1\/f1 \[jailbreak\].*🔴 high/,
    "child with finding is marked critical-red with severity"
  );
});

test("countsLine tallies threads, forks, leads, findings, and depth", () => {
  const log = baseLog();
  const root = getOrCreateThread(log, "atk-1", "jailbreak");
  addTurn(root, "x");
  const child = forkThread(log, "atk-1")!;
  child.gen = 1;
  addLead(log, {
    threadId: "atk-1",
    atTurn: 1,
    recommend: "continue",
    rationale: "seam",
    fromGen: 0,
  });
  log.findings.push({
    findingId: "f1",
    vulnClassId: "jailbreak",
    name: "x",
    severity: "critical",
    threadId: child.threadId,
    strategy: "s",
    personaArc: [],
    verdict: "FAIL",
    confidence: 90,
    evidence: "e",
    reasoning: "r",
    at: new Date().toISOString(),
  });

  const line = countsLine(log);
  assert.match(line, /threads 2/);
  assert.match(line, /forks 1/);
  assert.match(line, /leads 1 \(open 1\/spawned 0\)/);
  assert.match(line, /findings 1 \(1 crit\)/);
  assert.match(line, /depth 1/);
});
