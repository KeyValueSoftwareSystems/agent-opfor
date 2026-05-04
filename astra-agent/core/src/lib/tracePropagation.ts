import { randomBytes } from "node:crypto";
import type { TelemetryPropagationConfig } from "../config/types.js";

/** OpenTelemetry-style 128-bit trace id: 32 lowercase hex chars (Langfuse-compatible). */
export function newOtelTraceId(): string {
  return randomBytes(16).toString("hex");
}

export interface PropagationPlaceholders {
  traceId: string;
  runId: string;
  attackIndex: string;
}

function substitute(template: string, p: PropagationPlaceholders): string {
  return template
    .replace(/\{\{traceId\}\}/g, p.traceId)
    .replace(/\{\{runId\}\}/g, p.runId)
    .replace(/\{\{attackIndex\}\}/g, p.attackIndex);
}

/** Langfuse expects a 32-char hex trace id; do not prefix this header. */
function useRawOtelForHeader(headerName: string): boolean {
  return /^x-langfuse-trace-id$/i.test(headerName.trim());
}

function displayTraceId(hex: string, prefix?: string): string {
  const p = prefix?.trim();
  return p ? `${p}-${hex}` : hex;
}

/**
 * Build extra HTTP headers from propagation config.
 * `x-langfuse-trace-id` / `X-Langfuse-Trace-Id` values use raw OTEL hex only;
 * other headers use optional traceIdPrefix before {{traceId}} expansion.
 */
export function buildPropagatedHeaders(
  propagation: TelemetryPropagationConfig | undefined,
  opts: { otelTraceHex: string; runId: string; attackIndex: number }
): Record<string, string> {
  const headers: Record<string, string> = {};
  const raw = propagation?.headers;
  if (!raw) return headers;

  const prefix = propagation.traceIdPrefix;
  for (const [name, template] of Object.entries(raw)) {
    const hex = opts.otelTraceHex;
    const traceForTemplate = useRawOtelForHeader(name) ? hex : displayTraceId(hex, prefix);
    const expanded = substitute(template, {
      traceId: traceForTemplate,
      runId: opts.runId,
      attackIndex: String(opts.attackIndex),
    });
    headers[name] = expanded;
  }
  return headers;
}

export function mergeTraceIdIntoJsonBody(
  body: Record<string, unknown>,
  fieldName: string | undefined,
  value: string
): void {
  const key = fieldName?.trim();
  if (!key) return;
  body[key] = value;
}
