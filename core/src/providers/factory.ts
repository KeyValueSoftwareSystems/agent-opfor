import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmConfig } from "../config/types.js";
import { getEnv } from "../lib/env.js";

export interface ProviderCapabilities {
  supportsJsonMode: boolean;
  requiresBaseURL: boolean;
}

/** The resolved inputs a provider needs to build a model. */
export interface ProviderBuildContext {
  apiKey: string;
  model: string;
  baseURL?: string;
}

/**
 * Everything the engine needs to know about one provider: its default model,
 * the env var holding its key, its capabilities, and how to build a model.
 * Registering a provider is a single entry in {@link providerRegistry} — no more
 * editing a switch plus three parallel lookup tables (the old "5 files" problem).
 */
export interface ProviderAdapter {
  /** Human-readable label for provider-picker UIs (CLI wizard, extension popup). */
  displayName: string;
  defaultModel: string;
  envVar: string;
  capabilities: ProviderCapabilities;
  /** Prompt copy for `capabilities.requiresBaseURL`; falls back to a generic message when omitted. */
  baseUrlPromptMessage?: string;
  /**
   * Custom message thrown by createModel when `capabilities.requiresBaseURL` is
   * set but no baseURL is supplied. Defaults to a generic message when omitted.
   */
  baseUrlError?: string;
  build(ctx: ProviderBuildContext): LanguageModel;
}

// Unexported so `ProviderName` below can infer the literal key union; `providerRegistry`
// re-declares it with an explicit `Record<ProviderName, ProviderAdapter>` annotation,
// which avoids a non-portable nested `@ai-sdk/provider` type in the declaration emit.
const providerRegistryData = {
  openai: {
    displayName: "OpenAI",
    defaultModel: "gpt-4o-mini",
    envVar: "OPENAI_API_KEY",
    capabilities: { supportsJsonMode: true, requiresBaseURL: false },
    build: ({ apiKey, model }): LanguageModel => createOpenAI({ apiKey })(model),
  },
  anthropic: {
    displayName: "Anthropic (Claude)",
    defaultModel: "claude-3-5-haiku-20241022",
    envVar: "ANTHROPIC_API_KEY",
    capabilities: { supportsJsonMode: false, requiresBaseURL: false },
    build: ({ apiKey, model }): LanguageModel => createAnthropic({ apiKey })(model),
  },
  groq: {
    displayName: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    envVar: "GROQ_API_KEY",
    capabilities: { supportsJsonMode: true, requiresBaseURL: false },
    build: ({ apiKey, model }): LanguageModel =>
      createOpenAICompatible({
        name: "groq",
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      }).chatModel(model),
  },
  google: {
    displayName: "Google (Gemini)",
    defaultModel: "gemini-2.0-flash",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    capabilities: { supportsJsonMode: false, requiresBaseURL: false },
    build: ({ apiKey, model }): LanguageModel => createGoogleGenerativeAI({ apiKey })(model),
  },
  deepseek: {
    displayName: "DeepSeek",
    defaultModel: "deepseek-chat",
    envVar: "DEEPSEEK_API_KEY",
    capabilities: { supportsJsonMode: true, requiresBaseURL: false },
    build: ({ apiKey, model }): LanguageModel => createDeepSeek({ apiKey })(model),
  },
  azure: {
    displayName: "Azure OpenAI",
    defaultModel: "gpt-4o-mini",
    envVar: "AZURE_OPENAI_API_KEY",
    capabilities: { supportsJsonMode: true, requiresBaseURL: true },
    baseUrlPromptMessage: "Azure resource endpoint (e.g. https://my-resource.openai.azure.com)",
    baseUrlError: `baseURL is required for provider 'azure' (Azure resource endpoint, e.g. https://<resource>.openai.azure.com)`,
    // Add the /openai path when the endpoint has none; leave proxy/custom paths as-is.
    build: ({ apiKey, model, baseURL }): LanguageModel => {
      const base = baseURL!.replace(/\/+$/, "");
      let resolved: string;
      try {
        resolved = new URL(base).pathname === "/" ? `${base}/openai` : base;
      } catch {
        throw new Error(
          `baseURL is not a valid URL for provider 'azure' (Azure resource endpoint, e.g. https://<resource>.openai.azure.com)`
        );
      }
      return createAzure({ apiKey, baseURL: resolved })(model);
    },
  },
  "openai-compatible": {
    displayName: "Custom (OpenAI-compatible)",
    defaultModel: "",
    envVar: "OPFOR_API_KEY",
    capabilities: { supportsJsonMode: true, requiresBaseURL: true },
    build: ({ apiKey, model, baseURL }): LanguageModel =>
      createOpenAICompatible({ name: "custom", apiKey, baseURL: baseURL! }).chatModel(model),
  },
} satisfies Record<string, ProviderAdapter>;

