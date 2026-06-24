// Cost/rate guardrails for an autonomous run.

import { RateLimiter } from "../../lib/rateLimiter.js";

// Approximate Claude pricing in USD per million tokens (as of mid-2025).
// Used to estimate running cost from streaming token counts before the SDK
// emits a final total_cost_usd. The result message corrects any drift.
const MODEL_PRICES: Record<
  string,
  { inputPerM: number; outputPerM: number; cacheWritePerM: number; cacheReadPerM: number }
> = {
  opus: { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.5 },
  sonnet: { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.3 },
  haiku: { inputPerM: 0.8, outputPerM: 4, cacheWritePerM: 1.0, cacheReadPerM: 0.08 },
};
const DEFAULT_PRICES = MODEL_PRICES.sonnet;

function resolvePrices(modelHint?: string) {
  if (!modelHint) return DEFAULT_PRICES;
  const lower = modelHint.toLowerCase();
  if (lower.includes("opus")) return MODEL_PRICES.opus;
  if (lower.includes("haiku")) return MODEL_PRICES.haiku;
  return MODEL_PRICES.sonnet;
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
   * backstop. The USD ceiling is only known after SDK result messages (it lags and overshoots);
   * this caps work as it happens. Defaults to ~20 sends per budget-USD (≈$0.05/send), or 200.
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
  private readonly rateLimiter: RateLimiter;
  private lastKnownCostUsd = 0;
  private accumulatedTokenCostUsd = 0;
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
   * concurrency is already governed by the SDK's subagent cap; these are the runaway backstops.)
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

  /** Record the latest known cumulative cost (from SDK result/usage messages). Corrects estimation drift. */
  recordCost(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > this.lastKnownCostUsd) {
      this.lastKnownCostUsd = costUsd;
      // Keep accumulated estimate in sync so it doesn't double-count after correction.
      if (costUsd > this.accumulatedTokenCostUsd) {
        this.accumulatedTokenCostUsd = costUsd;
      }
    }
  }

  /**
   * Accumulate token usage from a streaming assistant message. Updates `lastKnownCostUsd`
   * so `isOverBudget()` can fire mid-stream rather than only after result messages.
   * Uses a model price table — drift is corrected when `recordCost()` receives the
   * server's authoritative `total_cost_usd` from the final result message.
   */
  recordTokenUsage(
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
    },
    modelHint?: string
  ): void {
    const prices = resolvePrices(modelHint);
    const cost =
      (usage.inputTokens * prices.inputPerM +
        usage.outputTokens * prices.outputPerM +
        usage.cacheCreationInputTokens * prices.cacheWritePerM +
        usage.cacheReadInputTokens * prices.cacheReadPerM) /
      1_000_000;
    this.accumulatedTokenCostUsd += cost;
    if (this.accumulatedTokenCostUsd > this.lastKnownCostUsd) {
      this.lastKnownCostUsd = this.accumulatedTokenCostUsd;
    }
  }

  get spentUsd(): number {
    return this.lastKnownCostUsd;
  }

  /** True when a hard USD ceiling is configured and has been reached. */
  isOverBudget(): boolean {
    return this.budgetUsd !== undefined && this.lastKnownCostUsd >= this.budgetUsd;
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
