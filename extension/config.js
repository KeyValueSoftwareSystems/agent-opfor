import { PROVIDERS } from "./providers.js";

/** Providers whose endpoint is hardcoded — no baseUrl required from the user. */
const PROVIDERS_WITH_FIXED_URL = new Set([
  PROVIDERS.OPENAI,
  PROVIDERS.ANTHROPIC,
  PROVIDERS.GROQ,
  PROVIDERS.GOOGLE,
]);

/**
 * Load per-task LLM configs from Options storage.
 *
 * Storage layout:
 * - New:    `opforLlmProfiles` = { v: 1, attacker, judge, reader }
 * - Legacy: `opforAiFallback`
 */
export async function getLlmProfile(kind) {
  const { opforLlmProfiles, opforAiFallback } = await chrome.storage.local.get([
    "opforLlmProfiles",
    "opforAiFallback",
  ]);

  const legacy = opforAiFallback || {};
  const profiles =
    opforLlmProfiles && typeof opforLlmProfiles === "object" ? opforLlmProfiles : null;
  const selected = profiles?.[kind] && typeof profiles[kind] === "object" ? profiles[kind] : legacy;

  return {
    provider: selected.provider || legacy.provider || PROVIDERS.OPENAI,
    baseUrl: selected.baseUrl || legacy.baseUrl || "",
    model: selected.model || legacy.model || "",
    apiKey: selected.apiKey || legacy.apiKey || "",
    enabled: Boolean(selected.enabled ?? legacy.enabled ?? false),
  };
}

export function assertLlmCfg(cfg, { kind }) {
  if (!cfg?.enabled) throw new Error(`${kind} LLM is disabled (enable it in extension Options).`);
  if (!PROVIDERS_WITH_FIXED_URL.has(cfg.provider) && !cfg.baseUrl) {
    throw new Error(`${kind} LLM missing baseUrl in Options.`);
  }
  if (!cfg.model) throw new Error(`${kind} LLM missing model in Options.`);
  if (!cfg.apiKey) throw new Error(`${kind} LLM missing apiKey in Options.`);
}
