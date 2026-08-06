/**
 * Report rendering — transcript presence.
 *
 * An attack interrupted before its first turn completed carries no turns and an
 * empty detail card. The renderer used to emit a transcript anyway, headed
 * "1 turn" with two blank bubbles, which reads as an exchange that happened and
 * came back empty rather than as nothing having run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report/render.js";
import type { DetailCard, ReportViewModel, TurnViewModel } from "../src/report/types.js";

/** A report carrying exactly one attack result, for transcript assertions. */
function reportWith(detail: DetailCard, turns?: TurnViewModel[]): string {
  const model: ReportViewModel = {
    mode: "agent",
    reportId: "test-report",
    generatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    generatorModel: "attacker-model",
    judgeModel: "judge-model",
    target: { name: "target" },
    summary: {
      total: 1,
      passed: 0,
      failed: 0,
      errors: 1,
      safetyScore: 0,
      attackSuccessRate: 0,
    },
    evaluators: [
      {
        evaluatorId: "ev",
        evaluatorName: "Evaluator",
        severity: "critical",
        total: 1,
        passed: 0,
        failed: 0,
        errors: 1,
        passRate: 0,
        results: [
          {
            id: "a1",
            label: "Pattern",
            judge: {
              verdict: "ERROR",
              score: 0,
              confidence: 0,
              evidence: "",
              reasoning: "",
              errorMessage: "Cancelled by user",
            },
            detail,
            turns,
          },
        ],
      },
    ],
  };
  return renderReport(model);
}

const EMPTY_PROMPT: DetailCard = { kind: "prompt", prompt: "", response: "" };

// The bare class names appear in the page's stylesheet and its inline script,
// so assert on the rendered elements rather than the class alone.
const TOGGLE_BUTTON = '<button class="transcript-toggle"';
const TRANSCRIPT_WRAP = '<div class="transcript-wrap"';

test("a result with no turns and no detail renders no transcript at all", () => {
  const html = reportWith(EMPTY_PROMPT);
  assert.ok(!html.includes("Conversation Transcript"), "empty transcript must be omitted");
  assert.ok(!html.includes(TRANSCRIPT_WRAP), "the wrapper must go with it");
  assert.ok(!html.includes(TOGGLE_BUTTON), "the toggle must go with it");
  // The error itself still has to be visible — dropping the transcript must not
  // drop the reason the attack produced nothing.
  assert.ok(html.includes("Cancelled by user"));
});

test("whitespace-only content counts as empty", () => {
  const html = reportWith({ kind: "prompt", prompt: "   ", response: "\n\t" });
  assert.ok(!html.includes("Conversation Transcript"));
});

test("a single-turn result still renders its transcript", () => {
  const html = reportWith({ kind: "prompt", prompt: "attack text", response: "agent reply" });
  assert.ok(html.includes("Conversation Transcript"));
  assert.ok(html.includes(TOGGLE_BUTTON));
  assert.ok(html.includes("1 turn</span>"));
  assert.ok(html.includes("attack text") && html.includes("agent reply"));
});

test("a result with only a prompt and no response still renders", () => {
  // The target never answered, but what was sent is evidence worth showing.
  const html = reportWith({ kind: "prompt", prompt: "attack text", response: "" });
  assert.ok(html.includes("Conversation Transcript"));
  assert.ok(html.includes("attack text"));
});

test("multi-turn results are unaffected", () => {
  const turns: TurnViewModel[] = [
    { turnIndex: 1, detail: { kind: "prompt", prompt: "turn one", response: "reply one" } },
    { turnIndex: 2, detail: { kind: "prompt", prompt: "turn two", response: "reply two" } },
  ];
  const html = reportWith(EMPTY_PROMPT, turns);
  assert.ok(html.includes("Conversation Transcript"));
  assert.ok(html.includes("2 turns</span>"));
  assert.ok(html.includes("turn one") && html.includes("reply two"));
});

test("an empty MCP tool card renders no transcript", () => {
  const html = reportWith({ kind: "tool", toolName: "", args: {}, response: "" });
  assert.ok(!html.includes("Conversation Transcript"));
});

test("an MCP tool card carrying only an error still renders", () => {
  const html = reportWith({
    kind: "tool",
    toolName: "",
    args: {},
    response: "",
    error: "tool exploded",
  });
  assert.ok(html.includes("Conversation Transcript"));
  assert.ok(html.includes("tool exploded"));
});

test("an MCP tool card carrying only arguments still renders", () => {
  const html = reportWith({ kind: "tool", toolName: "", args: { q: "x" }, response: "" });
  assert.ok(html.includes("Conversation Transcript"));
});
