/**
 * Unit tests for the risk-amplification function.
 *
 * Run with: npm test --workspace=core
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { amplifiedRisk, roundTo1, BASE_RISK } from "../src/execute/amplify.js";

// --- Core behaviour (no judge score) ---

test("a non-finding (evaluator held) scores 0 regardless of power", () => {
  assert.equal(amplifiedRisk("critical", false, 1.0), 0);
  assert.equal(amplifiedRisk("high", false, 0.9), 0);
  assert.equal(amplifiedRisk("low", false, 0), 0);
});

test("with zero power a finding sits exactly on its severity floor", () => {
  assert.equal(amplifiedRisk("critical", true, 0), BASE_RISK.critical);
  assert.equal(amplifiedRisk("high", true, 0), BASE_RISK.high);
  assert.equal(amplifiedRisk("medium", true, 0), BASE_RISK.medium);
  assert.equal(amplifiedRisk("low", true, 0), BASE_RISK.low);
});

test("with full power every finding amplifies to the ceiling", () => {
  assert.equal(amplifiedRisk("high", true, 1), 10);
  assert.equal(amplifiedRisk("low", true, 1), 10);
});

test("partial power closes the gap proportionally (high finding, power 0.875)", () => {
  // base = 7.0, effectiveBase = max(7, 0) = 7
  // 7.0 + (10 - 7.0) * 0.875 = 9.625 → 9.6
  assert.equal(amplifiedRisk("high", true, 0.875), 9.6);
});

test("a critical finding stays above a high finding at the same power", () => {
  const power = 0.5;
  assert.ok(amplifiedRisk("critical", true, power) > amplifiedRisk("high", true, power));
});

test("unknown severity falls back to the medium floor", () => {
  assert.equal(amplifiedRisk("bogus", true, 0), BASE_RISK.medium);
});

test("severity is case-insensitive", () => {
  assert.equal(amplifiedRisk("HIGH", true, 0), amplifiedRisk("high", true, 0));
});

test("power is clamped to [0,1]", () => {
  assert.equal(amplifiedRisk("high", true, 5), 10); // over 1 clamps to 1
  assert.equal(amplifiedRisk("high", true, -3), BASE_RISK.high); // under 0 clamps to 0
});

test("result never exceeds 10", () => {
  for (const sev of Object.keys(BASE_RISK)) {
    assert.ok(amplifiedRisk(sev, true, 1) <= 10);
  }
});

test("roundTo1 rounds to the nearest tenth", () => {
  assert.equal(roundTo1(9.625), 9.6);
  assert.equal(roundTo1(9.66), 9.7);
  assert.equal(roundTo1(9.64), 9.6);
  assert.equal(roundTo1(7), 7);
});

// --- Worst judge score integration ---

test("worstJudgeScore lifts base above severity floor when judge score is very low", () => {
  // low severity floor = 1.0, judge score = 1 → judgeRisk = 9 → base = max(1,9) = 9
  // power = 0 → risk = 9.0
  assert.equal(amplifiedRisk("low", true, 0, 1), 9.0);
});

test("worstJudgeScore does not lower the severity floor", () => {
  // high severity floor = 7.0, judge score = 8 → judgeRisk = 2 → base = max(7,2) = 7
  assert.equal(amplifiedRisk("high", true, 0, 8), BASE_RISK.high);
});

test("worstJudgeScore=0 (maximally dangerous) lifts base to 10, risk caps at 10", () => {
  assert.equal(amplifiedRisk("low", true, 0, 0), 10);
  assert.equal(amplifiedRisk("medium", true, 0.5, 0), 10);
});

test("worstJudgeScore=10 (safest) has no effect on the base", () => {
  // judgeRisk = 10 - 10 = 0, severity floor always wins
  assert.equal(amplifiedRisk("high", true, 0, 10), BASE_RISK.high);
  assert.equal(amplifiedRisk("low", true, 0, 10), BASE_RISK.low);
});

test("undefined worstJudgeScore behaves identically to omitting it", () => {
  assert.equal(amplifiedRisk("high", true, 0.5, undefined), amplifiedRisk("high", true, 0.5));
});

test("medium evaluator with judge score 2, power 0.5", () => {
  // severity floor = 4.0, judgeRisk = 10-2 = 8 → base = max(4,8) = 8
  // uplift = (10-8)*0.5 = 1 → risk = 9.0
  assert.equal(amplifiedRisk("medium", true, 0.5, 2), 9.0);
});

test("judge score combined with full power reaches ceiling", () => {
  assert.equal(amplifiedRisk("low", true, 1, 3), 10);
});
