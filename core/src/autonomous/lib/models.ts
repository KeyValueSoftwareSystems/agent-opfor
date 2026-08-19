// Brain-model resolution for the autonomous runner.
//
// "Brain" = the LLM driving the commander / operator / scout / verifier agents, as opposed to
// the TARGET under attack. Hunt used to hardcode Claude here; it now resolves through the same
// provider registry `opfor run` uses, so any supported provider can drive a hunt.

import type { LlmConfig, ProviderName } from "../../config/types.js";
import { PROVIDER_ENV_VARS, PROVIDER_DEFAULTS } from "../../providers/factory.js";

/** Provider-level config for the agent brain. Per-agent model ids live on HuntOptions. */
export interface BrainConfig {
  provider: ProviderName;
  /** Env var NAME holding the key. Defaults to the provider's conventional var. */
  apiKeyEnv?: string;
  /** Gateway / self-hosted base URL. */
  baseURL?: string;
}

/**
 * Resolve a Claude model alias to a full Anthropic id, honoring the gateway overrides.
 *
 * Aliases are Anthropic-only by design: `sonnet` means nothing to OpenAI or Groq, so other
 * providers take a literal model id. Kept so existing `--commander-model sonnet` invocations
 * and the documented ANTHROPIC_DEFAULT_*_MODEL pins keep working.
 */
export function resolveModelId(model: string): string {
  switch (model) {
    case "opus":
      return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "claude-opus-4-8";
    case "sonnet":
      return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "claude-sonnet-4-6";
    case "haiku":
      return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5-20251001";
    default:
      return model; // assume a full id was provided
  }
}

/**
 * Build the `LlmConfig` for one brain agent. Alias expansion applies only to Anthropic;
 * an empty model falls back to the provider's default.
 */
export function brainLlmConfig(brain: BrainConfig, model: string): LlmConfig {
  const resolved =
    brain.provider === "anthropic"
      ? resolveModelId(model)
      : model || PROVIDER_DEFAULTS[brain.provider];
  return {
    provider: brain.provider,
    model: resolved,
    apiKeyEnv: brain.apiKeyEnv ?? PROVIDER_ENV_VARS[brain.provider],
    baseURL: brain.baseURL,
  };
}
