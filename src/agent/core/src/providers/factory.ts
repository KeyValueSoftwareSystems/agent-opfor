import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmConfig, ProviderName } from "../config/types.js";

export const PROVIDER_DEFAULTS: Record<ProviderName, string> = {
  openai:    "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  groq:      "llama-3.3-70b-versatile",
  google:    "gemini-2.0-flash",
  other:     "",
};

export const PROVIDER_ENV_VARS: Record<ProviderName, string> = {
  openai:    "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq:      "GROQ_API_KEY",
  google:    "GOOGLE_GENERATIVE_AI_API_KEY",
  other:     "ASTRA_API_KEY",
};

export function createModel(llm: LlmConfig): LanguageModel {
  const apiKey = process.env[llm.apiKeyEnv]?.trim();
  if (!apiKey) throw new Error(`Missing env var: ${llm.apiKeyEnv}`);
  const { provider, model, baseURL } = llm;

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(model);

    case "anthropic":
      return createAnthropic({ apiKey })(model);

    case "groq":
      return createOpenAICompatible({
        name: "groq",
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      }).chatModel(model);

    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);

    case "other": {
      if (!baseURL) throw new Error("baseURL is required for provider 'other'");
      return createOpenAICompatible({ name: "custom", apiKey, baseURL }).chatModel(model);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
