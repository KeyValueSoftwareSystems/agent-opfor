import type { TelemetryConfig } from "../../../config/types.js";
import type { JudgeFetchOpts, TelemetryAdapter, TraceListResult } from "../../adapter.js";
import {
  fetchNetraTracesListPage,
  fetchNetraTraceJsonForJudge,
  hydrateNetraTraceRecord,
} from "./traces.js";

export const netraAdapter: TelemetryAdapter = {
  async fetchTraceList(telemetry: TelemetryConfig): Promise<TraceListResult | null> {
    const fetched = await fetchNetraTracesListPage(telemetry);
    if (!fetched) return null;
    return { traces: fetched.listRows, providerLabel: "Netra" };
  },

  async hydrateTrace(telemetry: TelemetryConfig, traceId: string): Promise<unknown | null> {
    return hydrateNetraTraceRecord(telemetry, traceId);
  },

  async fetchTraceForJudge(
    telemetry: TelemetryConfig,
    traceId: string,
    opts: JudgeFetchOpts
  ): Promise<string | null> {
    const result = await fetchNetraTraceJsonForJudge(telemetry, traceId, {
      initialDelayMs: opts.initialDelayMs,
      maxAttempts: opts.maxAttempts,
      retryDelayMs: opts.retryDelayMs,
      maxJsonChars: opts.maxChars,
    });
    return result ?? null;
  },
};
