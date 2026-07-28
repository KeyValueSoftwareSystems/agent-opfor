// Trace-aware grounding for `opfor hunt`: fetch + curate historic production traces
// before the commander plans, so attack generation is grounded in real user flows.
// Reuses the run engine's telemetry curation wholesale — this only supplies the model
// handle (hunt's brain is the Claude Agent SDK, which does not build a plain model).

import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { HuntOptions } from "./types.js";
import type { TelemetryConfig, TelemetryPropagationConfig } from "../../config/types.js";
import type { RunLog, ThreadState } from "../state/runLog.js";
import type { TargetClient } from "../target/http.js";
import { resolveModelId } from "./models.js";
import { createModel } from "../../providers/factory.js";
import { getAdapter } from "../../telemetry/adapter.js";
import { runSetupTraceCuration } from "../../telemetry/curation.js";
import { newOtelTraceId, buildPropagatedHeaders } from "../../lib/tracePropagation.js";
import { expandEnvInHeaders } from "../../lib/env.js";
import { log } from "../../lib/logger.js";

/**
 * Build a plain Vercel-AI model for the curator/summarizer LLM.
 *
 * `createAnthropic` needs a literal API key, which hunt's subscription/OAuth auth paths
 * don't expose. Two modes are supported:
 *  - direct key: `ANTHROPIC_API_KEY`
 *  - gateway:    `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
 * Returns `undefined` when neither is available (subscription/OAuth-only) so the caller
 * can skip grounding rather than fail the run.
 */
export function buildCuratorModel(commanderModel: string): LanguageModel | undefined {
  const modelId = resolveModelId(commanderModel);

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return createModel({ provider: "anthropic", model: modelId, apiKeyEnv: "ANTHROPIC_API_KEY" });
  }

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (baseURL && authToken) {
    // The factory's anthropic entry sets no baseURL, so build the gateway case directly.
    return createAnthropic({ apiKey: authToken, baseURL })(modelId);
  }

  return undefined;
}

/**
 * If telemetry is configured, curate historic traces into a markdown summary that grounds
 * attack generation. Mirrors the run engine's `curateTracesIfConfigured` (runAll.ts): guard,
 * then swallow errors so a curation failure never aborts the hunt.
 */
