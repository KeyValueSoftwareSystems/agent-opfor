/**
 * Maps each opfor provider to the `litellm_provider` values that legitimately
 * price it in the upstream price map.
 *
 * Two names for one thing is the norm, not the exception: opfor's `google`
 * appears upstream as both `gemini` (direct API) and `vertex_ai-language-models`
 * (the same models via Vertex), and `azure` splits into `azure` / `azure_ai`.
 *
 * This map is the single source of truth for both sides of the feature:
 * `scripts/build-pricing.ts` filters the vendored table by the union of these
 * values, and `lookupPrice` uses them to reject a match from the wrong provider.
 * Keeping one definition is what stops the table from containing entries the
 * lookup can never accept, or vice versa.
 *
 * `null` means "cannot be verified" — a proxy speaking the OpenAI protocol can
 * serve any model from any vendor, so there is no provider to check against.
 */
export const LITELLM_PROVIDER_ALIASES: Record<string, string[] | null> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  groq: ["groq"],
  google: ["gemini", "vertex_ai-language-models"],
  deepseek: ["deepseek"],
  azure: ["azure", "azure_ai"],
  "openai-compatible": null,
};

/**
 * Upstream providers whose entries are kept in the vendored table.
 *
 * The union of the aliases above, plus a few vendors that are commonly reached
 * *through* an `openai-compatible` proxy and are cheap to include. Deliberately
 * excluded: bedrock, fireworks, openrouter and friends — together they are an
 * order of magnitude more entries, and a setup routing through them is one where
 * the proxy can report exact cost directly, making a list price redundant.
 */
export const VENDORED_LITELLM_PROVIDERS: string[] = [
  ...new Set([
    ...Object.values(LITELLM_PROVIDER_ALIASES)
      .filter((v): v is string[] => v !== null)
      .flat(),
    "mistral",
    "xai",
  ]),
];
