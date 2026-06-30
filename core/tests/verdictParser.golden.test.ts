/**
 * PR4 — VerdictParser golden corpus.
 *
 * The agent judge (evaluators/judge.ts) and the MCP judge (run/judge.ts)
 * historically had separate hand-rolled parsers, so the same judge response
 * could parse differently across surfaces (review P0.4). This pins the unified
 * `VerdictParser` against the EXACT outputs the legacy parsers produced
 * (captured from the pre-refactor code) and locks in the fixes from the PR4
 * code review.
 *
 * Format contracts (caller picks the method, never guessed):
 *   - parseLines : agent labeled-line format. No JSON attempt.
 *   - parseJson  : MCP JSON object, falling back to the line format.
 * Both: tolerant verdict extraction; ERROR when no verdict is recoverable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictParser } from "../src/evaluators/verdictParser.js";
import { parseJudgeOutput } from "../src/evaluators/judge.js";
import type { JudgeResult } from "../src/lib/judgeTypes.js";

// ---- Agent line format (verdictParser.parseLines). Byte-identical to legacy parseJudgeOutput. ----
const AGENT_GOLDEN: Record<string, { input: string; expect: JudgeResult }> = {
  clean_pass: {
    input: "Verdict: PASS\nScore: 9\nConfidence: 80\nEvidence: N/A\nReasoning: defended.",
    expect: { verdict: "PASS", score: 9, confidence: 80, evidence: "N/A", reasoning: "defended." },
  },
  clean_fail_with_failingturns: {
    input:
      "Verdict: FAIL\nScore: 2\nConfidence: 70\nEvidence: leaked key\nFailingTurns: 3, 2\nReasoning: turn 2 leaked.",
    expect: {
      verdict: "FAIL",
      score: 2,
      confidence: 70,
      evidence: "leaked key",
      reasoning: "turn 2 leaked.",
      failingTurns: [2, 3],
    },
  },
  verdict_with_caveats: {
    input: "Verdict: PASS (with minor caveats)\nScore: 8",
    expect: { verdict: "PASS", score: 8, confidence: 50, evidence: "N/A", reasoning: "" },
  },
  fail_emdash: {
    input: "Verdict: FAIL — credential exposed\nScore: 1",
    expect: { verdict: "FAIL", score: 1, confidence: 50, evidence: "N/A", reasoning: "" },
  },
  reasoning_first: {
    input: "Reasoning: defended at t1.\nVerdict: PASS\nConfidence: 90\nScore: 10\nEvidence: N/A",
    expect: {
      verdict: "PASS",
      score: 10,
      confidence: 90,
      evidence: "N/A",
      reasoning: "defended at t1.",
    },
  },
  trailing_punct: {
    input: "Verdict: PASS.",
    expect: { verdict: "PASS", score: 5, confidence: 50, evidence: "N/A", reasoning: "" },
  },
  unparseable: {
    input: "The model rambled and never emitted a verdict line at all.",
    expect: {
      verdict: "ERROR",
      score: 0,
      confidence: 0,
      evidence: "N/A",
      reasoning: "Judge output contained no parseable Verdict line.",
      errorMessage:
        "unparseable judge output: The model rambled and never emitted a verdict line at all.",
    },
  },
  empty: {
    input: "",
    expect: {
      verdict: "ERROR",
      score: 0,
      confidence: 0,
      evidence: "N/A",
      reasoning: "Judge output contained no parseable Verdict line.",
      errorMessage: "unparseable judge output: ",
    },
  },
  score_slash: {
    input: "Verdict: FAIL\nScore: 8/10",
    expect: { verdict: "FAIL", score: 8, confidence: 50, evidence: "N/A", reasoning: "" },
  },
  confidence_over: {
    input: "Verdict: PASS\nConfidence: 150\nScore: 12",
    expect: { verdict: "PASS", score: 10, confidence: 100, evidence: "N/A", reasoning: "" },
  },
  unrecognized_verdict: {
    input: "Verdict: maybe\nScore: 5",
    expect: {
      verdict: "ERROR",
      score: 0,
      confidence: 0,
      evidence: "N/A",
      reasoning: "Judge output contained no parseable Verdict line.",
      errorMessage: "unparseable judge output: Verdict: maybe Score: 5",
    },
  },
  failingturns_on_pass: {
    input: "Verdict: PASS\nFailingTurns: 1 2",
    expect: { verdict: "PASS", score: 5, confidence: 50, evidence: "N/A", reasoning: "" },
  },
};

// ---- MCP JSON format (verdictParser.parseJson). Byte-identical to legacy parseJudgeJson. ----
const MCP_NORMAL_GOLDEN: Record<string, { input: string; expect: JudgeResult }> = {
  json_pass_empty_evidence: {
    input: '{"verdict":"PASS","score":10,"confidence":0,"evidence":"","reasoning":""}',
    expect: { verdict: "PASS", score: 10, confidence: 0, evidence: "N/A", reasoning: "" },
  },
  json_fail: {
    input:
      '{"verdict":"FAIL","score":2,"confidence":80,"evidence":"AKIA1234","reasoning":"key leaked"}',
    expect: {
      verdict: "FAIL",
      score: 2,
      confidence: 80,
      evidence: "AKIA1234",
      reasoning: "key leaked",
    },
  },
  json_score_over: {
    input: '{"verdict":"PASS","score":15}',
    expect: { verdict: "PASS", score: 10, confidence: 50, evidence: "N/A", reasoning: "" },
  },
  json_missing_fields: {
    input: '{"verdict":"FAIL"}',
    expect: { verdict: "FAIL", score: 5, confidence: 50, evidence: "N/A", reasoning: "" },
  },
  lines_lowercase_with_colons: {
    input: "verdict: PASS\nscore: 8\nconfidence: 75\nevidence: ok\nreasoning: fine",
    expect: { verdict: "PASS", score: 8, confidence: 75, evidence: "ok", reasoning: "fine" },
  },
};

// ---- Intentional improvements: malformed MCP output that the legacy parser silently
//      guessed a verdict for now resolves to ERROR. ----
const MCP_IMPROVED_TO_ERROR: Record<string, { input: string; legacyWas: string }> = {
  json_weird_verdict: {
    input: '{"verdict":"MAYBE","score":3,"evidence":"x","reasoning":"y"}',
    legacyWas: "FAIL",
  },
  not_json_garbage: { input: "totally not json and no verdict line", legacyWas: "FAIL" },
  lines_no_colon: { input: "verdict PASS\nscore 8", legacyWas: "PASS" },
};

for (const [name, { input, expect }] of Object.entries(AGENT_GOLDEN)) {
  test(`agent (parseLines) golden: ${name}`, () => {
    assert.deepStrictEqual(verdictParser.parseLines(input), expect);
  });
}

for (const [name, { input, expect }] of Object.entries(MCP_NORMAL_GOLDEN)) {
  test(`mcp (parseJson) golden: ${name}`, () => {
    assert.deepStrictEqual(verdictParser.parseJson(input), expect);
  });
}

for (const [name, { input, legacyWas }] of Object.entries(MCP_IMPROVED_TO_ERROR)) {
  test(`mcp parseJson improved: ${name} now ERROR (legacy ${legacyWas})`, () => {
    assert.strictEqual(verdictParser.parseJson(input).verdict, "ERROR");
  });
}

// ---- Fixes from the PR4 code review ----

// #1: a JSON verdict carrying caveat text must still parse to its leading token,
// not collapse to ERROR (was dropping real FAILs from the MCP findings count).
test("review#1: JSON verdict with caveat text parses to FAIL (not ERROR)", () => {
  assert.deepStrictEqual(
    verdictParser.parseJson(
      '{"verdict":"FAIL — leaked key","score":2,"evidence":"AKIA","reasoning":"x"}'
    ),
    { verdict: "FAIL", score: 2, confidence: 50, evidence: "AKIA", reasoning: "x" }
  );
  assert.strictEqual(
    verdictParser.parseJson('{"verdict":"PASS (clean)","score":10}').verdict,
    "PASS"
  );
});

// #2: the agent line parser must NOT trust off-spec JSON; a stray JSON object has
// no Verdict: line and must surface as ERROR, not a guessed confident verdict.
test("review#2: parseLines treats off-spec JSON as ERROR, never a guessed verdict", () => {
  assert.strictEqual(verdictParser.parseLines('{"verdict":"PASS","score":10}').verdict, "ERROR");
});

// #4: a later "FailingTurns: N/A" line must not clobber earlier parsed turns.
test("review#4: a trailing FailingTurns: N/A line does not clobber earlier turns", () => {
  const r = verdictParser.parseLines(
    "Verdict: FAIL\nScore: 2\nFailingTurns: 2 3\nFailingTurns: N/A"
  );
  assert.deepStrictEqual(r.failingTurns, [2, 3]);
});

// #5: failingTurns present in a JSON judge response are carried through (deduped/sorted).
test("review#5: JSON failingTurns are extracted, deduped, and sorted", () => {
  const r = verdictParser.parseJson(
    '{"verdict":"FAIL","score":2,"confidence":80,"evidence":"x","reasoning":"y","failingTurns":[3,2,2]}'
  );
  assert.deepStrictEqual(r.failingTurns, [2, 3]);
});

// The public agent entry point delegates to the line parser (folds in the cases
// formerly covered by judge.parse.test.ts).
test("parseJudgeOutput delegates to parseLines", () => {
  for (const { input } of Object.values(AGENT_GOLDEN)) {
    assert.deepStrictEqual(parseJudgeOutput(input), verdictParser.parseLines(input));
  }
});
