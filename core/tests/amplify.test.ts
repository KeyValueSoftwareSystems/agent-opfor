/**
 * Unit tests for the risk-amplification function.
 *
 * Run with: npm test --workspace=core
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { amplifiedRisk, roundTo1, BASE_RISK } from "../src/execute/amplify.js";

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
