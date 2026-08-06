/**
 * Lightweight accumulator for LLM token usage across a run.
 *
 * Created per-run and threaded through RunAllOptions → EvaluatorLoopContext →
 * attack drivers. Each `generateText` / `generateObject` call site records its
 * usage after the call completes (including retries). Aggregated totals are
 * surfaced in the CLI summary, HTML/JSON report, and extension popup.
 *
 * Usage is recorded twice: once into flat run totals, and once into a per-model
 * bucket. The per-model breakdown exists because a run can mix models — the
 * judge may be a different (and far more expensive) model than the attacker —
 * so a single combined total cannot be priced. See {@link ModelTokenUsage}.
 */

import { z } from "zod";
import {
  modelKey,
  resolveModelIdentity,
  UNKNOWN_MODEL_KEY,
  type ModelRef,
} from "../providers/modelIdentity.js";

/** Aggregated input/output/total token counts from LLM calls. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * How one call's input tokens split across cache tiers.
 *
 * `inputTokens` is the **inclusive** total — providers report it as
 * `noCache + cacheRead + cacheWrite`, not as the fresh-text count alone. Pricing
 * therefore has to divide that total between the tiers, never add a cache charge
 * on top of it (which would bill cached tokens twice).
 *
 * Carried only so {@link estimateRunCost} can apply each tier's rate; it is not
 * reported on its own.
 */
export interface InputCacheSplit {
  /** Input tokens processed fresh, billed at the full input rate. */
  noCache: number;
  /** Input tokens served from cache, billed at the provider's (much lower) read rate. */
  cacheRead: number;
  /** Input tokens written to cache, billed at the provider's write rate. */
  cacheWrite: number;
}

