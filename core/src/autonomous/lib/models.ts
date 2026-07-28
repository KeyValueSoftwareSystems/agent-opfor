// Model-alias resolution shared across the autonomous runner (self_check verifier,
// trace-curation model, …). Maps short aliases to full Anthropic ids, honoring the
// ANTHROPIC_DEFAULT_*_MODEL gateway overrides.

/** Resolve a model alias to a full Anthropic API model id, respecting gateway env-var overrides. */
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
