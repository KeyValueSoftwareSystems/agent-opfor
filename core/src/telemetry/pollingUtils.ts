export interface PollOpts {
  initialDelayMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

/**
 * Canonical defaults for judge trace polling — use these in new connectors.
 * Sized for completeness polling (wait for the final turn to ingest, not just the
 * first span): ~1s head start + 7×1.5s ≈ 11.5s hard cap before returning best-effort.
 */
export const POLL_DEFAULTS: PollOpts = {
  initialDelayMs: 1000,
  maxAttempts: 8,
  retryDelayMs: 1500,
};
