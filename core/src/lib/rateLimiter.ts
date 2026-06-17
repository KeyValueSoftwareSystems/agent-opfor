/**
 * Sliding-window rate limiter. Caps the number of calls within a rolling
 * time window (default 60 s). When the limit is hit, `acquire()` awaits
 * until the oldest call in the window ages out.
 *
 * Thread-safe for single-threaded async: only one waiter resolves per
 * slot, and the timestamp is recorded after the wait.
 */
export class RateLimiter {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(maxPerWindow: number, windowMs = 60_000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  /** Wait until a slot is available, then record the call. */
  async acquire(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > windowStart);
    if (this.timestamps.length >= this.maxPerWindow) {
      const oldest = this.timestamps[0];
      const waitMs = Math.max(0, oldest + this.windowMs - now);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    }
    this.timestamps.push(Date.now());
  }
}
