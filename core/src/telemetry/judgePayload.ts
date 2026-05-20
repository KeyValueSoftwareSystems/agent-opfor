/** Canonical defaults for the judge trace payload — use these in new connectors. */
export const JUDGE_PAYLOAD_DEFAULTS = {
  maxChars: 40_000,
};

/**
 * Shared helper for telemetry adapters: serialize a hydrated trace into a
 * truncated JSON string suitable for the LLM judge prompt.
 *
 * Used by `fetchTraceForJudge` in each provider so the truncation marker and
 * char budget enforcement are consistent.
 */
export function stringifyForJudge(value: unknown, maxChars: number): string {
  let s: string;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n...[truncated, ${s.length} chars total]`;
}
