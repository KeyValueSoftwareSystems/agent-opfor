import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenTracker, ZERO_USAGE } from "../src/execute/tokenTracker.js";

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

test("child tracker records to both itself and parent", () => {
  const parent = new TokenTracker();
  const child = parent.child();
  child.record({ inputTokens: 100, outputTokens: 20 });
  assert.deepStrictEqual(child.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  assert.deepStrictEqual(parent.totals, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
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
