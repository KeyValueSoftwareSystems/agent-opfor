import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupPrice, priceCandidates } from "../src/pricing/lookupPrice.js";
import { estimateRunCost, formatUsd } from "../src/pricing/estimateCost.js";
import { PRICE_TABLE, PRICE_TABLE_VERSION } from "../src/pricing/priceTable.generated.js";
import { LITELLM_PROVIDER_ALIASES } from "../src/pricing/providerAliases.js";
import type { ModelTokenUsage } from "../src/execute/tokenTracker.js";
import type { RunCost } from "../src/pricing/types.js";
import { formatCostDisplay } from "../src/report/render.js";

/** Build a token-breakdown row without repeating the boilerplate. */
function usage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  roles: string[] = ["attacker"]
): ModelTokenUsage {
  return {
    key: `${provider}:${model}`,
    provider,
    model,
    roles,
    calls: 1,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

// ---------------------------------------------------------------------------
// Vendored table sanity
// ---------------------------------------------------------------------------

test("the vendored price table is populated and versioned", () => {
  assert.ok(Object.keys(PRICE_TABLE).length > 100);
  assert.match(PRICE_TABLE_VERSION, /^litellm-[0-9a-f]{12}$/);
});

test("every table row carries a provider the alias map can accept", () => {
  const acceptable = new Set(
    Object.values(LITELLM_PROVIDER_ALIASES)
      .filter((v): v is string[] => v !== null)
      .flat()
  );
  // Extra vendors are vendored deliberately for proxy setups; the invariant is
  // that no row is unreachable *because its provider was never in the aliases*
  // for a provider that claims to support it.
  const rows = Object.values(PRICE_TABLE);
  assert.ok(rows.every((r) => typeof r.p === "string" && r.p.length > 0));
  assert.ok(rows.some((r) => acceptable.has(r.p)));
});

test("every table row has a usable input price", () => {
  for (const [key, row] of Object.entries(PRICE_TABLE)) {
    assert.equal(typeof row.i, "number", `${key} has no numeric input price`);
    assert.ok(row.i >= 0, `${key} has a negative input price`);
  }
});

// ---------------------------------------------------------------------------
// Candidate ladder
// ---------------------------------------------------------------------------

test("candidates try the provider-scoped form before the bare name", () => {
  const c = priceCandidates("azure", "gpt-4o-mini");
  assert.equal(c[0], "azure/gpt-4o-mini");
  assert.ok(c.indexOf("gpt-4o-mini") > 0);
});

test("candidates include the prefix-stripped form for vendor-prefixed names", () => {
  assert.ok(priceCandidates("anthropic", "anthropic/claude-opus-5").includes("claude-opus-5"));
});

test("candidates are deduped and empty models yield none", () => {
  const c = priceCandidates("deepseek", "deepseek-chat");
  assert.equal(new Set(c).size, c.length);
  assert.deepStrictEqual(priceCandidates("openai", "   "), []);
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

test("prices a bare direct-API model", () => {
  const r = lookupPrice("openai", "gpt-4o-mini");
  assert.ok(r);
  assert.ok(r.price.inputPerToken > 0);
  assert.equal(r.matchedKey, "gpt-4o-mini");
});

test("prices a vendor-prefixed name by stripping the prefix", () => {
  const r = lookupPrice("anthropic", "anthropic/claude-opus-5");
  assert.ok(r);
  assert.equal(r.matchedKey, "claude-opus-5");
});

test("prices a provider-scoped row when one exists", () => {
  const r = lookupPrice("groq", "llama-3.3-70b-versatile");
  assert.ok(r);
  assert.equal(r.matchedKey, "groq/llama-3.3-70b-versatile");
});

test("azure resells at its own rate, not OpenAI's", () => {
  const azure = lookupPrice("azure", "gpt-4o-mini");
  const openai = lookupPrice("openai", "gpt-4o-mini");
  assert.ok(azure && openai);
  assert.equal(azure.matchedKey, "azure/gpt-4o-mini");
  assert.notEqual(azure.price.inputPerToken, openai.price.inputPerToken);
});

test("google accepts both the direct-API and Vertex naming of a model", () => {
  const r = lookupPrice("google", "gemini-2.0-flash");
  assert.ok(r, "gemini-2.0-flash should price under the google provider");
  assert.ok(r.price.inputPerToken > 0);
});

test("a model from the wrong provider is refused rather than mispriced", () => {
  // gpt-4o exists, but not on Groq. Matching it would bill Groq usage at
  // OpenAI's rates — a confidently wrong number.
  assert.equal(lookupPrice("groq", "gpt-4o"), undefined);
});

test("an unknown model is unpriced, not free", () => {
  assert.equal(lookupPrice("openai", "totally-made-up-model-v9"), undefined);
});

test("openai-compatible skips the provider guard so proxied models still price", () => {
  const r = lookupPrice("openai-compatible", "deepseek/deepseek-v4-pro");
  assert.ok(r);
  assert.ok(r.price.inputPerToken > 0);
});

test("openai-compatible resolves a vendor-prefixed Anthropic model", () => {
  const r = lookupPrice("openai-compatible", "anthropic/claude-opus-5");
  assert.ok(r);
  assert.equal(r.matchedKey, "claude-opus-5");
});

test("the unattributed bucket does not accidentally match a row", () => {
  assert.equal(lookupPrice("unknown", "unknown"), undefined);
});

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

test("estimateRunCost returns undefined when nothing was spent", () => {
  assert.equal(estimateRunCost(undefined), undefined);
  assert.equal(estimateRunCost([]), undefined);
  assert.equal(estimateRunCost([usage("openai", "gpt-4o-mini", 0, 0)]), undefined);
});

test("cost is tokens times the published per-token rate", () => {
  const price = lookupPrice("openai", "gpt-4o-mini");
  assert.ok(price);
  const cost = estimateRunCost([usage("openai", "gpt-4o-mini", 1_000_000, 500_000)]);
  assert.ok(cost);
  const expected = 1_000_000 * price.price.inputPerToken + 500_000 * price.price.outputPerToken;
  assert.ok(Math.abs(cost.totalUsd - expected) < 1e-9);
  assert.equal(cost.byModel[0].source, "table");
  assert.equal(cost.complete, true);
  assert.deepStrictEqual(cost.unpricedModels, []);
});

test("attacker and judge are priced separately at their own rates", () => {
  const cost = estimateRunCost([
    usage("openai-compatible", "deepseek/deepseek-v4-pro", 80_000, 12_000, ["attacker"]),
    usage("anthropic", "claude-opus-5", 20_000, 3_000, ["judge"]),
  ]);
  assert.ok(cost);
  assert.equal(cost.byModel.length, 2);
  const judge = cost.byModel.find((m) => m.roles.includes("judge"));
  const attacker = cost.byModel.find((m) => m.roles.includes("attacker"));
  assert.ok(judge?.usd && attacker?.usd);
  // Opus is far pricier per token, so despite ~4x fewer tokens it dominates.
  assert.ok(judge.usd > attacker.usd);
  assert.ok(Math.abs(cost.totalUsd - (judge.usd + attacker.usd)) < 1e-9);
});

test("an unpriced model is reported, not silently counted as free", () => {
  const cost = estimateRunCost([
    usage("openai", "gpt-4o-mini", 1000, 100),
    usage("openai", "totally-made-up-model-v9", 999_999, 999_999),
  ]);
  assert.ok(cost);
  assert.equal(cost.complete, false);
  assert.deepStrictEqual(cost.unpricedModels, ["openai:totally-made-up-model-v9"]);
  const unpriced = cost.byModel.find((m) => m.model === "totally-made-up-model-v9");
  assert.equal(unpriced?.usd, undefined);
  assert.equal(unpriced?.source, "unknown");
  // The total is a lower bound: it reflects only the model we could price.
  const priced = cost.byModel.find((m) => m.model === "gpt-4o-mini");
  assert.equal(cost.totalUsd, priced?.usd);
});

test("cost records which price snapshot produced it", () => {
  const cost = estimateRunCost([usage("openai", "gpt-4o-mini", 10, 10)]);
  assert.equal(cost?.priceTableVersion, PRICE_TABLE_VERSION);
});

test("the matched table key is retained for auditability", () => {
  const cost = estimateRunCost([usage("groq", "llama-3.3-70b-versatile", 10, 10)]);
  assert.equal(cost?.byModel[0].matchedKey, "groq/llama-3.3-70b-versatile");
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

test("sub-cent runs keep enough precision not to read as free", () => {
  assert.equal(formatUsd(0), "$0.00");
  // A real per-model cost from a smoke run. Fixed decimals would show "$0.0000".
  assert.equal(formatUsd(0.0000305), "$0.00003");
  assert.equal(formatUsd(0.0000355), "$0.000036");
  assert.equal(formatUsd(0.000001), "$0.000001");
  assert.equal(formatUsd(0.0034), "$0.0034");
  assert.equal(formatUsd(0.0099), "$0.0099");
  assert.equal(formatUsd(12.3456), "$12.35");
});

test("cent-to-dime amounts keep the digit that separates one evaluator from another", () => {
  // Real per-evaluator figures from a run. At two decimals these collapse to
  // $0.04 / $0.05 / $0.06 and you can no longer see which evaluator is dearest.
  assert.equal(formatUsd(0.037), "$0.037");
  assert.equal(formatUsd(0.049), "$0.049");
  assert.equal(formatUsd(0.055), "$0.055");
});

test("a dime and up reads as plain money, not false precision", () => {
  assert.equal(formatUsd(0.1), "$0.10");
  assert.equal(formatUsd(0.177), "$0.18");
  assert.equal(formatUsd(0.25), "$0.25");
  assert.equal(formatUsd(0.999), "$1.00");
});

test("amounts too small to show are labelled, never rounded to zero", () => {
  assert.equal(formatUsd(0.0000000001), "<$0.000001");
});

test("no displayed amount collapses to a bare zero unless it is truly zero", () => {
  for (const v of [1e-9, 1e-7, 1e-6, 3.05e-5, 0.0001, 0.009, 0.5, 3.2]) {
    const s = formatUsd(v);
    assert.notEqual(s, "$0.00", `${v} rendered as $0.00`);
    assert.ok(!/^\$0\.0+$/.test(s), `${v} rendered as all-zero string ${s}`);
  }
});

// ---------------------------------------------------------------------------
// Cost display confidence
//
// Regression: totalUsd sums only *priced* models, so a run where nothing could
// be priced legitimately totals 0 — and rendering that as "$0.00" makes an
// unknown cost look free, which is the exact failure the design forbids.
// ---------------------------------------------------------------------------

/** Minimal RunCost for display tests. */
function runCost(totalUsd: number, unpriced: string[]): RunCost {
  return {
    totalUsd,
    currency: "USD",
    byModel: [],
    unpricedModels: unpriced,
    complete: unpriced.length === 0,
    priceTableVersion: PRICE_TABLE_VERSION,
  };
}

test("a fully-priced run reads as an estimate", () => {
  assert.equal(formatCostDisplay(runCost(1.25, [])), "$1.25");
});

test("a partially-priced run reads as a floor, not an estimate", () => {
  assert.equal(formatCostDisplay(runCost(1.25, ["openai:mystery"])), "≥$1.25");
});

test("a run where nothing could be priced never renders as $0.00", () => {
  const display = formatCostDisplay(runCost(0, ["openai:mystery"]));
  assert.equal(display, "unpriced");
  assert.ok(!display.includes("0.00"), "unknown cost must not look free");
});

test("a genuinely free run is still allowed to show zero", () => {
  // Everything priced, everything free (e.g. a self-hosted model at $0).
  assert.equal(formatCostDisplay(runCost(0, [])), "$0.00");
});
