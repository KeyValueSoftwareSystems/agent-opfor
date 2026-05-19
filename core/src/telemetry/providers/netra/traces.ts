import type {
  NetraTelemetryConfig,
  NetraTraceSelectionConfig,
  TelemetryConfig,
} from "../../../config/types.js";
import { pollUntilResult, POLL_DEFAULTS } from "../../pollingUtils.js";

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_MAX_PAGES = 1;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function resolveNetraCredentials(cfg: NetraTelemetryConfig): {
  baseUrl: string;
  apiKey: string;
} | null {
  const keyEnv = cfg.apiKeyEnv?.trim() || "NETRA_API_KEY";
  const apiKey = process.env[keyEnv]?.trim() ?? "";
  if (!apiKey) return null;

  const raw = cfg.baseUrl?.trim() || "";
  if (!raw) return null;

  return { baseUrl: normalizeBaseUrl(raw), apiKey };
}

function apiKeyHeader(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey };
}

/**
 * Netra spans repeat the full system prompt verbatim in every `Generation Pipeline`
 * span (`metadata.gen_ai.system.content`). For multi-turn attacks that eats most of
 * the judge's char budget. This walks the payload, finds any string ≥ minLen chars
 * appearing more than once, and replaces duplicates with `<<see:_refN>>` pointers
 * into a `_shared` dictionary placed at the top of the output.
 */
function dedupeRepeatedStrings(obj: unknown, minLen = 500): unknown {
  const counts = new Map<string, number>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.length >= minLen) counts.set(v, (counts.get(v) ?? 0) + 1);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(visit);
    }
  };
  visit(obj);

  const refs = new Map<string, string>();
  const shared: Record<string, string> = {};
  let n = 1;
  for (const [str, c] of counts) {
    if (c > 1) {
      const key = `_ref${n++}`;
      refs.set(str, key);
      shared[key] = str;
    }
  }
  if (refs.size === 0) return obj;

  const replace = (v: unknown): unknown => {
    if (typeof v === "string" && refs.has(v)) return `<<see:${refs.get(v)}>>`;
    if (Array.isArray(v)) return v.map(replace);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = replace(val);
      }
      return out;
    }
    return v;
  };
  return { _shared: shared, ...(replace(obj) as Record<string, unknown>) };
}

function stringifyForJudge(value: unknown, maxChars: number): string {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  if (s.length > maxChars) {
    s = s.slice(0, maxChars) + "\n…[truncated]";
  }
  return s;
}

/**
 * POST /sdk/traces — list page with cursor pagination.
 * Returns `{ data, hasNextPage, nextCursor? }` or null on credential failure.
 */
export async function fetchNetraTracesPage(
  cfg: NetraTelemetryConfig,
  selection: NetraTraceSelectionConfig | undefined,
  cursor?: string
): Promise<{
  ok: boolean;
  status: number;
  data: unknown[];
  hasNextPage: boolean;
  nextCursor?: string;
  baseUrl: string;
} | null> {
  const creds = resolveNetraCredentials(cfg);
  if (!creds) return null;

  const limit = selection?.listLimit ?? DEFAULT_LIST_LIMIT;

  // Build time window
  let startTime: string;
  if (selection?.fromTime) {
    startTime = selection.fromTime;
  } else if (selection?.lookbackHours != null && selection.lookbackHours > 0) {
    startTime = new Date(Date.now() - selection.lookbackHours * 3600 * 1000).toISOString();
  } else {
    startTime = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  }
  const endTime = selection?.toTime ?? new Date().toISOString();

  // Build filters — field/type/operator match Netra's FilterItem + FilterOperatorEnum
  const filters: Array<{ field: string; type: string; operator: string; value: string }> = [];
  if (selection?.sessionId?.trim()) {
    filters.push({
      field: "session_id",
      type: "string",
      operator: "equals",
      value: selection.sessionId.trim(),
    });
  }
  if (selection?.userId?.trim()) {
    filters.push({
      field: "user_id",
      type: "string",
      operator: "equals",
      value: selection.userId.trim(),
    });
  }
  if (selection?.environment?.trim()) {
    filters.push({
      field: "environment",
      type: "string",
      operator: "equals",
      value: selection.environment.trim(),
    });
  }

  const body: Record<string, unknown> = {
    startTime,
    endTime,
    pagination: { limit, ...(cursor ? { cursor } : {}) },
    ...(filters.length > 0 ? { filters } : {}),
  };

  const url = `${creds.baseUrl}/sdk/traces`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...apiKeyHeader(creds.apiKey),
      },
      body: JSON.stringify(body),
    });
    const status = res.status;
    if (!res.ok) {
      return { ok: false, status, data: [], hasNextPage: false, baseUrl: creds.baseUrl };
    }
    // API returns { success, data: { data: [...], pageInfo: {...} } }
    const json = (await res.json()) as {
      data?: { data?: unknown[]; pageInfo?: { hasNextPage?: boolean; nextCursor?: string } };
    };
    const inner = json.data ?? {};
    const data = Array.isArray(inner.data) ? inner.data : [];
    const hasNextPage = inner.pageInfo?.hasNextPage ?? false;
    const nextCursor = (inner.pageInfo as Record<string, unknown> | undefined)?.nextCursor as
      | string
      | undefined;
    return { ok: true, status, data, hasNextPage, nextCursor, baseUrl: creds.baseUrl };
  } catch (e: unknown) {
    console.warn(`[Netra] Fetch error for ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, status: 0, data: [], hasNextPage: false, baseUrl: creds.baseUrl };
  }
}

const MAX_SPAN_PAGES = 50;

/**
 * GET /sdk/traces/:id — fetch full trace record (metadata, input/output, tags, etc.).
 * Returns null if the trace is unavailable or credentials are missing.
 */
export async function fetchNetraTraceDetail(
  cfg: NetraTelemetryConfig,
  traceId: string
): Promise<Record<string, unknown> | null> {
  const creds = resolveNetraCredentials(cfg);
  if (!creds) return null;

  const url = `${creds.baseUrl}/sdk/traces/${encodeURIComponent(traceId)}`;
  try {
    const res = await fetch(url, { headers: { ...apiKeyHeader(creds.apiKey) } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /sdk/traces/:id/spans — cursor-paginated, collects all spans.
 */
export async function fetchNetraSpansForTrace(
  cfg: NetraTelemetryConfig,
  traceId: string
): Promise<unknown[]> {
  const creds = resolveNetraCredentials(cfg);
  if (!creds) return [];

  const out: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_SPAN_PAGES; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const url = `${creds.baseUrl}/sdk/traces/${encodeURIComponent(traceId)}/spans?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: { ...apiKeyHeader(creds.apiKey) },
      });
      const rawText = await res.text();
      if (!res.ok) break;
      const json = JSON.parse(rawText) as {
        data?: { data?: unknown[]; pageInfo?: { hasNextPage?: boolean; nextCursor?: string } };
      };
      const inner = json.data ?? {};
      const chunk = Array.isArray(inner.data) ? inner.data : [];
      out.push(...chunk);
      if (!inner.pageInfo?.hasNextPage) break;
      cursor = (inner.pageInfo as Record<string, unknown>).nextCursor as string | undefined;
      if (!cursor) break;
    } catch {
      break;
    }
  }

  return out;
}

