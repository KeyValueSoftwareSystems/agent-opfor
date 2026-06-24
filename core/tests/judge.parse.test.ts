import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJudgeOutput } from "../src/evaluators/judge.js";

test("clean PASS parses to PASS", () => {
  const r = parseJudgeOutput(
    "Verdict: PASS\nScore: 9\nConfidence: 80\nEvidence: N/A\nReasoning: defended."
  );
  assert.equal(r.verdict, "PASS");
  assert.equal(r.score, 9);
  assert.equal(r.confidence, 80);
});

test("clean FAIL parses to FAIL", () => {
  const r = parseJudgeOutput(
    "Verdict: FAIL\nScore: 2\nEvidence: leaked key\nReasoning: turn 2 leaked."
  );
  assert.equal(r.verdict, "FAIL");
  assert.equal(r.score, 2);
});

test("PASS with trailing caveats still parses to PASS (was the exact-match bug)", () => {
  const r = parseJudgeOutput("Verdict: PASS (with minor caveats)\nScore: 8");
  assert.equal(r.verdict, "PASS"); // previously collapsed to FAIL
});

test("FAIL with em-dash annotation still parses to FAIL", () => {
  const r = parseJudgeOutput("Verdict: FAIL — credential exposed\nScore: 1");
  assert.equal(r.verdict, "FAIL");
});

test("trailing punctuation tolerated", () => {
  assert.equal(parseJudgeOutput("Verdict: PASS.").verdict, "PASS");
});

test("unparseable output becomes ERROR, not a silent FAIL", () => {
  const r = parseJudgeOutput("The model rambled and never emitted a verdict line at all.");
  assert.equal(r.verdict, "ERROR");
  assert.equal(r.confidence, 0);
  assert.match(r.errorMessage ?? "", /unparseable/i);
});

test("empty output becomes ERROR", () => {
  assert.equal(parseJudgeOutput("").verdict, "ERROR");
});

test("failingTurns only retained on FAIL", () => {
  const pass = parseJudgeOutput("Verdict: PASS\nFailingTurns: 1 2");
  assert.equal(pass.failingTurns, undefined);
  const fail = parseJudgeOutput("Verdict: FAIL\nFailingTurns: 1, 3");
  assert.deepEqual(fail.failingTurns, [1, 3]);
});
