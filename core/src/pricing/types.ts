/**
 * Types for run cost estimation.
 *
 * Prices are USD per single token (the unit the upstream LiteLLM price map uses),
 * not per million — keeping the raw unit avoids a scaling step at every call site
 * and a class of off-by-1e6 bugs. Format for display at the edge.
 */

/** Per-token USD prices for one model. */
export interface ModelPrice {
  /** USD per input token. */
  inputPerToken: number;
  /** USD per output token. */
  outputPerToken: number;
  /**
   * USD per cached (repeat) input token, when the provider publishes one.
   * Falls back to {@link inputPerToken} when absent, so an unpublished cache
   * rate over-estimates rather than under-charges.
   */
  cacheReadPerToken?: number;
  /** USD per cache-write token, when the provider publishes one. Same fallback. */
  cacheWritePerToken?: number;
}

/** Where a price came from. Ordered best-first; today only `table` and `unknown` occur. */
export type CostSource = "table" | "unknown";

/** Cost attributed to one model. */
export interface ModelCost {
  /** `"<provider>:<model>"` — matches the token breakdown's key. */
  key: string;
  provider: string;
  model: string;
  /** Run phases this model served, e.g. `["attacker"]`. */
  roles: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** USD, or undefined when the model could not be priced. */
  usd?: number;
  source: CostSource;
  /** The price-table key this matched, for auditability. Absent when unpriced. */
  matchedKey?: string;
}

/** Cost of one run (or one evaluator), split by model. */
export interface RunCost {
  /** Sum of every priced model's cost. Excludes unpriced models by definition. */
  totalUsd: number;
  currency: "USD";
  byModel: ModelCost[];
  /**
   * Models whose price was not found, as `"<provider>:<model>"`. Non-empty means
   * `totalUsd` is a lower bound — surface this rather than implying $0.
   */
  unpricedModels: string[];
  /**
   * True when every model **that reported tokens** was priced.
   *
   * Deliberately narrower than "all spend is accounted for": a call site that
   * records no usage at all produces no bucket, so there is nothing here to flag.
   * A few helper paths (trace curation, session summarisation, `generateJsonObject`)
   * still do not report usage, so `complete: true` means "nothing we saw was
   * unpriced", not "nothing was missed". Treat `totalUsd` as a floor either way.
   */
  complete: boolean;
  /** Which price snapshot produced this, for reproducibility. */
  priceTableVersion: string;
}
