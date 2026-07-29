/**
 * Lightweight accumulator for LLM token usage across a run.
 *
 * Created per-run and threaded through RunAllOptions → EvaluatorLoopContext →
 * attack drivers. Each `generateText` / `generateObject` call site records its
 * usage after the call completes (including retries). Aggregated totals are
 * surfaced in the CLI summary, HTML/JSON report, and extension popup.
 */

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
 * Accumulator for LLM token usage.
 *
 * One root instance is created per run and threaded through the execution
 * pipeline. Call {@link child} to create per-evaluator sub-trackers whose
 * recordings automatically propagate to the parent.
 */
export class TokenTracker {
  private input = 0;
  private output = 0;

  /** Record usage from a single LLM call. Safe to call with undefined/partial usage. */
  record(usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): void {
    if (!usage) return;
    this.input += usage.inputTokens ?? 0;
    this.output += usage.outputTokens ?? 0;
  }

  /** Current accumulated totals (input + output = total). */
  get totals(): TokenUsage {
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      totalTokens: this.input + this.output,
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
