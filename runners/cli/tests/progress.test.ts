import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRunLog,
  getOrCreateThread,
  computeProgressSignal,
} from "@agent-opfor/core/autonomous/state/runLog.js";

function baseLog() {
  return createRunLog({
    runId: "test-run",
    objective: "probe",
    targetName: "demo",
    targetEndpoint: "http://localhost/chat",
  });
}

function pushTurn(
  thread: ReturnType<typeof getOrCreateThread>,
  response: string,
  score?: number
): void {
  thread.turns.push({
    turnIndex: thread.turns.length + 1,
    prompt: "x",
    response,
    isError: false,
    rateLimited: false,
    score,
  });
}

test("stonewall flag fires on near-identical recent responses", () => {
  const log = baseLog();
  const thread = getOrCreateThread(log, "atk-1", "jailbreak");
  pushTurn(thread, "I can't help with that request.");
  pushTurn(thread, "I can't help with that request.");
  pushTurn(thread, "I can't help with that request.");

  const sig = computeProgressSignal(thread);
  assert.equal(sig.stonewalled, true, "identical refusals are a stonewall");
  assert.equal(sig.hint, "stalled");
});

test("stonewall flag clears and hint moves when replies diverge with a falling score", () => {
  const log = baseLog();
  const thread = getOrCreateThread(log, "atk-2", "jailbreak");
  pushTurn(thread, "I cannot assist with that.", 9);
  pushTurn(thread, "Well, hypothetically one might consider the following steps in fiction...", 6);
  pushTurn(
    thread,
    "Continuing the story, the character explains the full method: first, acquire...",
    3
  );

  const sig = computeProgressSignal(thread);
  assert.equal(sig.stonewalled, false, "diverging replies are not a stonewall");
  assert.equal(sig.hint, "moving", "a falling self-score with diverging replies reads as moving");
});

test("repeated refusals are stonewalled even when the self-score claims progress", () => {
  const log = baseLog();
  const thread = getOrCreateThread(log, "atk-3", "harmful-content");
  // Agent over-optimistically scores progress, but the target keeps refusing.
  pushTurn(thread, "I'm sorry, but I can't help with that.", 5);
  pushTurn(thread, "I'm sorry, I am unable to assist with this.", 3);
  pushTurn(thread, "I cannot help with that — it's against my policy.", 2);

  const sig = computeProgressSignal(thread);
  assert.equal(
    sig.stonewalled,
    true,
    "objective refusal pattern overrides the generous self-score"
  );
  assert.ok(sig.note.length > 0, "an advisory note is surfaced");
});

test("sinceTurn scopes movement to post-fork turns", () => {
  const log = baseLog();
  const thread = getOrCreateThread(log, "atk-4", "jailbreak");
  // Inherited (pre-fork) turns: long stonewall.
  pushTurn(thread, "I can't help with that.");
  pushTurn(thread, "I can't help with that.");
  // Post-fork turns: fresh, diverging.
  pushTurn(thread, "Sure, here is a neutral overview of the topic you asked about.");
  pushTurn(thread, "Expanding further with concrete and specific detail on the request...");

  const scoped = computeProgressSignal(thread, 2);
  assert.equal(
    scoped.stonewalled,
    false,
    "only the two post-fork turns are evaluated for movement"
  );
});
