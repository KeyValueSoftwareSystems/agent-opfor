import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { PROVIDERS, type LlmConfig, type ProviderName } from "../config/types.js";
import { getEnv } from "../lib/env.js";

export const PROVIDER_DEFAULTS: Record<ProviderName, string> = {
  [PROVIDERS.OPENAI]: "gpt-4o-mini",
  [PROVIDERS.ANTHROPIC]: "claude-3-5-haiku-20241022",
  [PROVIDERS.GROQ]: "llama-3.3-70b-versatile",
  [PROVIDERS.GOOGLE]: "gemini-2.0-flash",
  [PROVIDERS.DEEPSEEK]: "deepseek-chat",
  [PROVIDERS.AZURE]: "gpt-4o-mini",
  [PROVIDERS.OPENAI_COMPATIBLE]: "",
};

export const PROVIDER_ENV_VARS: Record<ProviderName, string> = {
  [PROVIDERS.OPENAI]: "OPENAI_API_KEY",
  [PROVIDERS.ANTHROPIC]: "ANTHROPIC_API_KEY",
  [PROVIDERS.GROQ]: "GROQ_API_KEY",
  [PROVIDERS.GOOGLE]: "GOOGLE_GENERATIVE_AI_API_KEY",
  [PROVIDERS.DEEPSEEK]: "DEEPSEEK_API_KEY",
  [PROVIDERS.AZURE]: "AZURE_OPENAI_API_KEY",
  [PROVIDERS.OPENAI_COMPATIBLE]: "OPFOR_API_KEY",
};

export interface ProviderCapabilities {
  supportsJsonMode: boolean;
  requiresBaseURL: boolean;
}

export const PROVIDER_CAPABILITIES: Record<ProviderName, ProviderCapabilities> = {
  [PROVIDERS.OPENAI]: { supportsJsonMode: true, requiresBaseURL: false },
  [PROVIDERS.ANTHROPIC]: { supportsJsonMode: false, requiresBaseURL: false },
  [PROVIDERS.GROQ]: { supportsJsonMode: true, requiresBaseURL: false },
  [PROVIDERS.GOOGLE]: { supportsJsonMode: false, requiresBaseURL: false },
  [PROVIDERS.DEEPSEEK]: { supportsJsonMode: true, requiresBaseURL: false },
  [PROVIDERS.AZURE]: { supportsJsonMode: true, requiresBaseURL: true },
  [PROVIDERS.OPENAI_COMPATIBLE]: { supportsJsonMode: true, requiresBaseURL: true },
};

/** Returns an error message string if the config is invalid, or null if valid. */
export function validateLlmConfig(llm: LlmConfig): string | null {
  if (!llm.provider) return "provider is required";
  if (!llm.model) return "model is required";
  if (!llm.apiKeyEnv) return "apiKeyEnv is required";
  if (PROVIDER_CAPABILITIES[llm.provider]?.requiresBaseURL && !llm.baseURL) {
    return `baseURL is required for provider '${llm.provider}'`;
  }
  const apiKey = getEnv(llm.apiKeyEnv)?.trim();
  if (!apiKey) return `env var '${llm.apiKeyEnv}' is not set`;
  return null;
}

export function createModel(llm: LlmConfig): LanguageModel {
  const apiKey = getEnv(llm.apiKeyEnv)?.trim();
  if (!apiKey) throw new Error(`Missing env var: ${llm.apiKeyEnv}`);
  const { provider, model, baseURL } = llm;

  switch (provider) {
    case PROVIDERS.OPENAI:
      return createOpenAI({ apiKey })(model);

    case PROVIDERS.ANTHROPIC:
      return createAnthropic({ apiKey })(model);

    case PROVIDERS.GROQ:
      return createOpenAICompatible({
        name: "groq",
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      }).chatModel(model);

    case PROVIDERS.GOOGLE:
      return createGoogleGenerativeAI({ apiKey })(model);

    case PROVIDERS.DEEPSEEK:
      return createDeepSeek({ apiKey })(model);

    case PROVIDERS.AZURE: {
      if (!baseURL)
        throw new Error(
          `baseURL is required for provider '${PROVIDERS.AZURE}' (Azure resource endpoint, e.g. https://<resource>.openai.azure.com)`
        );
      return createAzure({ apiKey, resourceName: baseURL })(model);
    }

    case PROVIDERS.OPENAI_COMPATIBLE: {
      if (!baseURL)
        throw new Error(`baseURL is required for provider '${PROVIDERS.OPENAI_COMPATIBLE}'`);
      return createOpenAICompatible({ name: "custom", apiKey, baseURL }).chatModel(model);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