/** Token usage attributed to one provider/model pair. */
export interface ModelTokenUsage extends TokenUsage {
  /** `"<provider>:<model>"`, or `"unknown"` for usage that could not be attributed. */
  key: string;
  provider: string;
  model: string;
  /** Which phases used this model — `"attacker"`, `"judge"`. Sorted, deduped. */
  roles: string[];
  /** Number of LLM calls recorded against this model. */
  calls: number;
  /**
   * Cache split of {@link TokenUsage.inputTokens}, present only when this model
   * actually hit a cache. Exists so each tier can be priced at its own rate; the
   * three fields sum to `inputTokens`. See {@link InputCacheSplit}.
   */
  noCacheInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

/** Optional provenance supplied alongside a usage recording. */
export interface RecordAttribution {
  /** The model the call was made against — an AI SDK model, an LlmConfig, or an identity. */
  model?: ModelRef;
  /** Run phase, e.g. `"attacker"` or `"judge"`. Case-insensitive. */
  role?: string;
}

/** Shared zero-value constant to avoid re-allocating empty usage objects. */
export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

/**
 * Zod schema for validating LLM usage objects before recording.
 * Uses `.passthrough()` so provider-specific metadata (e.g. `cachedTokens`,
 * `reasoningTokens`) does not cause the parse to fail. The `.transform()`
 * step extracts only the three tracked fields.
 */
export const LlmUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0).optional().default(0),
    outputTokens: z.number().int().min(0).optional().default(0),
    totalTokens: z.number().int().min(0).optional().default(0),
    // Provider-agnostic cache split, supplied by the AI SDK as part of `usage`.
    // Absent on providers (or call paths) that don't report it — see the
    // transform below, which then treats every input token as uncached.
    inputTokenDetails: z
      .object({
        noCacheTokens: z.number().int().min(0).optional(),
        cacheReadTokens: z.number().int().min(0).optional(),
        cacheWriteTokens: z.number().int().min(0).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .transform((u) => {
    const cacheRead = u.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0;
    const cached = cacheRead + cacheWrite;
    // `inputTokens` already includes the cached tokens, so the fresh count is
    // always the remainder. Derived rather than read from `noCacheTokens`: cost
    // divides inputTokens between the tiers, so a reported split that doesn't add
    // up would bill tokens the call never used. For a well-formed provider the
    // two agree — the AI SDK builds inputTokens as noCache + cacheRead +
    // cacheWrite — so deriving costs nothing and makes the invariant hold.
    //
    // A split claiming more cached tokens than there was input can't be divided
    // at all; drop it and let the call price at the full input rate, the same
    // conservative direction taken for an unpriced model.
    const usable = cached > 0 && cached <= u.inputTokens;
    return {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens > 0 ? u.totalTokens : u.inputTokens + u.outputTokens,
      // Omitted when nothing was cached, so a non-caching run records and prices
      // exactly as it did before this field existed.
      ...(usable ? { cache: { noCache: u.inputTokens - cached, cacheRead, cacheWrite } } : {}),
    };
  });

/**
 * Validate and normalize a raw usage object (from any provider/SDK) into a
 * clean {@link TokenUsage}. Returns `undefined` when the input is falsy or
 * fails validation so callers can safely discard garbage.
 */
export function parseUsage(raw: unknown): (TokenUsage & { cache?: InputCacheSplit }) | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const result = LlmUsageSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

/** Mutable per-model accumulator; projected to {@link ModelTokenUsage} on read. */
interface ModelBucket {
  key: string;
  provider: string;
  model: string;
  roles: Set<string>;
  calls: number;
  input: number;
  output: number;
  total: number;
  // Cache tiers of `input`. Calls that report no split count entirely as
  // noCache, so these three always sum to `input`.
  noCache: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Accumulator for LLM token usage.
 *
 * One root instance is created per run and threaded through the execution
 * pipeline. Call {@link child} to create per-evaluator sub-trackers whose
 * recordings automatically propagate to the parent.
 */
export class TokenTracker {
  private input = 0;
  private output = 0;
  private total = 0;
  private readonly buckets = new Map<string, ModelBucket>();

  /**
   * Record usage from a single LLM call. Safe to call with undefined/partial
   * usage. When `totalTokens` is supplied it is preserved; otherwise it falls
   * back to `inputTokens + outputTokens`.
   *
   * `attribution` is optional — usage recorded without it lands in the
   * `"unknown"` bucket and still counts toward run totals, so an un-migrated
   * call site degrades to today's behavior rather than losing tokens.
   */
  record(
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cache?: InputCacheSplit;
    },
    attribution?: RecordAttribution
  ): void {
    if (!usage) return;
    const inp = usage.inputTokens ?? 0;
    const out = usage.outputTokens ?? 0;
    const tot = usage.totalTokens ?? 0;
    const resolvedTotal = tot > 0 ? tot : inp + out;

    this.input += inp;
    this.output += out;
    this.total += resolvedTotal;

    this.recordToBucket(inp, out, resolvedTotal, attribution, usage.cache);
  }

  /** Fold one call's usage into its per-model bucket, creating the bucket on first sight. */
  private recordToBucket(
    inp: number,
    out: number,
    total: number,
    attribution?: RecordAttribution,
    cache?: InputCacheSplit
  ): void {
    const identity = resolveModelIdentity(attribution?.model);
    const key = identity ? modelKey(identity) : UNKNOWN_MODEL_KEY;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        provider: identity?.provider ?? "unknown",
        model: identity?.model ?? "unknown",
        roles: new Set<string>(),
        calls: 0,
        input: 0,
        output: 0,
        total: 0,
        noCache: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      this.buckets.set(key, bucket);
    }

    const role = attribution?.role?.trim().toLowerCase();
    if (role) bucket.roles.add(role);
    bucket.calls += 1;
    bucket.input += inp;
    bucket.output += out;
    bucket.total += total;
    // No split reported → the whole call was uncached, keeping the three tiers
    // summing to `input` even when only some calls to this model were cached.
    bucket.noCache += cache?.noCache ?? inp;
    bucket.cacheRead += cache?.cacheRead ?? 0;
    bucket.cacheWrite += cache?.cacheWrite ?? 0;
  }

  /** Current accumulated totals. Uses the provider-supplied total when available. */
  get totals(): TokenUsage {
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      totalTokens: this.total,
    };
  }

  /**
   * Per-model usage, heaviest first. Always sums to {@link totals}; models that
   * could not be attributed appear under the `"unknown"` key rather than being
   * dropped.
   */
  get breakdown(): ModelTokenUsage[] {
    return [...this.buckets.values()]
      .map((b) => ({
        key: b.key,
        provider: b.provider,
        model: b.model,
        roles: [...b.roles].sort(),
        calls: b.calls,
        inputTokens: b.input,
        outputTokens: b.output,
        totalTokens: b.total,
        // Omitted when this model never hit a cache, so the shape is unchanged
        // for runs where caching never applied.
        ...(b.cacheRead > 0 || b.cacheWrite > 0
          ? {
              noCacheInputTokens: b.noCache,
              cacheReadInputTokens: b.cacheRead,
              cacheWriteInputTokens: b.cacheWrite,
            }
          : {}),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
  }

  /**
   * Create a child tracker whose recordings propagate to this parent.
   * Used per-evaluator so individual usage is readable while the parent
   * accumulates the run-level total.
   */
  child(): TokenTracker {
    return new ChildTracker(this);
  }
}

/**
 * A child tracker that records to itself AND to its parent. Used per-evaluator
 * so the evaluator's own usage is available while the parent accumulates the
 * run-level total.
 */
class ChildTracker extends TokenTracker {
  constructor(private readonly parent: TokenTracker) {
    super();
  }

  override record(
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cache?: InputCacheSplit;
    },
    attribution?: RecordAttribution
  ): void {
    super.record(usage, attribution);
    this.parent.record(usage, attribution);
  }
}
