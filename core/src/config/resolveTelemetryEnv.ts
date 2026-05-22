import type { LangfuseTelemetryConfig, NetraTelemetryConfig, TelemetryConfig } from "./types.js";
import { getEnv } from "../lib/env.js";

/**
 * Apply env-based overrides for telemetry (e.g. host from LANGFUSE_BASE_URL or NETRA_BASE_URL).
 * Mutates a shallow copy so the original config object is not modified.
 */
export function resolveTelemetryEnv(
  telemetry: TelemetryConfig | undefined
): TelemetryConfig | undefined {
  if (!telemetry) return undefined;

  const out: TelemetryConfig = { ...telemetry };

  if (telemetry.provider === "langfuse" && telemetry.langfuse) {
    const lf: LangfuseTelemetryConfig = { ...telemetry.langfuse };
    const envKey = lf.baseUrlEnv?.trim();
    if (envKey) {
      const fromEnv = getEnv(envKey)?.trim();
      if (fromEnv) lf.baseUrl = fromEnv;
    }
    out.langfuse = lf;
  }

  if (telemetry.provider === "netra" && telemetry.netra) {
    const nt: NetraTelemetryConfig = { ...telemetry.netra };
    const envKey = nt.baseUrlEnv?.trim();
    if (envKey) {
      const fromEnv = getEnv(envKey)?.trim();
      if (fromEnv) nt.baseUrl = fromEnv;
    }
    out.netra = nt;
  }

  return out;
}