export type NetraListFetchResult = {
  ok: boolean;
  status: number;
  listRows: unknown[];
  listRowCount: number;
  listPagesFetched: number;
  baseUrl: string;
};

/**
 * Fetch one or more pages from POST /sdk/traces and merge into a single list result.
 */
export async function fetchNetraTracesListPage(
  telemetry: TelemetryConfig
): Promise<NetraListFetchResult | null> {
  if (telemetry.provider !== "netra" || !telemetry.netra) return null;
  const cfg = telemetry.netra;
  const creds = resolveNetraCredentials(cfg);
  if (!creds) return null;

  const selection = cfg.traceSelection;
  const maxPages = selection?.listMaxPages ?? DEFAULT_MAX_PAGES;

  const allRows: unknown[] = [];
  let cursor: string | undefined;
  let lastStatus = 0;
  let lastOk = false;
  let pagesFetched = 0;

  for (let p = 0; p < maxPages; p++) {
    const result = await fetchNetraTracesPage(cfg, selection, cursor);
    if (!result) return null;
    lastStatus = result.status;
    lastOk = result.ok;
    if (!result.ok) break;
    allRows.push(...result.data);
    pagesFetched++;
    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return {
    ok: lastOk,
    status: lastStatus,
    listRows: allRows,
    listRowCount: allRows.length,
    listPagesFetched: pagesFetched,
    baseUrl: creds.baseUrl,
  };
}

/**
 * Hydrate a single Netra trace: merge top-level trace metadata with all its spans.
 */
export async function hydrateNetraTraceRecord(
  telemetry: TelemetryConfig,
  traceId: string
): Promise<Record<string, unknown> | null> {
  if (telemetry.provider !== "netra" || !telemetry.netra) return null;
  const cfg = telemetry.netra;
  const [detail, spans] = await Promise.all([
    fetchNetraTraceDetail(cfg, traceId),
    fetchNetraSpansForTrace(cfg, traceId),
  ]);
  return { traceId, ...(detail ?? {}), spans };
}

/**
 * After an attack, poll GET /sdk/traces/:id/spans until spans appear (ingestion lag),
 * then return a truncated JSON string for the LLM judge.
 */
export async function fetchNetraTraceJsonForJudge(
  telemetry: TelemetryConfig,
  traceId: string,
  options?: {
    initialDelayMs?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
    maxJsonChars?: number;
  }
): Promise<string> {
  if (telemetry.provider !== "netra" || !telemetry.netra) {
    return "[Netra trace fetch skipped: wrong provider or missing netra config.]";
  }
  const cfg = telemetry.netra;
  const creds = resolveNetraCredentials(cfg);
  if (!creds) {
    return "[Netra trace fetch failed: missing credentials (check NETRA_API_KEY and baseUrl).]";
  }

  const initialDelayMs = options?.initialDelayMs ?? POLL_DEFAULTS.initialDelayMs;
  const maxAttempts = options?.maxAttempts ?? POLL_DEFAULTS.maxAttempts;
  const retryDelayMs = options?.retryDelayMs ?? POLL_DEFAULTS.retryDelayMs;
  const maxJsonChars = options?.maxJsonChars ?? POLL_DEFAULTS.maxChars;

  const result = await pollUntilResult<string>(
    async () => {
      const spans = await fetchNetraSpansForTrace(cfg, traceId);
      return spans.length > 0
        ? stringifyForJudge(dedupeRepeatedStrings({ traceId, spans }), maxJsonChars)
        : null;
    },
    { initialDelayMs, maxAttempts, retryDelayMs }
  );

  return (
    result ?? `[Netra trace not available after ${maxAttempts} attempt(s). Trace id: ${traceId}]`
  );
}
