import type { LangfuseTelemetryConfig, TelemetryConfig } from "./types.js";

/**
 * Apply env-based overrides for telemetry (e.g. Langfuse host from LANGFUSE_BASE_URL).
 * Mutates a shallow copy so the original config object is not modified.
 */
export function resolveTelemetryEnv(telemetry: TelemetryConfig | undefined): TelemetryConfig | undefined {
  if (!telemetry) return undefined;

  const out: TelemetryConfig = { ...telemetry };
  if (telemetry.provider !== "langfuse" || !telemetry.langfuse) return out;

  const lf: LangfuseTelemetryConfig = { ...telemetry.langfuse };
  const envKey = lf.baseUrlEnv?.trim();
  if (envKey) {
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) lf.baseUrl = fromEnv;
  }
  out.langfuse = lf;
  return out;
}
