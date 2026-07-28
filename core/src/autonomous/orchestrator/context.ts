// Shared run context wired into every tool handler.

import type { TargetClient } from "../target/http.js";
import type { KnowledgeBase } from "../knowledge/types.js";
import type { RunLog } from "../state/runLog.js";
import type { BudgetGuard } from "../lib/budget.js";
import type { SessionGate } from "../../lib/sessionGate.js";
import type { HuntOptions } from "../lib/types.js";
import type { ProgressReporter } from "../state/hooks.js";
import type { TelemetryCapabilities, TraceCache, TraceRoundTrip } from "../lib/telemetry.js";

export interface RunContext {
  options: HuntOptions;
  target: TargetClient;
  knowledge: KnowledgeBase;
  runLog: RunLog;
  budget: BudgetGuard;
  /** Serializes concurrent sends on the same threadId (per-threadId mutex). */
  sessionGate: SessionGate;
  /** Verifier (self_check) is enabled when this is true and a key is present. */
  verifyEnabled: boolean;
  /** Which trace-aware capabilities the telemetry config unlocks (single source of truth). */
  telemetryCaps: TelemetryCapabilities;
  /** Preflight verdict: whether the target echoed our injected trace id back into the backend. */
  traceRoundTrip?: TraceRoundTrip;
  /** Per-run memo of completed trace JSON, shared across findings/judge/get_trace. */
  traceCache: TraceCache;
  /** Optional live progress reporter; tool handlers emit accurate lines here. */
  reporter?: ProgressReporter;
}

/** Collapse whitespace and truncate, for live-log snippets. */
export function snip(value: unknown, max = 150): string {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const one = str.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}
