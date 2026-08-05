/**
 * Turn-budget policy — the single home for the "when to recon / how hard to
 * push" threshold that the adaptive attacker's turn-1 directive and PACING
 * line both derive from.
 *
 * Pins the boundaries so they can't silently drift from the STEP 2 budget
 * table in attacker-adaptive.ts (budget ≥ 6 runs the full ladder incl. Recon;
 * ≤ 5 skips Recon and strikes on turn 1). Before option-3 this threshold lived
 * in ~4 places; this test guards the one that replaced them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetPolicy } from "../src/generate/generateNextTurn.js";

test("recon opener only kicks in at budget ≥ 6 (matches STEP 2 full-ladder cutoff)", () => {
  for (const b of [1, 2, 3, 4, 5]) {
    assert.equal(budgetPolicy(b).reconOpener, false, `budget ${b} should strike, not recon`);
  }
  for (const b of [6, 7, 8, 12]) {
    assert.equal(budgetPolicy(b).reconOpener, true, `budget ${b} should open with recon`);
  }
});

test("pacing tiers: short ≤ 3, tight 4–5, none ≥ 6", () => {
  assert.equal(budgetPolicy(1).pacing, "short");
  assert.equal(budgetPolicy(3).pacing, "short");
  assert.equal(budgetPolicy(4).pacing, "tight");
  assert.equal(budgetPolicy(5).pacing, "tight");
  assert.equal(budgetPolicy(6).pacing, "none");
  assert.equal(budgetPolicy(10).pacing, "none");
});

test("recon opener and 'none' pacing agree — a recon turn is never also rushed", () => {
  for (const b of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const p = budgetPolicy(b);
    if (p.reconOpener)
      assert.equal(p.pacing, "none", `budget ${b}: recon opener must not carry a PACING push`);
  }
});
