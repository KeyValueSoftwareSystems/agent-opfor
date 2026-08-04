import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import {
  modelKey,
  rememberModelIdentity,
  resolveModelIdentity,
  UNKNOWN_MODEL_KEY,
} from "../src/providers/modelIdentity.js";
import type { LlmConfig } from "../src/config/types.js";
import { createModel } from "../src/providers/factory.js";
import { withRetry, roleFromContext } from "../src/lib/llmRetry.js";
import { TokenTracker } from "../src/execute/tokenTracker.js";

/** Stand-in for a built AI SDK model — only the fields the resolver reads. */
function fakeSdkModel(modelId: string, provider: string): LanguageModel {
  return { modelId, provider } as unknown as LanguageModel;
}

test("modelKey joins provider and model", () => {
  assert.equal(
    modelKey({ provider: "anthropic", model: "claude-opus-5" }),
    "anthropic:claude-opus-5"
  );
});

test("UNKNOWN_MODEL_KEY is distinct from any real key", () => {
  assert.notEqual(UNKNOWN_MODEL_KEY, modelKey({ provider: "openai", model: "gpt-4o-mini" }));
});

test("resolveModelIdentity returns undefined for no reference", () => {
  assert.equal(resolveModelIdentity(undefined), undefined);
});

test("resolveModelIdentity handles a bare model string with no recoverable provider", () => {
  assert.deepStrictEqual(resolveModelIdentity("gpt-4o-mini"), {
    provider: "unknown",
    model: "gpt-4o-mini",
  });
});

test("resolveModelIdentity accepts an LlmConfig directly", () => {
  const llm: LlmConfig = {
    provider: "openai-compatible",
    model: "deepseek/deepseek-v4-pro",
    apiKeyEnv: "OPFOR_API_KEY",
    baseURL: "https://llm.keyvalue.systems/v1",
  };
  assert.deepStrictEqual(resolveModelIdentity(llm), {
    provider: "openai-compatible",
    model: "deepseek/deepseek-v4-pro",
  });
});

test("resolveModelIdentity falls back to SDK fields, narrowing the dotted provider", () => {
  const m = fakeSdkModel("claude-opus-5", "anthropic.messages");
  assert.deepStrictEqual(resolveModelIdentity(m), {
    provider: "anthropic",
    model: "claude-opus-5",
  });
});

test("SDK fallback yields the lossy provider that makes the registry necessary", () => {
  // An openai-compatible model reports "custom.chat" — the configured provider
  // name is unrecoverable from the object alone. This is why createModel registers.
  const m = fakeSdkModel("deepseek/deepseek-v4-pro", "custom.chat");
  assert.equal(resolveModelIdentity(m)?.provider, "custom");
});

test("a registered identity wins over the SDK's own fields", () => {
  const m = fakeSdkModel("deepseek/deepseek-v4-pro", "custom.chat");
  rememberModelIdentity(m, {
    provider: "openai-compatible",
    model: "deepseek/deepseek-v4-pro",
    apiKeyEnv: "OPFOR_API_KEY",
    baseURL: "https://llm.keyvalue.systems/v1",
  });
  assert.deepStrictEqual(resolveModelIdentity(m), {
    provider: "openai-compatible",
    model: "deepseek/deepseek-v4-pro",
  });
});

test("rememberModelIdentity is a no-op for a non-object model reference", () => {
  const llm: LlmConfig = { provider: "openai", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY" };
  // Must not throw — `ai` permits a bare string model.
  rememberModelIdentity("gpt-4o-mini" as unknown as LanguageModel, llm);
  assert.deepStrictEqual(resolveModelIdentity("gpt-4o-mini"), {
    provider: "unknown",
    model: "gpt-4o-mini",
  });
});

test("resolveModelIdentity returns undefined for an object with nothing identifying", () => {
  assert.equal(resolveModelIdentity({} as unknown as LanguageModel), undefined);
});

// ---------------------------------------------------------------------------
// Role derivation + end-to-end attribution
//
// roleFromContext reads the free-text label withRetry already takes for logging.
// That coupling is load-bearing but invisible: renaming a log string would
// silently drop the attacker/judge split from every report. These pin it.
// ---------------------------------------------------------------------------

test("roleFromContext maps the labels actually used at call sites", () => {
  // These four strings are the literal `context:` values passed by
  // generateAttacks.ts, judge.ts and withRetry's default. Changing one without
  // updating roleFromContext silently removes roles from the cost breakdown.
  assert.equal(roleFromContext("Attacker"), "attacker");
  assert.equal(roleFromContext("Attacker (MCP)"), "attacker");
  assert.equal(roleFromContext("Judge"), "judge");
  assert.equal(roleFromContext("LLM"), undefined);
});

test("roleFromContext is case- and whitespace-insensitive, and safe on empty", () => {
  assert.equal(roleFromContext("  jUdGe  "), "judge");
  assert.equal(roleFromContext(undefined), undefined);
  assert.equal(roleFromContext("   "), undefined);
});

test("withRetry attributes usage to the model built by createModel", async () => {
  // The load-bearing path: createModel registers identity in a WeakMap, and
  // withRetry resolves it from the model object alone. Every unit test above
  // uses hand-built identities, so this is the only check that the real
  // factory -> tracker chain works.
  process.env.MODEL_IDENTITY_TEST_KEY = "dummy-key-not-used";
  const llm: LlmConfig = {
    provider: "openai-compatible",
    model: "deepseek/deepseek-v4-pro",
    apiKeyEnv: "MODEL_IDENTITY_TEST_KEY",
    baseURL: "https://example.invalid/v1",
  };
  const model = createModel(llm);

  const tracker = new TokenTracker();
  // withRetry auto-records from a successful result's `.usage`; no network needed.
  await withRetry(async () => ({ usage: { inputTokens: 120, outputTokens: 30 } }), {
    context: "Judge",
    tokenTracker: tracker,
    model,
  });

  assert.equal(tracker.breakdown.length, 1);
  const [bucket] = tracker.breakdown;
  // Provider survives as the CONFIGURED name, not the SDK's "custom" — this is
  // the whole reason the identity registry exists.
  assert.equal(bucket.key, "openai-compatible:deepseek/deepseek-v4-pro");
  assert.equal(bucket.provider, "openai-compatible");
  assert.deepStrictEqual(bucket.roles, ["judge"]);
  assert.equal(bucket.totalTokens, 150);
});

test("withRetry without a model still counts the tokens, unattributed", async () => {
  const tracker = new TokenTracker();
  await withRetry(async () => ({ usage: { inputTokens: 10, outputTokens: 5 } }), {
    context: "Attacker",
    tokenTracker: tracker,
  });
  assert.equal(tracker.totals.totalTokens, 15);
  assert.equal(tracker.breakdown[0].key, "unknown");
  assert.deepStrictEqual(tracker.breakdown[0].roles, ["attacker"]);
});
