export interface PollOpts {
  initialDelayMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

/** Canonical defaults for judge trace polling — use these in new connectors. */
export const POLL_DEFAULTS: PollOpts = {
  initialDelayMs: 500,
  maxAttempts: 5,
  retryDelayMs: 400,
};

/**
 * Wait initialDelayMs, then call fn() up to maxAttempts times.
 * Returns the first non-null result, or null if all attempts fail.
 */
export async function pollUntilResult<T>(
  fn: (attempt: number) => Promise<T | null>,
  opts: PollOpts
): Promise<T | null> {
  await sleep(opts.initialDelayMs);
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const result = await fn(attempt);
    if (result !== null) return result;
    if (attempt < opts.maxAttempts - 1) await sleep(opts.retryDelayMs);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
