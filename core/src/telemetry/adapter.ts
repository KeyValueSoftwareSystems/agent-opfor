import type { TelemetryConfig, TelemetryProviderId } from "../config/types.js";

export interface TraceListResult {
  /** Raw trace rows from the provider — passed to the curator LLM as JSON. */
  traces: unknown[];
  providerLabel: string;
}

export interface JudgeFetchOpts {
  initialDelayMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  maxChars: number;
}

/**
 * Provider-agnostic telemetry adapter interface.
 * Implement this for each observability backend (Langfuse, Netra, Datadog, …).
 */
export interface TelemetryAdapter {
  /**
   * Fetch a flat list of trace rows for curation during `opfor setup`.
   * Returns null if credentials are missing or the provider is misconfigured.
   */
  fetchTraceList(telemetry: TelemetryConfig): Promise<TraceListResult | null>;

  /**
   * Load a single trace with all its spans/observations merged — used during
   * setup curation to hydrate the traces the curator LLM selected.
   * Returns null if the trace is unavailable or credentials are missing.
   */
  hydrateTrace(telemetry: TelemetryConfig, traceId: string): Promise<unknown | null>;

  /**
   * After an attack, wait for the trace to be available (ingestion lag) and return
   * a truncated JSON string for the LLM judge.  Returns null when not available.
   */
  fetchTraceForJudge(
    telemetry: TelemetryConfig,
    traceId: string,
    opts: JudgeFetchOpts
  ): Promise<string | null>;
}

import { langfuseAdapter } from "./providers/langfuse/adapter.js";
import { netraAdapter } from "./providers/netra/adapter.js";

/**
 * Return the adapter for the given provider, or null for "none" / unknown providers.
 * Adding a new provider = implement `TelemetryAdapter` + one line here.
 */
export function getAdapter(provider: TelemetryProviderId): TelemetryAdapter | null {
  if (provider === "langfuse") return langfuseAdapter;
  if (provider === "netra") return netraAdapter;
  return null;
}