export async function curateHuntTracesIfConfigured(
  options: HuntOptions,
  outputDir: string
): Promise<string | undefined> {
  const telemetry = options.telemetry;
  if (!telemetry || telemetry.provider === "none") return undefined;
  if (!getAdapter(telemetry.provider)) return undefined;

  const model = buildCuratorModel(options.commanderModel);
  if (!model) {
    log.info(
      `\n[telemetry] Skip trace grounding: the curator LLM needs an Anthropic API key ` +
        `(ANTHROPIC_API_KEY, or ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN for a gateway). ` +
        `A subscription/OAuth login can drive the hunt but not the curator. Hunt continues ungrounded.\n`
    );
    return undefined;
  }

  try {
    return await runSetupTraceCuration({
      telemetry,
      model,
      targetName: options.target.name,
      targetDescription: options.objective,
      outputDir,
    });
  } catch (err) {
    log.warn(
      `[telemetry] Trace grounding failed (continuing ungrounded): ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

/** True when propagation would actually inject something (a header or a body field). */
function hasPropagation(prop: TelemetryPropagationConfig | undefined): boolean {
  return (
    Boolean(prop?.headers && Object.keys(prop.headers).length > 0) ||
    Boolean(prop?.traceIdBodyField?.trim())
  );
}

/**
 * The three INDEPENDENT trace-aware capabilities a telemetry config unlocks. They are gated
 * separately on purpose: grounding works on any instrumented backend, but propagation +
 * enrichment additionally need the TARGET to echo our injected trace id into its own telemetry.
 * This is the single source of truth — every gate reads it instead of re-deriving `provider`.
 */
export interface TelemetryCapabilities {
  /** Curate historic traces to ground attack planning. Needs a provider + adapter only. */
  grounding: boolean;
  /** Mint + send a trace id per thread and offer `get_trace`. Needs propagation configured. */
  propagation: boolean;
  /** Auto-attach the recorded trace to findings/judge. Needs a propagated id + the opt-in flag. */
  enrichment: boolean;
}

export function telemetryCapabilities(t: TelemetryConfig | undefined): TelemetryCapabilities {
  const grounding = Boolean(t && t.provider !== "none" && getAdapter(t.provider));
  const propagation = grounding && hasPropagation(t!.propagation);
  const enrichment = propagation && Boolean(t!.enrichJudgeFromTrace);
  return { grounding, propagation, enrichment };
}

/**
 * Resolve (minting lazily) the OTEL trace id to propagate for a thread's send. Returns
 * undefined when telemetry propagation isn't configured. `per-run` shares one id across the
 * whole hunt; `per-attack` (default) mints one id per thread, reused across its turns.
 */
export function resolveThreadTraceId(
  telemetry: TelemetryConfig | undefined,
  runLog: RunLog,
  thread: ThreadState
): string | undefined {
  const prop = telemetry?.propagation;
  if (!hasPropagation(prop)) return undefined;
  if ((prop!.traceIdStrategy ?? "per-attack") === "per-run") {
    runLog.traceId ??= newOtelTraceId();
    return runLog.traceId;
  }
  thread.traceId ??= newOtelTraceId();
  return thread.traceId;
}

export interface SendPropagation {
  extraHeaders?: Record<string, string>;
  traceIdBodyField?: string;
  traceId: string;
}

/**
 * Build the per-send propagation payload (env-expanded headers + optional body field) for a
 * resolved trace id. Header values support `{{traceId}}`/`{{runId}}`/`{{attackIndex}}`
 * placeholders and `${VAR}` env substitution, matching `opfor run`.
 */
export function buildSendPropagation(
  telemetry: TelemetryConfig | undefined,
  traceId: string | undefined,
  opts: { runId: string; attackIndex: number }
): SendPropagation | undefined {
  const prop = telemetry?.propagation;
  if (!traceId || !hasPropagation(prop)) return undefined;
  const headers = buildPropagatedHeaders(prop, {
    otelTraceHex: traceId,
    runId: opts.runId,
    attackIndex: opts.attackIndex,
  });
  const extraHeaders = Object.keys(headers).length ? expandEnvInHeaders(headers) : undefined;
  return { extraHeaders, traceIdBodyField: prop!.traceIdBodyField?.trim() || undefined, traceId };
}

/** A per-run memo of completed trace JSON, keyed by trace id, shared across findings/judge/get_trace. */
export type TraceCache = Map<string, string>;

interface FetchTraceOpts {
  expectedResponse?: string;
  /** Per-run cache: a successful (completed) trace is stable, so memoize it by id. */
  cache?: TraceCache;
  /** Distinguishes cache entries for the same trace id across turns — see `traceCacheKey`. */
  cacheAnchor?: string;
  /** Override the retry ceiling — the interactive `get_trace` uses fewer so it can't stall the loop. */
  maxAttempts?: number;
}

/** Retry ceiling for the interactive `get_trace` tool + preflight — kept low so it can't stall. */
const GET_TRACE_MAX_ATTEMPTS = 3;

export type TraceRoundTrip = "ok" | "not-detected";

/**
 * Recon-time self-test: send ONE benign probe with propagation, then try to read the trace back
 * from the backend by the id we injected. This verifies the load-bearing assumption of propagation
 * + enrichment — that the target actually echoes our trace id into its own telemetry. A negative
 * result is advisory, not authoritative (ingestion lag can cause a false `not-detected`), so the
 * caller warns and continues rather than disabling the tooling. Runs a direct `target.send` (not
 * the `recon_probe` tool) so it neither consumes `maxReconProbes` nor pollutes the recon log.
 */
export async function probeTraceRoundTrip(
  telemetry: TelemetryConfig | undefined,
  target: TargetClient,
  runId: string
): Promise<TraceRoundTrip> {
  if (!telemetryCapabilities(telemetry).propagation) return "not-detected";
  const traceId = newOtelTraceId();
  const prop = buildSendPropagation(telemetry, traceId, { runId, attackIndex: 0 });
  if (!prop) return "not-detected";
  try {
    const sent = await target.send("Hi! Can you briefly tell me what you can help with?", {
      threadId: "telemetry-preflight",
      history: [],
      extraHeaders: prop.extraHeaders,
      traceIdBodyField: prop.traceIdBodyField,
      traceId: prop.traceId,
    });
    if (sent.isError) return "not-detected";
    const traceJson = await fetchTraceJson(telemetry!, traceId, {
      expectedResponse: sent.response,
      maxAttempts: GET_TRACE_MAX_ATTEMPTS,
    });
    return traceJson ? "ok" : "not-detected";
  } catch {
    return "not-detected";
  }
}

/**
 * Cache key for a trace fetch. A per-attack/per-run trace GROWS as turns are added, so one trace
 * id maps to different (larger) traces at different turns — a bare-id memo would hand back the
 * first turn's trace for every later turn (stale get_trace, missing later-turn evidence). Key on
 * the thread + turn anchor (not the response text) so distinct turns can never collide even when
 * the target replies with identical text (e.g. a repeated refusal); a finding and its self_check
 * share the same anchor, so they still hit. Falls back to the bare id when no anchor is given.
 */
export function traceCacheKey(traceId: string, anchor?: string): string {
  return anchor ? `${traceId}::${anchor}` : traceId;
}

/** Fetch a single trace as a truncated JSON string via the configured adapter (cache-aware). */
async function fetchTraceJson(
  telemetry: TelemetryConfig,
  traceId: string,
  opts: FetchTraceOpts = {}
): Promise<string | undefined> {
  const key = traceCacheKey(traceId, opts.cacheAnchor);
  const cached = opts.cache?.get(key);
  if (cached !== undefined) return cached;
  const adapter = getAdapter(telemetry.provider);
  if (!adapter) return undefined;
  const result =
    (await adapter.fetchTraceForJudge(telemetry, traceId, {
      initialDelayMs: telemetry.traceFetchInitialDelayMs ?? 1000,
      maxAttempts: opts.maxAttempts ?? telemetry.traceFetchMaxAttempts ?? 8,
      retryDelayMs: telemetry.traceFetchRetryDelayMs ?? 1500,
      maxChars: telemetry.enrichJudgeTraceJsonMaxChars ?? 40000,
      expectedResponse: opts.expectedResponse,
    })) ?? undefined;
  if (result !== undefined) opts.cache?.set(key, result);
  return result;
}

/**
 * Fetch the recorded target trace for a finding's cited turns, to enrich the report/judge with
 * tool calls and retrieval steps the visible reply never shows. Anchored at finding-commit time:
 * the thread's turns are complete (ingestion lag minimal) and only confirmed findings pay the cost.
 * Returns the trace JSON excerpt, or undefined when disabled / no trace id / unavailable.
 */
export async function fetchFindingTrace(
  telemetry: TelemetryConfig | undefined,
  thread: ThreadState,
  failingTurns: number[] | undefined,
  cache?: TraceCache
): Promise<string | undefined> {
  // Pure fetch — the CALLER decides when to invoke it. `record_finding` fetches to validate a
  // silent-leak citation whenever propagation sent an id (not only under the enrichment opt-in);
  // `self_check` and finding-attachment fetch only under enrichment. Gating here on `enrichment`
  // would make propagation-only get_trace citations un-verifiable, so the guard stays minimal.
  if (!telemetry || telemetry.provider === "none") return undefined;

  const primaryTurn = selectPrimaryTurn(thread, failingTurns);
  const traceId = primaryTurn?.traceId ?? thread.traceId;
  if (!traceId) return undefined;

  try {
    return await fetchTraceJson(telemetry, traceId, {
      expectedResponse: primaryTurn?.response,
      cacheAnchor: `${thread.threadId}#${primaryTurn?.turnIndex ?? "latest"}`,
      cache,
    });
  } catch (err) {
    log.warn(
      `[telemetry] Finding trace fetch failed (finding still recorded): ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

/**
 * Pick the turn whose trace id best represents a finding's cited turns. Prefers the LAST cited
 * failing turn — in a forked lineage inherited turns carry the PARENT's id and new turns carry the
 * child's, so the last cited turn points at the trace where the leak actually happened. Falls back
 * to the thread's latest turn when no valid turns are cited.
 */
export function selectPrimaryTurn(
  thread: ThreadState,
  failingTurns: number[] | undefined
): ThreadState["turns"][number] | undefined {
  const cited = (failingTurns ?? []).map((n) => thread.turns[n - 1]).filter(Boolean);
  return cited[cited.length - 1] ?? thread.turns[thread.turns.length - 1];
}

export type ThreadTraceResult =
  | { available: false; reason: string }
  | { available: true; traceId: string; traceJson: string };

/**
 * On-demand fetch of the recorded trace for a thread (optionally one turn), used by the
 * `get_trace` tool so an operator can inspect tool calls / retrieval a clean reply hid.
 */
export async function fetchThreadTrace(
  telemetry: TelemetryConfig | undefined,
  thread: ThreadState,
  turnIndex?: number,
  cache?: TraceCache
): Promise<ThreadTraceResult> {
  if (!telemetry || telemetry.provider === "none" || !getAdapter(telemetry.provider)) {
    return {
      available: false,
      reason:
        "Trace-aware testing is not configured for this run. Set telemetry.provider (langfuse/netra) in the hunt telemetry config to enable it.",
    };
  }
  if (!telemetry.propagation) {
    return {
      available: false,
      reason:
        "No trace propagation configured, so no trace id was sent to the target. Set telemetry.propagation (headers or traceIdBodyField) in the telemetry config to enable it.",
    };
  }
  if (
    typeof turnIndex === "number" &&
    (!Number.isInteger(turnIndex) || turnIndex < 1 || turnIndex > thread.turns.length)
  ) {
    const range =
      thread.turns.length > 0
        ? `Use a 1-based integer between 1 and ${thread.turns.length}, or omit turnIndex for the latest turn.`
        : "This thread has no turns yet — send a turn first (send_to_target), then retry.";
    return {
      available: false,
      reason: `Invalid turnIndex ${turnIndex}: this thread has ${thread.turns.length} turn(s). ${range}`,
    };
  }
  const turn =
    typeof turnIndex === "number"
      ? thread.turns[turnIndex - 1]
      : thread.turns[thread.turns.length - 1];
  const traceId = turn?.traceId ?? thread.traceId;
  if (!traceId) {
    return {
      available: false,
      reason:
        "No trace id recorded for that turn yet. Send a turn on this thread first (send_to_target), then retry.",
    };
  }
  try {
    const traceJson = await fetchTraceJson(telemetry, traceId, {
      expectedResponse: turn?.response,
      cacheAnchor: `${thread.threadId}#${turn?.turnIndex ?? turnIndex ?? "latest"}`,
      cache,
      maxAttempts: GET_TRACE_MAX_ATTEMPTS,
    });
    if (!traceJson) {
      return {
        available: false,
        reason:
          "Trace not available yet (ingestion lag) or the target did not report it. Retry shortly, and verify the target's tracing instrumentation is echoing the propagated trace id.",
      };
    }
    return { available: true, traceId, traceJson };
  } catch (err) {
    return {
      available: false,
      reason: `Trace fetch failed: ${err instanceof Error ? err.message : String(err)}. Verify the telemetry backend is reachable and its credentials are valid, then retry.`,
    };
  }
}
