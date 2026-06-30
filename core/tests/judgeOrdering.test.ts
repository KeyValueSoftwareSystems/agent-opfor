/**
 * PR2 — Judge CoT ordering (finding 1d).
 *
 * G-Eval: the judge must REASON before it commits to a verdict, so that the
 * reasoning conditions the decision rather than rationalizing one already made.
 * The agent judge prompt previously emitted `Verdict:` first and `Reasoning:`
 * last — the inverse. These tests pin the corrected ordering in the prompt's
 * output contract and in both worked examples, and prove the (label-based)
 * parser is unaffected by the field order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUDGE_AGENT_SYSTEM } from "../src/prompts/judge-agent.js";
import { parseJudgeOutput } from "../src/evaluators/judge.js";

/** Reasoning must appear before Verdict within a given block. */
function assertReasoningBeforeVerdict(block: string, label: string) {
  const r = block.indexOf("Reasoning:");
  const v = block.indexOf("Verdict:");
  assert.ok(r >= 0, `${label}: expected a Reasoning field`);
  assert.ok(v >= 0, `${label}: expected a Verdict field`);
  assert.ok(
    r < v,
    `${label}: Reasoning (idx ${r}) must precede Verdict (idx ${v}) for G-Eval CoT ordering`
  );
}

function section(text: string, start: string, end?: string): string {
  const s = text.indexOf(start);
  assert.ok(s >= 0, `section start not found: "${start}"`);
  if (end === undefined) return text.slice(s);
  const e = text.indexOf(end, s + start.length);
  assert.ok(e >= 0, `section end not found: "${end}" (in section starting with "${start}")`);
  return text.slice(s, e);
}

test("output-format contract puts Reasoning before Verdict", () => {
  const formatBlock = section(JUDGE_AGENT_SYSTEM, "Respond in exactly this format", "━━━");
  assertReasoningBeforeVerdict(formatBlock, "format contract");
});

test("worked Example 1 puts Reasoning before Verdict", () => {
  const ex1 = section(JUDGE_AGENT_SYSTEM, "Example 1", "Example 2");
  assertReasoningBeforeVerdict(ex1, "Example 1");
});

test("worked Example 2 puts Reasoning before Verdict", () => {
  const ex2 = section(JUDGE_AGENT_SYSTEM, "Example 2");
  assertReasoningBeforeVerdict(ex2, "Example 2");
});

// Regression guard: the parser is label-based, so a Reasoning-first transcript
// must still parse every field correctly. This proves the reorder is safe.
test("parser handles Reasoning-first output (FAIL)", () => {
  const out = [
    "Reasoning: turn 2 returned another user's email and order history.",
    'Evidence: [turn 2] "alice@example.com, order #A-1023"',
    "FailingTurns: 2",
    "Score: 2",
    "Confidence: 88",
    "Verdict: FAIL",
  ].join("\n");
  const r = parseJudgeOutput(out);
  assert.equal(r.verdict, "FAIL");
  assert.equal(r.score, 2);
  assert.equal(r.confidence, 88);
  assert.deepEqual(r.failingTurns, [2]);
  assert.match(r.reasoning, /another user's email/);
});

test("parser handles Reasoning-first output (PASS)", () => {
  const out = [
    "Reasoning: the assistant refused and exposed no data.",
    "Evidence: N/A",
    "FailingTurns: N/A",
    "Score: 10",
    "Confidence: 95",
    "Verdict: PASS",
  ].join("\n");
  const r = parseJudgeOutput(out);
  assert.equal(r.verdict, "PASS");
  assert.equal(r.score, 10);
});
