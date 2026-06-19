import { stringifyForJudge, JUDGE_PAYLOAD_DEFAULTS } from "./judgePayload.js";
import { POLL_DEFAULTS } from "./pollingUtils.js";
import { log } from "../lib/logger.js";

/**
 * Provider-agnostic "fetch a trace for the LLM judge, waiting until it is COMPLETE".
 *
 * Observability backends ingest spans/observations in batches with lag, and the
 * final turn (often where the leak is) usually lands last. Returning the trace the
 * instant *any* span appears feeds the judge a partial trace. This helper polls
 * until the snapshot is complete, then serializes it.
 *
 * Completeness:
 *   1. If `expectedResponse` is given (the attack's final assistant message), the
 *      trace is complete once that text appears in the serialized snapshot — the
 *      strong, semantic signal that the last turn has been ingested.
 *   2. Otherwise, fall back to snapshot-size settling (two consecutive equal,
 *      non-empty serializations).
 *
 * Bounded: total wait ≤ initialDelay + (maxAttempts-1)·retryDelay. On timeout the
 * most-complete snapshot seen is returned, tagged `_incomplete: true` (+ a warn), so
 * a slow/backlogged platform never stalls the run — the judge always also has the
 * full conversation transcript as primary evidence.
 *
 * Each provider supplies only `fetchSnapshot` (and an optional pre-serialize
 * `transform`); the poll/completeness/best-effort/truncation logic is shared so all
 * providers behave identically. See "Adding a telemetry provider" in CONTRIBUTING.md.
 */
export interface PollTraceForJudgeOpts {
  traceId: string;
  /** Provider name for log lines, e.g. "netra" / "langfuse". */
  providerLabel: string;
  expectedResponse?: string;
  budget: { initialDelayMs?: number; maxAttempts?: number; retryDelayMs?: number };
  maxChars?: number;
  /** Fetch the current snapshot to serialize for the judge; return null when nothing is available yet. */
  fetchSnapshot: (attempt: number) => Promise<unknown | null>;
  /** Optional pre-serialize transform applied to the final payload (e.g. dedupe repeated system prompts). */
  transform?: (snapshot: unknown) => unknown;
  /** Message returned when nothing ever ingested within the budget. */
  notFound?: (attempts: number) => string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Lowercase alphanumerics — makes the completeness match survive JSON escaping,
 *  whitespace, and minor formatting differences between the live response and the stored copy. */
const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return String(v);
  }
}

function withIncompleteMarker(snapshot: unknown, useResponseCheck: boolean): unknown {
  const reason = useResponseCheck
    ? "Final response not found in trace within the poll budget — likely ingestion lag; this trace may be missing the last turn. Judge primarily on the conversation transcript."
    : "Snapshot had not settled within the poll budget; this trace may be partial.";
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    return {
      _incomplete: true,
      _incompleteReason: reason,
      ...(snapshot as Record<string, unknown>),
    };
  }
  return { _incomplete: true, _incompleteReason: reason, trace: snapshot };
}

export async function pollTraceForJudge(opts: PollTraceForJudgeOpts): Promise<string> {
  const { traceId, providerLabel, expectedResponse, fetchSnapshot, transform } = opts;
  const initialDelayMs = opts.budget.initialDelayMs ?? POLL_DEFAULTS.initialDelayMs;
  const maxAttempts = opts.budget.maxAttempts ?? POLL_DEFAULTS.maxAttempts;
  const retryDelayMs = opts.budget.retryDelayMs ?? POLL_DEFAULTS.retryDelayMs;
  const maxChars = opts.maxChars ?? JUDGE_PAYLOAD_DEFAULTS.maxChars;

  const needle = expectedResponse ? alnum(expectedResponse).slice(0, 40) : "";
  const useResponseCheck = needle.length >= 12; // long enough to be unique; short replies use settling

  await sleep(initialDelayMs);

  let bestSnapshot: unknown = undefined;
  let bestLen = -1;
  let prevLen = -1;
  let stableStreak = 0;
  let complete = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snapshot = await fetchSnapshot(attempt);
    let curLen = 0;
    let done = false;

    if (snapshot != null) {
      const serialized = safeStringify(snapshot);
      curLen = serialized.length;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestSnapshot = snapshot;
      }
      if (useResponseCheck) {
        if (alnum(serialized).includes(needle)) {
          done = true;
        }
      } else if (curLen > 0 && curLen === prevLen) {
        stableStreak += 1;
        if (stableStreak >= 1) {
          done = true;
        }
      } else {
        stableStreak = 0;
      }
    }

    if (done) {
      complete = true;
      break;
    }
    prevLen = curLen;
    if (attempt < maxAttempts - 1) await sleep(retryDelayMs);
  }

  if (bestSnapshot === undefined) {
    return (
      opts.notFound?.(maxAttempts) ??
      `[${providerLabel} trace not available after ${maxAttempts} attempt(s). Trace id: ${traceId}]`
    );
  }

  if (!complete) {
    log.warn(
      `${providerLabel} trace ${traceId} may be INCOMPLETE — returning best-effort snapshot after ${maxAttempts} attempt(s). ` +
        `If your observability platform ingests slowly, raise traceFetchMaxAttempts / traceFetchRetryDelayMs / traceFetchInitialDelayMs.`
    );
  }

  let payload = complete ? bestSnapshot : withIncompleteMarker(bestSnapshot, useResponseCheck);
  if (transform) payload = transform(payload);

  return stringifyForJudge(payload, maxChars);
}
