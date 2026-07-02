/**
 * PR11 — RunListener SPI.
 *
 * Pins the ProgressEvent → RunListener adapter: each event type routes to exactly
 * one hook with the event payload, and a listener that implements no hooks (or only
 * some) is never called with a method it lacks — dispatchProgress must not throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchProgress, notifyListeners, type RunListener } from "../src/execute/runListener.js";
import type { ProgressEvent } from "../src/execute/types.js";

function recorder() {
  const calls: Array<{ hook: string; arg: unknown }> = [];
  const listener: RunListener = {
    onEvaluatorStart: (a) => calls.push({ hook: "onEvaluatorStart", arg: a }),
    onAttackStart: (a) => calls.push({ hook: "onAttackStart", arg: a }),
    onAttackDone: (a) => calls.push({ hook: "onAttackDone", arg: a }),
    onEvaluatorDone: (a) => calls.push({ hook: "onEvaluatorDone", arg: a }),
    onRunStopped: (a) => calls.push({ hook: "onRunStopped", arg: a }),
  };
  return { listener, calls };
}

test("each ProgressEvent routes to its matching hook with the payload", () => {
  const { listener, calls } = recorder();
  const events: ProgressEvent[] = [
    { type: "evaluator_start", evaluatorId: "e1", evaluatorName: "Eval One" },
    { type: "attack_start", attackId: "a1", patternName: "pat" },
    { type: "attack_done", attackId: "a1", verdict: "FAIL" },
    { type: "evaluator_done", evaluatorId: "e1", passed: 1, failed: 2, errors: 0 },
    { type: "run_stopped", reason: "rate limited" },
  ];
  for (const e of events) dispatchProgress(listener, e);

  assert.deepStrictEqual(
    calls.map((c) => c.hook),
    ["onEvaluatorStart", "onAttackStart", "onAttackDone", "onEvaluatorDone", "onRunStopped"]
  );
  // Payload is forwarded verbatim (the discriminant `type` may ride along).
  assert.deepStrictEqual(calls[0].arg, {
    type: "evaluator_start",
    evaluatorId: "e1",
    evaluatorName: "Eval One",
  });
  assert.deepStrictEqual(calls[2].arg, { type: "attack_done", attackId: "a1", verdict: "FAIL" });
});

test("a listener implementing no hooks is a safe no-op", () => {
  const empty: RunListener = {};
  const events: ProgressEvent[] = [
    { type: "evaluator_start", evaluatorId: "e", evaluatorName: "n" },
    { type: "attack_done", attackId: "a", verdict: "PASS" },
    { type: "run_stopped", reason: "x" },
  ];
  for (const e of events) {
    assert.doesNotThrow(() => dispatchProgress(empty, e));
  }
});

test("notifyListeners isolates a throwing listener and still invokes the rest", () => {
  const seen: string[] = [];
  const bomb: RunListener = {
    onRunStart: () => {
      throw new Error("boom");
    },
  };
  const good: RunListener = {
    onRunStart: (info) => seen.push(`ok:${info.evaluatorCount}`),
  };

  // The thrower must not propagate, and the later listener must still run.
  assert.doesNotThrow(() =>
    notifyListeners([bomb, good], (l) => l.onRunStart?.({ evaluatorCount: 3 }))
  );
  assert.deepStrictEqual(seen, ["ok:3"]);
});
