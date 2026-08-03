import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenTracker, ZERO_USAGE, parseUsage } from "../src/execute/tokenTracker.js";

test("fresh tracker reports zero totals", () => {
  const t = new TokenTracker();
  assert.deepStrictEqual(t.totals, ZERO_USAGE);
});

test("record accumulates input and output tokens", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20 });
  t.record({ inputTokens: 50, outputTokens: 10 });
  assert.deepStrictEqual(t.totals, { inputTokens: 150, outputTokens: 30, totalTokens: 180 });
});

test("record is a no-op for undefined or missing fields", () => {
  const t = new TokenTracker();
  t.record(undefined);
  t.record({});
  t.record({ inputTokens: 10 });
  assert.deepStrictEqual(t.totals, { inputTokens: 10, outputTokens: 0, totalTokens: 10 });
});

test("record preserves explicit totalTokens when supplied", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20, totalTokens: 150 });
  assert.deepStrictEqual(t.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 150 });
});

test("record falls back to component sum when totalTokens is absent", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20 });
  assert.deepStrictEqual(t.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
});

test("record preserves mismatched totalTokens across multiple calls", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20, totalTokens: 150 });
  t.record({ inputTokens: 50, outputTokens: 10, totalTokens: 80 });
  assert.deepStrictEqual(t.totals, { inputTokens: 150, outputTokens: 30, totalTokens: 230 });
});

test("record with totalTokens only (no input/output)", () => {
  const t = new TokenTracker();
  t.record({ totalTokens: 500 });
  assert.deepStrictEqual(t.totals, { inputTokens: 0, outputTokens: 0, totalTokens: 500 });
});

test("child tracker records to both itself and parent", () => {
  const parent = new TokenTracker();
  const child = parent.child();
  child.record({ inputTokens: 100, outputTokens: 20 });
  assert.deepStrictEqual(child.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  assert.deepStrictEqual(parent.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
});

test("child tracker preserves explicit totalTokens in both parent and child", () => {
  const parent = new TokenTracker();
  const child = parent.child();
  child.record({ inputTokens: 100, outputTokens: 20, totalTokens: 150 });
  assert.deepStrictEqual(child.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 150 });
  assert.deepStrictEqual(parent.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 150 });
});

test("multiple children aggregate independently but share parent", () => {
  const parent = new TokenTracker();
  const child1 = parent.child();
  const child2 = parent.child();

  child1.record({ inputTokens: 100, outputTokens: 20 });
  child2.record({ inputTokens: 200, outputTokens: 40 });

  assert.deepStrictEqual(child1.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  assert.deepStrictEqual(child2.totals, { inputTokens: 200, outputTokens: 40, totalTokens: 240 });
  assert.deepStrictEqual(parent.totals, { inputTokens: 300, outputTokens: 60, totalTokens: 360 });
});

test("direct parent recording does not affect children", () => {
  const parent = new TokenTracker();
  const child = parent.child();
  parent.record({ inputTokens: 50, outputTokens: 10 });
  assert.deepStrictEqual(child.totals, ZERO_USAGE);
  assert.deepStrictEqual(parent.totals, { inputTokens: 50, outputTokens: 10, totalTokens: 60 });
});

// parseUsage validation tests

test("parseUsage returns valid TokenUsage for well-formed input", () => {
  const result = parseUsage({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  assert.deepStrictEqual(result, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
});

test("parseUsage fills totalTokens from components when absent", () => {
  const result = parseUsage({ inputTokens: 100, outputTokens: 20 });
  assert.deepStrictEqual(result, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
});

test("parseUsage preserves explicit totalTokens that differs from component sum", () => {
  const result = parseUsage({ inputTokens: 100, outputTokens: 20, totalTokens: 150 });
  assert.deepStrictEqual(result, { inputTokens: 100, outputTokens: 20, totalTokens: 150 });
});

test("parseUsage returns undefined for null/undefined/non-object", () => {
  assert.strictEqual(parseUsage(null), undefined);
  assert.strictEqual(parseUsage(undefined), undefined);
  assert.strictEqual(parseUsage("string"), undefined);
  assert.strictEqual(parseUsage(42), undefined);
});

test("parseUsage returns undefined for negative token counts", () => {
  assert.strictEqual(parseUsage({ inputTokens: -1, outputTokens: 20 }), undefined);
});

test("parseUsage returns undefined for non-integer token counts", () => {
  assert.strictEqual(parseUsage({ inputTokens: 1.5, outputTokens: 20 }), undefined);
});

test("parseUsage strips unknown provider metadata and returns normalized usage", () => {
  const result = parseUsage({
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 150,
    cachedTokens: 40,
    reasoningTokens: 30,
  });
  assert.deepStrictEqual(result, { inputTokens: 100, outputTokens: 20, totalTokens: 150 });
});

// ---------------------------------------------------------------------------
// Per-model attribution
// ---------------------------------------------------------------------------

const ATTACKER = { provider: "openai-compatible", model: "deepseek/deepseek-v4-pro" };
const JUDGE = { provider: "anthropic", model: "claude-opus-5" };

test("fresh tracker has an empty breakdown", () => {
  const t = new TokenTracker();
  assert.deepStrictEqual(t.breakdown, []);
});

test("usage recorded without attribution lands in the unknown bucket, not dropped", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20 });
  assert.equal(t.breakdown.length, 1);
  assert.equal(t.breakdown[0].key, "unknown");
  assert.equal(t.breakdown[0].totalTokens, 120);
  assert.deepStrictEqual(t.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
});

test("attributed usage is keyed by provider and model", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20 }, { model: ATTACKER, role: "attacker" });
  const [b] = t.breakdown;
  assert.equal(b.key, "openai-compatible:deepseek/deepseek-v4-pro");
  assert.equal(b.provider, "openai-compatible");
  assert.equal(b.model, "deepseek/deepseek-v4-pro");
  assert.deepStrictEqual(b.roles, ["attacker"]);
  assert.equal(b.calls, 1);
});

