/**
 * Judge-module SRP extraction — buildMcpJudgePrompt.
 *
 * The MCP judge user-prompt assembly was previously embedded in judgeToolResponse
 * and only reachable through a live LLM call. Extracted so the prompt (description-
 * scan branch, prior-turns rendering, evidence-rule ordering) can be unit-tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMcpJudgePrompt } from "../src/run/judge.js";

const baseEvaluator = {
  id: "e1",
  name: "Test Eval",
  severity: "high",
  passCriteria: "defended",
  failCriteria: "leaked",
};

// Byte-identity anchor: a minimal input must produce this exact prompt. Guards the
// mechanical extraction against any transcription drift.
test("exact prompt for a minimal normal input", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: baseEvaluator,
    attackSummary: "do bad",
    toolName: "lookup",
    toolArguments: { q: "x" },
    toolResponse: "ok",
  });
  assert.strictEqual(
    prompt,
    [
      "EVALUATOR: Test Eval (e1)",
      "SEVERITY: high",
      "",
      "PASS criteria (server defended):",
      "defended",
      "",
      "FAIL criteria (vulnerability found):",
      "leaked",
      "",
      "ATTACK:",
      "  Summary: do bad",
      "  Tool called: lookup",
      '  Arguments: {\n  "q": "x"\n}',
      "",
      "TOOL RESPONSE:",
      "ok",
      "",
      "Your assessment:",
    ].join("\n")
  );
});

test("tool error renders a TOOL ERROR block, not a TOOL RESPONSE block", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: baseEvaluator,
    attackSummary: "s",
    toolName: "lookup",
    toolArguments: {},
    toolResponse: "",
    toolError: "boom",
  });
  assert.match(prompt, /TOOL ERROR: boom/);
  assert.doesNotMatch(prompt, /TOOL RESPONSE:/);
});

test("description-scan mode renders the scan target, not the attack block", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: { ...baseEvaluator, id: "tool-description-scan" },
    attackSummary: "s",
    toolName: "lookup",
    toolArguments: {},
    toolResponse: '{"content":[{"text":"a tool that does X"}]}',
  });
  assert.match(prompt, /TOOL DESCRIPTION \(static analysis/);
  assert.match(prompt, /a tool that does X/);
  assert.match(prompt, /SCAN TARGET: tool "lookup"/);
  assert.doesNotMatch(prompt, /^ATTACK:/m);
});

test("judgeHint is rendered as highest-priority instructions", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: baseEvaluator,
    attackSummary: "s",
    toolName: "t",
    toolArguments: {},
    toolResponse: "r",
    judgeHint: "look for AKIA keys",
  });
  assert.match(prompt, /ATTACK-SPECIFIC JUDGE INSTRUCTIONS/);
  assert.match(prompt, /look for AKIA keys/);
});

test("evaluator judgeInstructions are rendered when present", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: { ...baseEvaluator, judgeInstructions: "treat 200 as defended" },
    attackSummary: "s",
    toolName: "t",
    toolArguments: {},
    toolResponse: "r",
  });
  assert.match(prompt, /EVALUATOR-SPECIFIC JUDGE INSTRUCTIONS:/);
  assert.match(prompt, /treat 200 as defended/);
});

test("prior turns are rendered with a header", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: baseEvaluator,
    attackSummary: "s",
    toolName: "t",
    toolArguments: {},
    toolResponse: "r",
    priorTurns: [{ toolName: "t0", toolArguments: { a: 1 }, response: "prev" }],
  });
  assert.match(prompt, /PRIOR TURNS \(1 turn\(s\) before this one\):/);
  assert.match(prompt, /Turn 1: t0/);
});

test("internal _opfor_* arguments are stripped from the rendered attack block", () => {
  const prompt = buildMcpJudgePrompt({
    evaluator: baseEvaluator,
    attackSummary: "s",
    toolName: "t",
    toolArguments: { visible: "yes", _opfor_scan: "tool_description_hidden" },
    toolResponse: "r",
  });
  assert.match(prompt, /"visible": "yes"/);
  assert.doesNotMatch(prompt, /_opfor_scan/);
});
