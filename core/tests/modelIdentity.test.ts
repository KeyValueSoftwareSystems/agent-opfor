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
