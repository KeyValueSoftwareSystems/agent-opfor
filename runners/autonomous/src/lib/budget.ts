// Cost/rate guardrails for an autonomous run.

export interface BudgetGuardOptions {
  maxThreadTurns: number;
  budgetUsd?: number;
  /** Max target HTTP calls per rolling minute (token bucket). */
  maxTargetCallsPerMinute?: number;
}

export class BudgetGuard {
  readonly maxThreadTurns: number;
  readonly budgetUsd?: number;
  private readonly maxPerMinute: number;
  private callTimestamps: number[] = [];
  private lastKnownCostUsd = 0;

  constructor(opts: BudgetGuardOptions) {
    this.maxThreadTurns = opts.maxThreadTurns;
    this.budgetUsd = opts.budgetUsd;
    this.maxPerMinute = opts.maxTargetCallsPerMinute ?? 60;
  }

  /** Record the latest known cumulative cost (from SDK result/usage messages). */
  recordCost(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > this.lastKnownCostUsd) {
      this.lastKnownCostUsd = costUsd;
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
    const now = Date.now();
    const windowStart = now - 60_000;
    this.callTimestamps = this.callTimestamps.filter((t) => t > windowStart);
    if (this.callTimestamps.length >= this.maxPerMinute) {
      const oldest = this.callTimestamps[0];
      const waitMs = Math.max(0, oldest + 60_000 - now);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    }
    this.callTimestamps.push(Date.now());
  }
}
