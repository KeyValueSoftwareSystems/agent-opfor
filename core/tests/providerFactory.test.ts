/**
 * PR9 — ProviderRegistry characterization tests.
 *
 * Pins the observable behavior of the provider factory so the switch → registry
 * refactor is provably behavior-preserving: the exact model built per provider
 * (SDK `.provider` tag + `modelId` passthrough), the three derived lookup tables
 * (defaults / env vars / capabilities), and every error path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setEnvProvider } from "../src/lib/env.js";

// Configurable env used by every test; getEnv reads through this map.
let envValues: Record<string, string> = {};
setEnvProvider((key) => envValues[key]);

const {
  createModel,
  validateLlmConfig,
  PROVIDER_DEFAULTS,
  PROVIDER_ENV_VARS,
  PROVIDER_CAPABILITIES,
} = await import("../src/providers/factory.js");
const { PROVIDERS } = await import("../src/config/types.js");

// Derived from the registry so the test stays in lockstep when a new
// baseURL-requiring provider is added.
const NEEDS_BASE_URL = new Set(
  Object.values(PROVIDERS).filter((p) => PROVIDER_CAPABILITIES[p].requiresBaseURL)
);

// Captured from the pre-refactor factory. Each provider must build a model with
// this exact SDK provider tag (proves the right SDK factory is wired). These are
// Vercel AI SDK internals — a deliberate `@ai-sdk/*` upgrade may require rebaselining.
const EXPECTED_PROVIDER_TAG: Record<string, string> = {
  openai: "openai.responses",
  anthropic: "anthropic.messages",
  groq: "groq.chat",
  google: "google.generative-ai",
  deepseek: "deepseek.chat",
  azure: "azure.responses",
  "openai-compatible": "custom.chat",
};

for (const provider of Object.values(PROVIDERS)) {
  test(`createModel builds the right model for '${provider}'`, () => {
    envValues = { KEY: "fake-key" };
    const model = createModel({
      provider,
      model: "test-model",
      apiKeyEnv: "KEY",
      baseURL: NEEDS_BASE_URL.has(provider) ? "https://example.com" : undefined,
    });
    assert.strictEqual(model.modelId, "test-model");
    assert.strictEqual(model.provider, EXPECTED_PROVIDER_TAG[provider]);
  });
}

test("the three lookup tables keep their exact values", () => {
  assert.deepStrictEqual(PROVIDER_DEFAULTS, {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-20241022",
    groq: "llama-3.3-70b-versatile",
    google: "gemini-2.0-flash",
    deepseek: "deepseek-chat",
    azure: "gpt-4o-mini",
    "openai-compatible": "",
  });
  assert.deepStrictEqual(PROVIDER_ENV_VARS, {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    groq: "GROQ_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    azure: "AZURE_OPENAI_API_KEY",
    "openai-compatible": "OPFOR_API_KEY",
  });
  assert.deepStrictEqual(PROVIDER_CAPABILITIES, {
    openai: { supportsJsonMode: true, requiresBaseURL: false },
    anthropic: { supportsJsonMode: false, requiresBaseURL: false },
    groq: { supportsJsonMode: true, requiresBaseURL: false },
    google: { supportsJsonMode: false, requiresBaseURL: false },
    deepseek: { supportsJsonMode: true, requiresBaseURL: false },
    azure: { supportsJsonMode: true, requiresBaseURL: true },
    "openai-compatible": { supportsJsonMode: true, requiresBaseURL: true },
  });
});

test("createModel throws when apiKeyEnv is missing", () => {
  assert.throws(
    () => createModel({ provider: PROVIDERS.OPENAI, model: "m" }),
    /apiKeyEnv is required for provider 'openai'/
  );
});

test("createModel throws when the env var is unset", () => {
  envValues = {}; // KEY not present
  assert.throws(
    () => createModel({ provider: PROVIDERS.OPENAI, model: "m", apiKeyEnv: "KEY" }),
    /Missing env var: KEY/
  );
});

test("azure without baseURL throws its specific message", () => {
  envValues = { KEY: "fake-key" };
  assert.throws(
    () => createModel({ provider: PROVIDERS.AZURE, model: "m", apiKeyEnv: "KEY" }),
    /baseURL is required for provider 'azure' \(Azure resource endpoint/
  );
});

test("openai-compatible without baseURL throws", () => {
  envValues = { KEY: "fake-key" };
  assert.throws(
    () => createModel({ provider: PROVIDERS.OPENAI_COMPATIBLE, model: "m", apiKeyEnv: "KEY" }),
    /baseURL is required for provider 'openai-compatible'/
  );
});

test("an unknown provider throws", () => {
  envValues = { KEY: "fake-key" };
  assert.throws(
    () =>
      createModel({
        provider: "bogus" as (typeof PROVIDERS)[keyof typeof PROVIDERS],
        model: "m",
        apiKeyEnv: "KEY",
      }),
    /Unknown provider: bogus/
  );
});

test("validateLlmConfig returns null for a valid config and messages otherwise", () => {
  envValues = { KEY: "fake-key" };
  assert.strictEqual(
    validateLlmConfig({ provider: PROVIDERS.OPENAI, model: "m", apiKeyEnv: "KEY" }),
    null
  );
  assert.match(
    validateLlmConfig({ model: "m", apiKeyEnv: "KEY" } as never) ?? "",
    /provider is required/
  );
  assert.match(
    validateLlmConfig({ provider: PROVIDERS.OPENAI, apiKeyEnv: "KEY" } as never) ?? "",
    /model is required/
  );
  assert.match(
    validateLlmConfig({ provider: PROVIDERS.OPENAI, model: "m" }) ?? "",
    /apiKeyEnv is required/
  );
  assert.match(
    validateLlmConfig({ provider: PROVIDERS.AZURE, model: "m", apiKeyEnv: "KEY" }) ?? "",
    /baseURL is required for provider 'azure'/
  );
  envValues = {};
  assert.match(
    validateLlmConfig({ provider: PROVIDERS.OPENAI, model: "m", apiKeyEnv: "KEY" }) ?? "",
    /env var 'KEY' is not set/
  );
});
