import type { LangfuseTelemetryConfig, LangfuseTraceSelectionConfig, TelemetryConfig } from "../config/types.js";

const DEFAULT_LANGFUSE_ORIGIN = "https://cloud.langfuse.com";
/** First page size when listing with no server-side filters (Langfuse still paginates). */
const DEFAULT_LIST_LIMIT = 100;
const LOG_PREVIEW_CHARS = 12_000;
/** GET /traces/{id} — ask Langfuse for IO + nested observations when available. */
const DEFAULT_TRACE_GET_FIELDS = "core,io,observations,scores,metrics";
/** GET /v2/observations — span/generation payloads for tracedata + judge. */
const DEFAULT_OBSERVATION_V2_FIELDS = "core,basic,time,io,metadata,model,usage,metrics";
const DEFAULT_OBSERVATION_V2_MAX_PAGES = 15;

export type LangfuseListFetchResult = {
  ok: boolean;
  status: number;
  listBody: unknown;
  baseUrl: string;
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function resolveCredentials(lf: LangfuseTelemetryConfig): {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
} | null {
  const pubName = lf.publicKeyEnv?.trim() || "LANGFUSE_PUBLIC_KEY";
  const secName = lf.secretKeyEnv?.trim() || "LANGFUSE_SECRET_KEY";
  const publicKey = process.env[pubName]?.trim() ?? "";
  const secretKey = process.env[secName]?.trim() ?? "";
  if (!publicKey || !secretKey) return null;

  const raw = lf.baseUrl?.trim() || DEFAULT_LANGFUSE_ORIGIN;
  return { baseUrl: normalizeBaseUrl(raw), publicKey, secretKey };
}

function basicAuthHeader(publicKey: string, secretKey: string): string {
  const token = Buffer.from(`${publicKey}:${secretKey}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function isPlaceholderTraceId(id: string): boolean {
  const t = id.trim();
  if (!t) return true;
  if (/REPLACE|CHANGE|YOUR_|TODO|TBD|EXAMPLE|PLACEHOLDER/i.test(t)) return true;
  return false;
}

/**
 * Build URLSearchParams for `GET /api/public/traces`.
 * Wires every field from LangfuseTraceSelectionConfig to the Langfuse API.
 * `filter` (advanced JSON) takes precedence over the equivalent direct params when both are set.
 */
function buildTraceListParams(sel: LangfuseTraceSelectionConfig | undefined, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(Math.max(1, page)));
  params.set("limit", String(sel?.listLimit ?? DEFAULT_LIST_LIMIT));
  if (!sel) return params;

  // Direct filter params
  if (sel.userId?.trim())    params.set("userId",    sel.userId.trim());
  if (sel.name?.trim())      params.set("name",      sel.name.trim());
  if (sel.sessionId?.trim()) params.set("sessionId", sel.sessionId.trim());
  if (sel.version?.trim())   params.set("version",   sel.version.trim());
  if (sel.release?.trim())   params.set("release",   sel.release.trim());
  if (sel.orderBy?.trim())   params.set("orderBy",   sel.orderBy.trim());
  if (sel.fields?.trim())    params.set("fields",    sel.fields.trim());

  // Time window: fromTimestamp / lookbackHours
  if (sel.fromTimestamp?.trim()) {
    params.set("fromTimestamp", sel.fromTimestamp.trim());
  } else if (sel.lookbackHours != null && sel.lookbackHours > 0) {
    const from = new Date(Date.now() - sel.lookbackHours * 3600 * 1000);
    params.set("fromTimestamp", from.toISOString());
  }
  if (sel.toTimestamp?.trim()) params.set("toTimestamp", sel.toTimestamp.trim());

  // Tags — repeated query params: ?tags=a&tags=b
  if (Array.isArray(sel.tags)) {
    for (const t of sel.tags) { if (t?.trim()) params.append("tags", t.trim()); }
  }

  // Environment — may be string or string[]
  if (sel.environment != null) {
    const envs = Array.isArray(sel.environment) ? sel.environment : [sel.environment];
    for (const e of envs) { if (e?.trim()) params.append("environment", e.trim()); }
  }

  // Advanced JSON filter — takes precedence over the params above when Langfuse processes it
  if (Array.isArray(sel.filter) && sel.filter.length > 0) {
    try {
      params.set("filter", JSON.stringify(sel.filter));
    } catch {
      // ignore serialisation failure — fall back to direct params
    }
  }

  return params;
}

async function httpJson(
  url: string,
  publicKey: string,
  secretKey: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(publicKey, secretKey),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, body };
}

function previewJson(label: string, data: unknown): void {
  let s: string;
  try {
    s = JSON.stringify(data, null, 2);
  } catch {
    s = String(data);
  }
  if (s.length > LOG_PREVIEW_CHARS) {
    console.log(`${label} (${s.length} chars, showing first ${LOG_PREVIEW_CHARS}):\n${s.slice(0, LOG_PREVIEW_CHARS)}\n… [truncated]`);
  } else {
    console.log(`${label}:\n${s}`);
  }
}

/**
 * Two-step observation-name pre-filter:
 * 1. Query GET /api/public/v2/observations?name=<name>&type=<type> to collect trace IDs.
 * 2. Caller then intersects these IDs with the main trace list.
 *
 * Used when `traceSelection.observationName` is set.
 */
async function fetchTraceIdsByObservationName(
  creds: { baseUrl: string; publicKey: string; secretKey: string },
  observationName: string,
  observationType?: string,
  maxPages = 10
): Promise<Set<string>> {
  const traceIds = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    params.set("name", observationName.trim());
    params.set("limit", "100");
    if (observationType?.trim()) params.set("type", observationType.trim());
    if (cursor) params.set("cursor", cursor);

    const url = `${creds.baseUrl}/api/public/v2/observations?${params.toString()}`;
    const got = await httpJson(url, creds.publicKey, creds.secretKey);
    if (!got.ok) break;

    const body = got.body as { data?: Array<{ traceId?: string }>; meta?: { cursor?: string | null } };
    const chunk = Array.isArray(body?.data) ? body.data : [];
    for (const obs of chunk) {
      if (obs.traceId?.trim()) traceIds.add(obs.traceId.trim());
    }

    const next = body?.meta?.cursor?.trim();
    if (!next || chunk.length === 0) break;
    cursor = next;
  }

  return traceIds;
}

const MAX_LIST_PAGES_CAP = 100;

type TraceListRow = Record<string, unknown>;

/**
 * Fetches one or more pages of `GET /api/public/traces` (see `traceSelection.listMaxPages` and `listLimit`),
 * merges `data` arrays, and returns a single synthetic list body for curation / logging.
 */
export async function fetchLangfuseTracesListPage(
  telemetry: TelemetryConfig
): Promise<
  (LangfuseListFetchResult & {
    publicKey: string;
    secretKey: string;
    listPagesFetched: number;
    listRowCount: number;
  }) | null
> {
  if (telemetry.provider !== "langfuse") return null;
  const lf = telemetry.langfuse;
  if (!lf) return null;
  const creds = resolveCredentials(lf);
  if (!creds) return null;

  const sel = lf.traceSelection;
  const perPage = sel?.listLimit ?? DEFAULT_LIST_LIMIT;
  const maxPages = Math.max(1, Math.min(MAX_LIST_PAGES_CAP, sel?.listMaxPages ?? 1));

  // Two-step observation-name pre-filter: collect allowed trace IDs first
  let observationTraceIdFilter: Set<string> | null = null;
  if (sel?.observationName?.trim()) {
    console.log(`  [Langfuse] observation-name pre-filter: fetching trace IDs for name="${sel.observationName}"${sel.observationType ? ` type=${sel.observationType}` : ""}`);
    observationTraceIdFilter = await fetchTraceIdsByObservationName(
      creds,
      sel.observationName,
      sel.observationType,
    );
    console.log(`  [Langfuse] observation pre-filter matched ${observationTraceIdFilter.size} trace ID(s)`);
  }

  const merged: TraceListRow[] = [];
  let firstMeta: unknown = null;
  let lastOk = false;
  let lastStatus = 200;
  let listPagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const params = buildTraceListParams(sel, page);
    const listUrl = `${creds.baseUrl}/api/public/traces?${params.toString()}`;
    const listed = await httpJson(listUrl, creds.publicKey, creds.secretKey);

    if (!listed.ok) {
      if (page === 1) {
        return {
          ok: false,
          status: listed.status,
          listBody: listed.body,
          baseUrl: creds.baseUrl,
          publicKey: creds.publicKey,
          secretKey: creds.secretKey,
          listPagesFetched: 0,
          listRowCount: 0,
        };
      }
      // Keep rows from successful earlier pages.
      break;
    }

    lastOk = true;
    lastStatus = listed.status;

    const body = listed.body as { data?: TraceListRow[]; meta?: unknown };
    let chunk = Array.isArray(body.data) ? body.data : [];
    // Intersect with observation-name pre-filter if active
    if (observationTraceIdFilter !== null) {
      const before = chunk.length;
      chunk = chunk.filter((row) => {
        const id = typeof row.id === "string" ? row.id.trim() : "";
        return id && observationTraceIdFilter!.has(id);
      });
      console.log(`  [Langfuse] page ${page}: ${before} traces → ${chunk.length} after observation-name intersection`);
      if (chunk.length > 0) {
        console.log(`  [Langfuse] matched trace IDs:`, chunk.map((r) => r.id));
      }
    }
    if (page === 1) firstMeta = body.meta ?? null;
    merged.push(...chunk);
    listPagesFetched = page;

    if (chunk.length < perPage) break;
  }

  const listBody = {
    data: merged,
    meta: {
      ...(typeof firstMeta === "object" && firstMeta !== null && !Array.isArray(firstMeta)
        ? (firstMeta as Record<string, unknown>)
        : {}),
      astraListPagesFetched: listPagesFetched,
      astraListRowCount: merged.length,
      astraListMaxPagesRequested: maxPages,
    },
  };

  if (observationTraceIdFilter !== null) {
    console.log(`  [Langfuse] DEBUG observation-name filter summary: ${merged.length} trace(s) kept across ${listPagesFetched} page(s) (observationName="${sel?.observationName}")`);
  }

  return {
    ok: lastOk,
    status: lastStatus,
    listBody,
    baseUrl: creds.baseUrl,
    publicKey: creds.publicKey,
    secretKey: creds.secretKey,
    listPagesFetched,
    listRowCount: merged.length,
  };
}

/**
 * Before attack prompt generation: fetch from Langfuse, log raw list + optional by-id (debug).
 */
export async function logLangfuseTracesDuringSetup(telemetry: TelemetryConfig): Promise<void> {
  if (telemetry.provider !== "langfuse") return;

  const lf = telemetry.langfuse;
  if (!lf) {
    console.log(`\n[Langfuse] Skip trace fetch: no telemetry.langfuse block.\n`);
    return;
  }

  const fetched = await fetchLangfuseTracesListPage(telemetry);
  if (!fetched) {
    const pub = lf.publicKeyEnv?.trim() || "LANGFUSE_PUBLIC_KEY";
    const sec = lf.secretKeyEnv?.trim() || "LANGFUSE_SECRET_KEY";
    console.log(`\n[Langfuse] Skip trace fetch: set ${pub} and ${sec} in the environment.\n`);
    return;
  }

  const sel = lf.traceSelection;

  console.log(`\n--- Langfuse: fetching traces (before attack prompt generation) ---`);
  console.log(`  API origin: ${fetched.baseUrl}`);
  console.log(
    `  List: GET /api/public/traces (merged pages; listMaxPages=${telemetry.langfuse?.traceSelection?.listMaxPages ?? 1})`
  );

  if (!fetched.ok) {
    console.log(`  List response: HTTP ${fetched.status} (see body below)`);
    previewJson("  List body", fetched.listBody);
  } else {
    const body = fetched.listBody as { data?: unknown[] };
    const n = Array.isArray(body?.data) ? body.data.length : 0;
    console.log(
      `  List response: HTTP ${fetched.status}, traces merged: ${n} (${fetched.listPagesFetched} page(s))`
    );
    previewJson("  List body (JSON)", fetched.listBody);
  }

  const validIds = (sel?.setupTraceIds ?? []).map((id) => id.trim()).filter((id) => id && !isPlaceholderTraceId(id));

  if (validIds.length === 0) {
    const raw = sel?.setupTraceIds ?? [];
    const skipped = raw.filter((id) => id.trim() && isPlaceholderTraceId(id.trim()));
    if (skipped.length) {
      console.log(`  By-id: skipped ${skipped.length} placeholder id(s) in setupTraceIds`);
    } else {
      console.log(`  By-id: no setupTraceIds to fetch`);
    }
  } else {
    console.log(`  By-id: fetching ${validIds.length} trace(s) (full trace payload, no ?fields filter)`);
    for (const id of validIds) {
      const url = `${fetched.baseUrl}/api/public/traces/${encodeURIComponent(id)}`;
      console.log(`  GET /api/public/traces/${id}`);
      const got = await httpJson(url, fetched.publicKey, fetched.secretKey);
      if (!got.ok) {
        console.log(`    → HTTP ${got.status}`);
        previewJson(`    body`, got.body);
      } else {
        console.log(`    → HTTP ${got.status}`);
        previewJson(`    body`, got.body);
      }
    }
  }

  console.log(`--- Langfuse fetch done ---\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyTraceForJudge(body: unknown, maxChars: number): string {
  let s: string;
  try {
    s = JSON.stringify(body);
  } catch {
    s = String(body);
  }
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n...[truncated, ${s.length} chars total]`;
}

export type FetchLangfuseTraceByIdOptions = {
  /** Langfuse `fields` query (e.g. core,io,observations,scores,metrics). */
  fields?: string;
};

/**
 * GET /api/public/traces/{traceId} — same id the scanner sent as X-Langfuse-Trace-Id when the target reports it to Langfuse.
 */
export async function fetchLangfuseTraceById(
  telemetry: TelemetryConfig,
  traceId: string,
  options?: FetchLangfuseTraceByIdOptions
): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  if (telemetry.provider !== "langfuse") return null;
  const lf = telemetry.langfuse;
  if (!lf) return null;
  const creds = resolveCredentials(lf);
  if (!creds) return null;
  const id = traceId.trim();
  if (!id) return null;
  const url = new URL(`${creds.baseUrl}/api/public/traces/${encodeURIComponent(id)}`);
  const f = options?.fields?.trim();
  if (f) url.searchParams.set("fields", f);
  const got = await httpJson(url.toString(), creds.publicKey, creds.secretKey);
  return { ok: got.ok, status: got.status, body: got.body };
}

function observationsShouldBeHydrated(obs: unknown): boolean {
  if (obs == null) return true;
  if (!Array.isArray(obs)) return true;
  if (obs.length === 0) return true;
  return obs.every((x) => typeof x === "string");
}

async function fetchLangfuseObservationsV2AllPages(
  creds: { baseUrl: string; publicKey: string; secretKey: string },
  traceId: string,
  fields: string,
  maxPages: number
): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    params.set("traceId", traceId.trim());
    params.set("fields", fields);
    params.set("limit", "100");
    if (cursor) params.set("cursor", cursor);
    const url = `${creds.baseUrl}/api/public/v2/observations?${params.toString()}`;
    const got = await httpJson(url, creds.publicKey, creds.secretKey);
    if (!got.ok) break;
    const body = got.body as { data?: unknown[]; meta?: { cursor?: string | null } };
    const chunk = Array.isArray(body?.data) ? body.data : [];
    out.push(...chunk);
    const next = body?.meta?.cursor?.trim();
    if (!next || chunk.length === 0) break;
    cursor = next;
  }
  return out;
}

async function fetchLangfuseObservationsV1AllPages(
  creds: { baseUrl: string; publicKey: string; secretKey: string },
  traceId: string
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= 50; page++) {
    const params = new URLSearchParams();
    params.set("traceId", traceId.trim());
    params.set("page", String(page));
    params.set("limit", "100");
    const url = `${creds.baseUrl}/api/public/observations?${params.toString()}`;
    const got = await httpJson(url, creds.publicKey, creds.secretKey);
    if (!got.ok) break;
    const body = got.body as { data?: unknown[] };
    const chunk = Array.isArray(body?.data) ? body.data : [];
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

/**
 * Given a trace object from GET /traces/{id}, replace observation id strings with full
 * span/generation rows from v2 observations (legacy v1 list if v2 returns nothing).
 */
export async function mergeLangfuseObservationsIntoTraceObject(
  telemetry: TelemetryConfig,
  traceId: string,
  trace: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (telemetry.provider !== "langfuse" || !telemetry.langfuse) return { ...trace };
  const lf = telemetry.langfuse;
  const creds = resolveCredentials(lf);
  if (!creds) return { ...trace };

  const out = { ...trace };
  const id = traceId.trim();
  const obs = out.observations;
  const v2Fields = lf.observationV2Fields?.trim() || DEFAULT_OBSERVATION_V2_FIELDS;
  const maxPages = lf.observationV2MaxPages ?? DEFAULT_OBSERVATION_V2_MAX_PAGES;

  if (observationsShouldBeHydrated(obs)) {
    let spans = await fetchLangfuseObservationsV2AllPages(creds, id, v2Fields, maxPages);
    if (spans.length === 0) {
      spans = await fetchLangfuseObservationsV1AllPages(creds, id);
    }
    if (spans.length > 0) {
      out.observations = spans;
    }
  }

  return out;
}

/**
 * Load one trace with IO + scores, then replace string observation ids with full span/generation
 * rows from GET /api/public/v2/observations (falls back to legacy v1 list when v2 returns nothing).
 */
export async function hydrateLangfuseTraceRecord(
  telemetry: TelemetryConfig,
  traceId: string
): Promise<Record<string, unknown> | null> {
  if (telemetry.provider !== "langfuse" || !telemetry.langfuse) return null;
  const lf = telemetry.langfuse;
  const creds = resolveCredentials(lf);
  if (!creds) return null;
  const id = traceId.trim();
  if (!id) return null;

  const traceFields = lf.traceDetailFields?.trim() || DEFAULT_TRACE_GET_FIELDS;
  const got = await fetchLangfuseTraceById(telemetry, id, { fields: traceFields });
  if (!got?.ok || got.body === null || typeof got.body !== "object") return null;

  return mergeLangfuseObservationsIntoTraceObject(telemetry, id, got.body as Record<string, unknown>);
}

export interface FetchLangfuseTraceForJudgeOptions {
  initialDelayMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Max length of JSON string passed to the judge (default 14_000). */
  maxJsonChars?: number;
}

/**
 * After an attack, poll Langfuse until the trace is available (ingestion lag),
 * then return a truncated JSON string for the LLM judge.
 */
export async function fetchLangfuseTraceJsonForJudge(
  telemetry: TelemetryConfig,
  traceId: string,
  options?: FetchLangfuseTraceForJudgeOptions
): Promise<string> {
  const initialDelayMs = options?.initialDelayMs ?? 500;
  const maxAttempts = options?.maxAttempts ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 400;
  const maxJsonChars = options?.maxJsonChars ?? 14_000;

  await sleep(Math.max(0, initialDelayMs));

  let lastStatus = 0;
  let lastBody: unknown;

  const traceFields =
    telemetry.langfuse?.traceDetailFields?.trim() || DEFAULT_TRACE_GET_FIELDS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const got = await fetchLangfuseTraceById(telemetry, traceId, { fields: traceFields });
    if (!got) {
      return "[Langfuse trace fetch failed: credentials became unavailable.]";
    }
    lastStatus = got.status;
    lastBody = got.body;

    if (got.ok && got.body !== null && typeof got.body === "object") {
      const merged = await mergeLangfuseObservationsIntoTraceObject(
        telemetry,
        traceId,
        got.body as Record<string, unknown>
      );
      return stringifyTraceForJudge(merged, maxJsonChars);
    }

    if (attempt < maxAttempts - 1) {
      await sleep(Math.max(0, retryDelayMs));
    }
  }

  const errSnippet = stringifyTraceForJudge(lastBody, 600);
  return `[Langfuse trace not available after ${maxAttempts} attempt(s). Last HTTP ${lastStatus}. Body (truncated): ${errSnippet}]`;
}
