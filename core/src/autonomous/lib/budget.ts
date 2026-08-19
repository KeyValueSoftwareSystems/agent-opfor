// Cost/rate guardrails for an autonomous run.
//
// Cost is estimated from token usage via the shared `pricing/` table. Hunt used to carry its own
// hardcoded opus/sonnet/haiku price map that silently priced every unrecognized model as Sonnet —
// harmless while hunt was Claude-only, wrong the moment it can run on any provider.
//
// Note there is no longer a server-authoritative total to correct drift against (the Claude Agent
// SDK supplied one; the AI SDK does not), so `spentUsd` is an estimate throughout. It is
// cache-aware, which is what dominates accuracy on a long run with a large static system prompt.

import type { LanguageModel } from "ai";
import { RateLimiter } from "../../lib/rateLimiter.js";
import { TokenTracker } from "../../execute/tokenTracker.js";
import { estimateRunCost } from "../../pricing/estimateCost.js";

/** Token usage as the AI SDK reports it on a completed step. */
export interface StepUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface BudgetGuardOptions {
  maxThreadTurns: number;
  budgetUsd?: number;
  /** Max target HTTP calls per rolling minute (token bucket). */
  maxTargetCallsPerMinute?: number;
  /** Hard ceiling on total attack threads (tree size); fork is refused past this. */
  maxTotalThreads?: number;
  /** Hard ceiling on direct forks (children) of any one thread (fan-out). */
  maxForksPerThread?: number;
  /** Max exploration generations (follow-up waves) spawned from leads. */
  maxDepth?: number;
  /**
   * Hard ceiling on total target sends across the whole run — the DETERMINISTIC, real-time cost
   * backstop. The USD ceiling is an estimate that lags actual spend; this caps work as it happens.
   * Defaults to ~20 sends per budget-USD (≈$0.05/send), or 200.
   */
  maxTotalSends?: number;
}

export class BudgetGuard {
  readonly maxThreadTurns: number;
  readonly budgetUsd?: number;
  readonly maxTotalThreads: number;
  readonly maxForksPerThread: number;
  readonly maxDepth: number;
  readonly maxTotalSends: number;
  /** Per-model token accounting; also feeds the report's usage stats. */
  readonly tokens = new TokenTracker();
  private readonly rateLimiter: RateLimiter;
  private sendsUsed = 0;

  constructor(opts: BudgetGuardOptions) {
    this.maxThreadTurns = opts.maxThreadTurns;
    this.budgetUsd = opts.budgetUsd;
    this.maxTotalThreads = opts.maxTotalThreads ?? 40;
    this.maxForksPerThread = opts.maxForksPerThread ?? 4;
    this.maxDepth = opts.maxDepth ?? 3;
    this.maxTotalSends =
      opts.maxTotalSends ?? (opts.budgetUsd ? Math.ceil(opts.budgetUsd * 20) : 200);
    this.rateLimiter = new RateLimiter(opts.maxTargetCallsPerMinute ?? 60);
  }

  /** Tally a target send (called once per actual call to the target). */
  recordSend(): void {
    this.sendsUsed++;
  }
  get sends(): number {
    return this.sendsUsed;
  }

  /**
   * Deterministic runaway guard for `send_to_target`, checked BEFORE the call: caps total target
   * sends (the real-time cost backstop) and total threads (opening a NEW thread is refused past the
   * tree ceiling — this is what bounds the thread explosion that dispatch, unlike fork, otherwise
   * escapes).
   */
  sendAllowed(isNewThread: boolean, totalThreads: number): { ok: boolean; reason?: string } {
    if (this.sendsUsed >= this.maxTotalSends) {
      return {
        ok: false,
        reason: `global send budget reached (${this.maxTotalSends} target calls) — stop and record/synthesize`,
      };
    }
    if (isNewThread && totalThreads >= this.maxTotalThreads) {
      return {
        ok: false,
        reason: `thread ceiling reached (${this.maxTotalThreads} threads) — deepen or stop an existing thread, don't open new ones`,
      };
    }
    return { ok: true };
  }

  /** Whether a lead at exploration generation `gen` may still be expanded into a follow-up. */
  depthAllowed(gen: number): boolean {
    return gen <= this.maxDepth;
  }

  /**
   * Whether a fork is allowed: bounded by total tree size and per-parent fan-out. (True
   * concurrency is already governed by the dispatch wave size; these are the runaway backstops.)
   */
  forkAllowed(totalThreads: number, childrenOfParent: number): { ok: boolean; reason?: string } {
    if (totalThreads >= this.maxTotalThreads) {
      return { ok: false, reason: `tree-size ceiling reached (${this.maxTotalThreads} threads)` };
    }
    if (childrenOfParent >= this.maxForksPerThread) {
      return {
        ok: false,
        reason: `fan-out ceiling reached (${this.maxForksPerThread} forks of this thread)`,
      };
    }
    return { ok: true };
  }

  /**
   * Accumulate usage from one completed agent step, attributed to the model that served it so
   * each model is priced at its own rate. `model` is the AI SDK model instance — `createModel()`
   * records its provider/model identity, which is what the tracker resolves.
   */
  recordUsage(usage: StepUsage | undefined, model: LanguageModel, role: string): void {
    if (!usage) return;
    const details = usage.inputTokenDetails;
    const cache =
      details &&
      (details.noCacheTokens !== undefined ||
        details.cacheReadTokens !== undefined ||
        details.cacheWriteTokens !== undefined)
        ? {
            noCache: details.noCacheTokens ?? 0,
            cacheRead: details.cacheReadTokens ?? 0,
            cacheWrite: details.cacheWriteTokens ?? 0,
          }
        : undefined;

    this.tokens.record(
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cache,
      },
      { model, role }
    );
  }

  /**
   * Estimated spend so far, in USD. Models the price table doesn't know contribute 0 — the
   * estimate is a lower bound, which is why `maxTotalSends` exists as the hard backstop.
   */
  get spentUsd(): number {
    return estimateRunCost(this.tokens.breakdown)?.totalUsd ?? 0;
  }

  /** True when a hard USD ceiling is configured and the estimate has reached it. */
  isOverBudget(): boolean {
    return this.budgetUsd !== undefined && this.spentUsd >= this.budgetUsd;
  }

  /** Whether a thread may take another turn. */
  threadTurnAllowed(currentTurnCount: number): boolean {
    return currentTurnCount < this.maxThreadTurns;
  }

  /**
   * Throttle target calls to the configured rate. Resolves immediately if under
   * the limit; otherwise waits until the oldest call in the window ages out.
   */
  async awaitTargetSlot(): Promise<void> {
    await this.rateLimiter.acquire();
  }
}
