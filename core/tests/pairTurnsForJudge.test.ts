/**
 * Judge-module SRP extraction — pairTurnsForJudge.
 *
 * The role-alternation pairing window was previously embedded in the ~115-line
 * judgeResponse and only reachable through a full judge LLM run. Extracted so the
 * subtle filter → step-by-2 → warn-and-fallback logic is unit-testable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pairTurnsForJudge } from "../src/evaluators/judge.js";

const FALLBACK = { user: "seed-prompt", assistant: "seed-response" };

test("pairs a clean alternating transcript", () => {
  const turns = pairTurnsForJudge(
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ],
    FALLBACK
  );
  assert.deepStrictEqual(turns, [
    { user: "u1", assistant: "a1" },
    { user: "u2", assistant: "a2" },
  ]);
});

test("undefined history falls back to the synthetic single turn", () => {
  assert.deepStrictEqual(pairTurnsForJudge(undefined, FALLBACK), [FALLBACK]);
});

test("empty history falls back", () => {
  assert.deepStrictEqual(pairTurnsForJudge([], FALLBACK), [FALLBACK]);
});

test("a single entry cannot form a pair → fallback", () => {
  assert.deepStrictEqual(pairTurnsForJudge([{ role: "user", content: "u1" }], FALLBACK), [
    FALLBACK,
  ]);
});

test("a trailing unpaired user turn is ignored", () => {
  const turns = pairTurnsForJudge(
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ],
    FALLBACK
  );
  assert.deepStrictEqual(turns, [{ user: "u1", assistant: "a1" }]);
});

test("real pairs are used, not the fallback", () => {
  const turns = pairTurnsForJudge(
    [
      { role: "user", content: "real-u" },
      { role: "assistant", content: "real-a" },
    ],
    FALLBACK
  );
  assert.deepStrictEqual(turns, [{ user: "real-u", assistant: "real-a" }]);
});
