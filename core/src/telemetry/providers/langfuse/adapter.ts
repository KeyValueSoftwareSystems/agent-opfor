import type { TelemetryConfig } from "../../../config/types.js";
import type { JudgeFetchOpts, TelemetryAdapter, TraceListResult } from "../../adapter.js";
import {
  fetchLangfuseTracesListPage,
  fetchLangfuseTraceJsonForJudge,
  hydrateLangfuseTraceRecord,
} from "./traces.js";

export const langfuseAdapter: TelemetryAdapter = {
  async fetchTraceList(telemetry: TelemetryConfig): Promise<TraceListResult | null> {
    const fetched = await fetchLangfuseTracesListPage(telemetry);
    if (!fetched) return null;

    const body = fetched.listBody as { data?: unknown[] } | null | undefined;
    const traces = Array.isArray(body?.data) ? (body!.data as unknown[]) : [];
    return { traces, providerLabel: "Langfuse" };
  },

  async hydrateTrace(telemetry: TelemetryConfig, traceId: string): Promise<unknown | null> {
    return hydrateLangfuseTraceRecord(telemetry, traceId);
  },

  async fetchTraceForJudge(
    telemetry: TelemetryConfig,
    traceId: string,
    opts: JudgeFetchOpts
  ): Promise<string | null> {
    const result = await fetchLangfuseTraceJsonForJudge(telemetry, traceId, {
      initialDelayMs: opts.initialDelayMs,
      maxAttempts: opts.maxAttempts,
      retryDelayMs: opts.retryDelayMs,
      maxJsonChars: opts.maxChars,
    });
    return result ?? null;
  },
};
