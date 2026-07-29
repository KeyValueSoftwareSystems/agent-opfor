/**
 * Lightweight accumulator for LLM token usage across a run.
 *
 * Created per-run and threaded through RunAllOptions → EvaluatorLoopContext →
 * attack drivers. Each `generateText` / `generateObject` call site records its
 * usage after the call completes (including retries). Aggregated totals are
 * surfaced in the CLI summary, HTML/JSON report, and extension popup.
 */

import { z } from "zod";

/** Aggregated input/output/total token counts from LLM calls. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Shared zero-value constant to avoid re-allocating empty usage objects. */
export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

/**
 * Zod schema for validating LLM usage objects before recording.
 * Coerces non-negative numbers, defaults missing fields to 0.
 */
export const LlmUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0).optional().default(0),
    outputTokens: z.number().int().min(0).optional().default(0),
    totalTokens: z.number().int().min(0).optional().default(0),
  })
  .strict()
  .transform((u) => ({
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens > 0 ? u.totalTokens : u.inputTokens + u.outputTokens,
  }));

/**
 * Validate and normalize a raw usage object (from any provider/SDK) into a
 * clean {@link TokenUsage}. Returns `undefined` when the input is falsy or
 * fails validation so callers can safely discard garbage.
 */
export function parseUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const result = LlmUsageSchema.safeParse(raw);
  return result.success ? result.data : undefined;
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

  /**
   * Record usage from a single LLM call. Safe to call with undefined/partial
   * usage. When `totalTokens` is supplied it is preserved; otherwise it falls
   * back to `inputTokens + outputTokens`.
   */
  record(usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): void {
    if (!usage) return;
    const inp = usage.inputTokens ?? 0;
    const out = usage.outputTokens ?? 0;
    const tot = usage.totalTokens ?? 0;
    this.input += inp;
    this.output += out;
    this.total += tot > 0 ? tot : inp + out;
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

  override record(usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): void {
    super.record(usage);
    this.parent.record(usage);
  }
}
