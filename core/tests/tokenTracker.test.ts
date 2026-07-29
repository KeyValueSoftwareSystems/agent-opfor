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

test("parseUsage returns undefined for objects with unknown keys", () => {
  assert.strictEqual(
    parseUsage({ inputTokens: 100, outputTokens: 20, bogusField: "bad" }),
    undefined
  );
});
