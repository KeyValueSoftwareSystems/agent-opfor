/**
 * Resolve a configured provider/model pair to per-token prices.
 *
 * The same model is listed upstream under several names depending on how it is
 * reached (`claude-opus-5`, `vertex_ai/claude-opus-5`, `anthropic/claude-opus-5`),
 * while users type whatever their setup expects. So rather than one lookup, we
 * try a short ladder of name forms and take the first that matches.
 *
 * Every match is then checked against the configured provider. Without that
 * guard, someone running a mistyped model name on Groq would silently match
 * OpenAI's row and be priced at OpenAI's rates — a wrong number presented with
 * full confidence, which is worse than reporting nothing.
 */

import { PRICE_TABLE, type CompactPrice } from "./priceTable.generated.js";
import { LITELLM_PROVIDER_ALIASES } from "./providerAliases.js";
import type { ModelPrice } from "./types.js";

/** A resolved price plus the table key it came from, for auditability. */
export interface PriceLookupResult {
  price: ModelPrice;
  matchedKey: string;
}

/**
 * Name forms to try, in order.
 *
 * The provider-scoped form goes first because some vendors resell the same model
 * at a different rate — `azure/gpt-4o-mini` costs more than OpenAI's own
 * `gpt-4o-mini`. Trying it first picks the right row outright instead of relying
 * on the guard below to reject the wrong one. Most providers have no such row,
 * in which case the lookup simply falls through to the bare name.
 */
export function priceCandidates(provider: string, model: string): string[] {
  const m = model.trim();
  if (!m) return [];
  const lower = m.toLowerCase();

  const forms = [`${provider}/${m}`, m];
  if (m.includes("/")) {
    // "anthropic/claude-opus-5" -> "claude-opus-5"; upstream lists direct-API
    // models bare, so a prefixed name only matches once the prefix is dropped.
    forms.push(m.slice(m.indexOf("/") + 1));
    forms.push(m.slice(m.lastIndexOf("/") + 1));
  }
  if (lower !== m) forms.push(lower);

  return [...new Set(forms.filter(Boolean))];
}

/** Whether a table row may legitimately price this provider. */
function providerAccepts(provider: string, entry: CompactPrice): boolean {
  const accepted = LITELLM_PROVIDER_ALIASES[provider];
  // Unknown to the alias map, or explicitly unverifiable (an OpenAI-compatible
  // proxy can serve any vendor) — nothing to check against, so accept the match.
  if (accepted === undefined || accepted === null) return true;
  return accepted.includes(entry.p);
}

function toModelPrice(entry: CompactPrice): ModelPrice {
  return {
    inputPerToken: entry.i,
    outputPerToken: entry.o,
    ...(entry.cr !== undefined ? { cacheReadPerToken: entry.cr } : {}),
    ...(entry.cw !== undefined ? { cacheWritePerToken: entry.cw } : {}),
  };
}

/**
 * Look up prices for one provider/model pair.
 *
 * Returns undefined when no name form matches, or when every match belongs to a
 * different vendor. Callers must treat that as "unpriced", never as free.
 */
export function lookupPrice(provider: string, model: string): PriceLookupResult | undefined {
  for (const key of priceCandidates(provider, model)) {
    const entry = PRICE_TABLE[key];
    if (!entry) continue;
    if (!providerAccepts(provider, entry)) continue;
    return { price: toModelPrice(entry), matchedKey: key };
  }
  return undefined;
}

export { PRICE_TABLE_VERSION } from "./priceTable.generated.js";