/** Canonical provider key union, derived from the registry — no hand-maintained copy elsewhere. */
export type ProviderName = keyof typeof providerRegistryData;

export const providerRegistry: Record<ProviderName, ProviderAdapter> = providerRegistryData;

/** `{ OPENAI: "openai", ... }`-style constant for call sites that prefer named access. */
export const PROVIDERS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GROQ: "groq",
  GOOGLE: "google",
  DEEPSEEK: "deepseek",
  AZURE: "azure",
  OPENAI_COMPATIBLE: "openai-compatible",
} as const satisfies Record<string, ProviderName>;

// Freeze the capability objects: the derived PROVIDER_CAPABILITIES aliases them,
// so this keeps a stray `PROVIDER_CAPABILITIES.x.requiresBaseURL = …` from leaking
// into the registry that validateLlmConfig and createModel consult.
for (const adapter of Object.values(providerRegistry)) Object.freeze(adapter.capabilities);

/** Project one field of every adapter into a `Record<ProviderName, T>` view. */
function projectRegistry<T>(pick: (adapter: ProviderAdapter) => T): Record<ProviderName, T> {
  const entries = Object.entries(providerRegistry) as [ProviderName, ProviderAdapter][];
  return Object.fromEntries(entries.map(([name, adapter]) => [name, pick(adapter)])) as Record<
    ProviderName,
    T
  >;
}

// Backward-compatible lookup tables, derived from the registry so they can never
// drift from it. Existing importers (browser bundle, extension, CLI) keep working.
export const PROVIDER_DEFAULTS: Record<ProviderName, string> = projectRegistry(
  (a) => a.defaultModel
);
export const PROVIDER_ENV_VARS: Record<ProviderName, string> = projectRegistry((a) => a.envVar);
export const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapabilities> = projectRegistry(
  (a) => a.capabilities
);
export const PROVIDER_DISPLAY_NAMES: Record<ProviderName, string> = projectRegistry(
  (a) => a.displayName
);
export const PROVIDER_BASE_URL_PROMPTS: Record<ProviderName, string | undefined> = projectRegistry(
  (a) => a.baseUrlPromptMessage
);

/** `{ name, value }[]` shape consumed directly by the CLI wizard's `select()` prompt. */
export const PROVIDER_CHOICES: { name: string; value: ProviderName }[] = (
  Object.keys(providerRegistry) as ProviderName[]
).map((value) => ({ name: PROVIDER_DISPLAY_NAMES[value], value }));

/** Returns an error message string if the config is invalid, or null if valid. */
export function validateLlmConfig(llm: LlmConfig): string | null {
  if (!llm.provider) return "provider is required";
  if (!llm.model) return "model is required";
  if (!llm.apiKeyEnv) return "apiKeyEnv is required";
  if (providerRegistry[llm.provider]?.capabilities.requiresBaseURL && !llm.baseURL) {
    return `baseURL is required for provider '${llm.provider}'`;
  }
  const apiKey = getEnv(llm.apiKeyEnv)?.trim();
  if (!apiKey) return `env var '${llm.apiKeyEnv}' is not set`;
  return null;
}

export function createModel(llm: LlmConfig): LanguageModel {
  // apiKeyEnv is optional on the unified LlmConfig (see config/schema.ts); the agent
  // path always needs one, so fail loud and actionable when it is missing here.
  if (!llm.apiKeyEnv)
    throw new Error(
      `apiKeyEnv is required for provider '${llm.provider}' — set it in your config (the env var NAME holding the key).`
    );
  const apiKey = getEnv(llm.apiKeyEnv)?.trim();
  if (!apiKey) throw new Error(`Missing env var: ${llm.apiKeyEnv}`);

  const adapter = providerRegistry[llm.provider];
  if (!adapter)
    throw new Error(
      `Unknown provider: ${llm.provider}. Set 'provider' in your LLM config to one of: ${Object.keys(providerRegistry).join(", ")}.`
    );
  // One source of truth for the baseURL rule: the capability flag drives it, so a
  // provider added with requiresBaseURL gets the actionable error for free.
  if (adapter.capabilities.requiresBaseURL && !llm.baseURL) {
    throw new Error(adapter.baseUrlError ?? `baseURL is required for provider '${llm.provider}'`);
  }
  return adapter.build({ apiKey, model: llm.model, baseURL: llm.baseURL });
}