test("two models are tracked separately and still sum to run totals", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 80_000, outputTokens: 12_000 }, { model: ATTACKER, role: "attacker" });
  t.record({ inputTokens: 20_000, outputTokens: 3_000 }, { model: JUDGE, role: "judge" });

  assert.equal(t.breakdown.length, 2);
  const sum = t.breakdown.reduce((n, b) => n + b.totalTokens, 0);
  assert.equal(sum, t.totals.totalTokens);
  assert.equal(t.totals.totalTokens, 115_000);
});

test("breakdown is ordered heaviest first", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 10, outputTokens: 1 }, { model: JUDGE });
  t.record({ inputTokens: 500, outputTokens: 50 }, { model: ATTACKER });
  assert.equal(t.breakdown[0].model, "deepseek/deepseek-v4-pro");
});

test("one model used for both phases accumulates both roles, deduped and sorted", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 10, outputTokens: 2 }, { model: JUDGE, role: "judge" });
  t.record({ inputTokens: 10, outputTokens: 2 }, { model: JUDGE, role: "attacker" });
  t.record({ inputTokens: 10, outputTokens: 2 }, { model: JUDGE, role: "judge" });

  assert.equal(t.breakdown.length, 1);
  assert.deepStrictEqual(t.breakdown[0].roles, ["attacker", "judge"]);
  assert.equal(t.breakdown[0].calls, 3);
});

test("roles are normalized to lowercase so 'Judge' and 'judge' do not split", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 10, outputTokens: 2 }, { model: JUDGE, role: "Judge" });
  t.record({ inputTokens: 10, outputTokens: 2 }, { model: JUDGE, role: "judge" });
  assert.deepStrictEqual(t.breakdown[0].roles, ["judge"]);
});

test("attributed and unattributed usage coexist without losing tokens", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20 }, { model: ATTACKER, role: "attacker" });
  t.record({ inputTokens: 7, outputTokens: 3 });
  const sum = t.breakdown.reduce((n, b) => n + b.totalTokens, 0);
  assert.equal(sum, t.totals.totalTokens);
  assert.ok(t.breakdown.some((b) => b.key === "unknown"));
});

test("child tracker propagates attribution to its parent, not just totals", () => {
  const parent = new TokenTracker();
  const child = parent.child();
  child.record({ inputTokens: 100, outputTokens: 20 }, { model: JUDGE, role: "judge" });

  assert.equal(child.breakdown[0].key, "anthropic:claude-opus-5");
  assert.equal(parent.breakdown[0].key, "anthropic:claude-opus-5");
  assert.deepStrictEqual(parent.breakdown[0].roles, ["judge"]);
});

test("sibling children merge into one parent bucket per model", () => {
  const parent = new TokenTracker();
  const a = parent.child();
  const b = parent.child();
  a.record({ inputTokens: 100, outputTokens: 20 }, { model: ATTACKER, role: "attacker" });
  b.record({ inputTokens: 200, outputTokens: 40 }, { model: ATTACKER, role: "attacker" });

  assert.equal(parent.breakdown.length, 1);
  assert.equal(parent.breakdown[0].calls, 2);
  assert.equal(parent.breakdown[0].totalTokens, 360);
});

test("explicit totalTokens is preserved in the per-model bucket too", () => {
  const t = new TokenTracker();
  t.record({ inputTokens: 100, outputTokens: 20, totalTokens: 150 }, { model: JUDGE });
  assert.equal(t.breakdown[0].totalTokens, 150);
  assert.equal(t.totals.totalTokens, 150);
});
