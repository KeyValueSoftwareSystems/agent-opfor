/**
 * PR7 — TurnPlan value object.
 *
 * Pins the turn-mode defaulting + single-vs-multi turn rule that was duplicated
 * inline in runAll and runAllBrowser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnPlan } from "../src/execute/turnPlan.js";

test("explicit single turnMode forces one turn regardless of the configured count", () => {
  const plan = TurnPlan.from({ turnMode: "single", turns: 5 });
  assert.strictEqual(plan.turnMode, "single");
  assert.strictEqual(plan.effectiveTurns, 1);
});

test("explicit multi turnMode honors the configured turn count", () => {
  const plan = TurnPlan.from({ turnMode: "multi", turns: 3 });
  assert.strictEqual(plan.turnMode, "multi");
  assert.strictEqual(plan.effectiveTurns, 3);
});

test("omitted turnMode defaults to multi when more than one turn is configured", () => {
  const plan = TurnPlan.from({ turns: 3 });
  assert.strictEqual(plan.turnMode, "multi");
  assert.strictEqual(plan.effectiveTurns, 3);
});

test("omitted turnMode defaults to single when one turn is configured", () => {
  const plan = TurnPlan.from({ turns: 1 });
  assert.strictEqual(plan.turnMode, "single");
  assert.strictEqual(plan.effectiveTurns, 1);
});
