/**
 * Turn a per-model token breakdown into a run cost.
 *
 * Deliberately conservative: a model whose price cannot be found is reported as
 * unpriced rather than counted as free. `totalUsd` is therefore a lower bound
 * whenever `complete` is false, and the UI must say so — a report that quietly
 * treats an unknown model as $0 understates spend while looking authoritative.
 *
 * Repeat ("cached") input tokens are not yet separated by the token counter, so
 * all input is priced at the full input rate. For multi-turn runs against
 * providers that discount repeated context, that makes this an over-estimate.
 */

import type { ModelTokenUsage } from "../execute/tokenTracker.js";
import { lookupPrice } from "./lookupPrice.js";
import { PRICE_TABLE_VERSION } from "./priceTable.generated.js";
import type { ModelCost, RunCost } from "./types.js";

/** Price one model's usage. */
function costOne(usage: ModelTokenUsage): ModelCost {
  const found = lookupPrice(usage.provider, usage.model);

  const base: ModelCost = {
    key: usage.key,
    provider: usage.provider,
    model: usage.model,
    roles: usage.roles,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    source: "unknown",
  };

  if (!found) return base;

  return {
    ...base,
    usd:
      usage.inputTokens * found.price.inputPerToken +
      usage.outputTokens * found.price.outputPerToken,
    source: "table",
    matchedKey: found.matchedKey,
  };
}

/**
 * Estimate the cost of a run from its per-model token breakdown.
 *
 * Returns undefined when there is nothing to price, so callers can omit the
 * field entirely rather than render a meaningless $0.00.
 */
export function estimateRunCost(breakdown?: ModelTokenUsage[]): RunCost | undefined {
  const spending = (breakdown ?? []).filter((b) => b.totalTokens > 0);
  if (spending.length === 0) return undefined;

  const byModel = spending.map(costOne);
  const unpricedModels = byModel.filter((c) => c.usd === undefined).map((c) => c.key);
  const totalUsd = byModel.reduce((sum, c) => sum + (c.usd ?? 0), 0);

  return {
    totalUsd,
    currency: "USD",
    byModel,
    unpricedModels,
    complete: unpricedModels.length === 0,
    priceTableVersion: PRICE_TABLE_VERSION,
  };
}

/**
 * Format a USD amount for display, with precision that scales to the amount.
 *
 * Three bands, each solving a different problem:
 *   - Below a cent, a fixed decimal count renders "$0.0000" and reads as free,
 *     so these show two significant figures instead ("$0.0034").
 *   - Between a cent and a dime, the third decimal is what distinguishes one
 *     evaluator from another — "$0.037" vs "$0.049" is a third more expensive,
 *     but both round to the same two-decimal figure.
 *   - From a dime up, that precision is noise; show it as money ("$0.18").
 *
 * Anything below a millionth of a dollar is labelled rather than rounded away.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.000001) return "<$0.000001";
  // Number() strips the trailing zeros toPrecision leaves behind (0.0034 stays
  // "0.0034" rather than becoming "0.0034000").
  if (usd < 0.01) return `$${Number(usd.toPrecision(2))}`;
  if (usd < 0.1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
