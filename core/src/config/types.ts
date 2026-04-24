// ---------------------------------------------------------------------------
// Telemetry (provider-agnostic config; secrets use env vars only)
// ---------------------------------------------------------------------------

/** Which backend supplies traces for setup context and optional run/judge enrichment. */
export type TelemetryProviderId = "none" | "langfuse";

/**
 * How the scanner sends a correlation id to the target so observability lines up
 * with Langfuse (or another backend). Placeholders: {{traceId}}, {{runId}}, {{attackIndex}}.
 */
export interface TelemetryPropagationConfig {
  /**
   * HTTP headers to set on each target request. Values may include placeholders.
   * Example:
   * `{ "X-Langfuse-Trace-Id": "{{traceId}}", "X-Astra-Run": "{{runId}}" }`
   * — `X-Langfuse-Trace-Id` is expanded to a 32-char lowercase hex trace id (OTEL/Langfuse).
   * Other headers may use `traceIdPrefix` before the hex segment.
   */
  headers?: Record<string, string>;
  /**
   * Top-level JSON field name merged into the request body (json / openai bodies).
   * Ignored if unset. Value is the resolved trace id string.
   */
  traceIdBodyField?: string;
  /** One fresh trace id per attack vs one trace id for the whole run. */
  traceIdStrategy?: "per-attack" | "per-run";
  /** Prefix for generated ids when the scanner mints trace ids (no placeholders). */
  traceIdPrefix?: string;
}

/**
 * How to discover traces in Langfuse (`GET /api/public/traces` + explicit ids).
 * Maps directly to Langfuse list/query params.
 * @see https://api.reference.langfuse.com/#get-/api/public/traces
 */
export interface LangfuseTraceSelectionConfig {
  // ── Explicit IDs ────────────────────────────────────────────────────────────
  /** Explicit trace ids to always include for setup-time context (highest precision, skip curation). */
  setupTraceIds?: string[];

  // ── Time window ─────────────────────────────────────────────────────────────
  /**
   * Shorthand: fetch traces from the last N hours.
   * Converted to `fromTimestamp = now - N hours` at query time. Ignored when `fromTimestamp` is set.
   */
  lookbackHours?: number;
  /** ISO 8601 lower bound — Langfuse `fromTimestamp`. */
  fromTimestamp?: string;
  /** ISO 8601 upper bound — Langfuse `toTimestamp`. */
  toTimestamp?: string;

  // ── Identity / session ──────────────────────────────────────────────────────
  /** Filter by Langfuse `userId`. */
  userId?: string;
  /** Filter by Langfuse `sessionId`. */
  sessionId?: string;

  // ── Trace metadata fields ───────────────────────────────────────────────────
  /** Filter by trace `name` (e.g. `"POST /chat"`). */
  name?: string;
  /** Filter by `version` string on the trace. */
  version?: string;
  /** Filter by `release` string on the trace. */
  release?: string;
  /**
   * Filter by tags — only traces that include **all** of the listed tags are returned.
   * With OTEL + Langfuse, the instrumentation `scope.name` is often surfaced as a tag.
   */
  tags?: string[];
  /**
   * Filter by environment.
   * Pass a single string or an array; Langfuse returns traces matching any of the values.
   */
  environment?: string | string[];

  // ── Sorting ──────────────────────────────────────────────────────────────────
  /**
   * Sort order — format: `<field>.<asc|desc>`.
   * Sortable fields: `id`, `timestamp`, `name`, `userId`, `release`, `version`,
   * `public`, `bookmarked`, `sessionId`.
   * Example: `"timestamp.desc"` (most-recent first).
   */
  orderBy?: string;

  // ── Advanced JSON filter ─────────────────────────────────────────────────────
  /**
   * Advanced filter conditions (Langfuse `filter` param, JSON-encoded).
   * Supports filtering by **any** column including `metadata` key/value pairs,
   * scores, and more. Takes precedence over the direct params above when provided.
   *
   * Each condition: `{ type, column, operator, value, key? }`
   *
   * Types: `"string"` | `"number"` | `"datetime"` | `"stringOptions"` |
   *        `"arrayOptions"` | `"stringObject"` | `"numberObject"` | `"boolean"` | `"null"`
   *
   * Example — filter by metadata key:
   * ```json
   * [{ "type": "stringObject", "column": "metadata", "key": "service.name", "operator": "=", "value": "my-api" }]
   * ```
   * Example — filter by trace name and environment:
   * ```json
   * [
   *   { "type": "string", "column": "name",        "operator": "=",        "value": "POST /chat" },
   *   { "type": "string", "column": "environment", "operator": "=",        "value": "production" }
   * ]
   * ```
   * @see https://langfuse.com/changelog/2025-11-03-advanced-filtering-traces-and-observations-api
   */
  filter?: Record<string, unknown>[];

  // ── Observation-based pre-filter (two-step, client-side) ────────────────────
  /**
   * Filter traces by observation (span/generation) **name**.
   * Astra first queries `GET /api/public/v2/observations?name=<value>` to collect
   * trace IDs, then fetches only those traces. Useful for targeting specific LLM
   * calls (e.g. `"groq.chat.completions"`) or route spans (e.g. `"POST /chat"`).
   * Combines with all other filters above (applied as an AND intersection).
   */
  observationName?: string;
  /**
   * Filter traces by observation **type** alongside `observationName`.
   * Options: `"GENERATION"` (LLM calls), `"SPAN"` (generic spans), `"EVENT"` (point-in-time events).
   * Has no effect if `observationName` is not set.
   */
  observationType?: "GENERATION" | "SPAN" | "EVENT";

  // ── Pagination ───────────────────────────────────────────────────────────────
  /** Max rows per page for `GET /api/public/traces` (Langfuse `limit`, default 100). */
  listLimit?: number;
  /**
   * How many list pages to fetch and merge before trace curation (default 1).
   * `listLimit 100 × listMaxPages 5` → up to 500 rows; stops early if a page returns fewer than `listLimit` rows.
   */
  listMaxPages?: number;

  // ── Response shape ───────────────────────────────────────────────────────────
  /**
   * Comma-separated field groups to include in list responses (Langfuse `fields`).
   * Groups: `core` (always included), `io`, `scores`, `observations`, `metrics`.
   * Example: `"core,io,scores"`. Omit to get all fields.
   * @see https://api.reference.langfuse.com
   */
  fields?: string;
}

/** Langfuse-specific options (credentials always from env, never in this file). */
export interface LangfuseTelemetryConfig {
  /**
   * Langfuse API base URL (e.g. https://cloud.langfuse.com or self-hosted origin).
   * If omitted, the Langfuse adapter uses its default host.
   */
  baseUrl?: string;
  /**
   * Name of an environment variable holding the API origin (e.g. LANGFUSE_BASE_URL).
   * When set and non-empty at load/run time, its value overrides `baseUrl`.
   */
  baseUrlEnv?: string;
  /** Env var holding the Langfuse public key (default: LANGFUSE_PUBLIC_KEY). */
  publicKeyEnv?: string;
  /** Env var holding the Langfuse secret key (default: LANGFUSE_SECRET_KEY). */
  secretKeyEnv?: string;
  /** Which traces to pull for setup (ids, time window, tags, limits, etc.). */
  traceSelection?: LangfuseTraceSelectionConfig;
  /**
   * `fields` query for GET /api/public/traces/{id} when loading full trace rows
   * (tracedata.json, judge). Default in code: core,io,observations,scores,metrics.
   */
  traceDetailFields?: string;
  /**
   * `fields` for GET /api/public/v2/observations when list/trace only returned observation ids.
   * Default: core,basic,time,io,metadata,model,usage,metrics
   */
  observationV2Fields?: string;
  /** Max cursor pages per trace for v2 observations (default 15). */
  observationV2MaxPages?: number;
  /**
   * Max characters of merged Langfuse **list** JSON sent to the curator LLM (default 28000).
   * Configure in `astra.config.json` under `telemetry.langfuse`.
   */
  traceCurationListJsonMaxChars?: number;
  /**
   * Max characters of curated **hydrated** JSON (`curation` + `traces`) sent to the summarizer LLM (default 100000).
   */
  traceSummarySourceJsonMaxChars?: number;
  /**
   * Max characters of `trace-summary.md` content passed into attack prompt generation (default 26000).
   */
  traceSummaryForAttackMaxChars?: number;
}

/**
 * Optional block in setup YAML/JSON and in generated prompts JSON.
 * Omit entirely or set provider: "none" to disable.
 */
export interface TelemetryConfig {
  provider: TelemetryProviderId;
  langfuse?: LangfuseTelemetryConfig;
  /** After each HTTP attack, fetch trace by propagated id and pass digest to judge. */
  enrichJudgeFromTrace?: boolean;
  /** Initial delay before first trace fetch (ingestion lag). */
  traceFetchInitialDelayMs?: number;
  /** Max attempts to fetch trace after an attack. */
  traceFetchMaxAttempts?: number;
  /** Backoff between trace fetch attempts (ms). */
  traceFetchRetryDelayMs?: number;
  /**
   * Max JSON characters of merged Langfuse trace (after observation hydration) passed to the judge
   * when `enrichJudgeFromTrace` is true (default 14000).
   */
  enrichJudgeTraceJsonMaxChars?: number;
  propagation?: TelemetryPropagationConfig;
}

export type ProviderName = "openai" | "anthropic" | "groq" | "google" | "other";

export interface LlmConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;   // stored in prompts file — warn user to gitignore
  baseURL?: string; // only for "other"
}

export interface TargetConfig {
  name: string;
  description: string;
  type: "http-endpoint" | "local-script" | "python-function";
  // http-endpoint fields
  endpoint?: string;
  requestFormat?: "auto" | "openai" | "json";
  targetApiKey?: string;
  targetModel?: string;
  /**
   * For multi-turn attacks: JSON body field name to inject a session ID on every request
   * (e.g. "session_id"). The target uses this to maintain its own conversation history.
   * Leave unset to skip session ID injection.
   */
  sessionIdField?: string;
  /**
   * Dot-path for where to place the user prompt in the JSON request body (requestFormat: "json").
   * Supports nested paths (e.g. "input.message" → { input: { message: "..." } }).
   * Defaults to top-level "prompt" when unset.
   */
  promptPath?: string;
  /**
   * Dot-path to extract the assistant reply from the HTTP response JSON.
   * Supports nested paths (e.g. "data.reply" → response.data.reply).
   * When unset, falls back to the built-in chain: choices[0].message.content → response → output → text → message.
   */
  responsePath?: string;
  /** Path to .js or .py for type local-script (JSON stdin → JSON stdout). */
  scriptPath?: string;
  /** @deprecated Prefer type local-script with scriptPath. */
  functionSignature?: string;
}

export interface AttackEntry {
  evaluatorId: string;
  evaluatorName: string;
  severity: string;
  owasp: string;
  patternName: string;
  prompt: string;
  passCriteria: string;
  failCriteria: string;
  /** "single" (default) fires one prompt; "multi" runs a multi-turn conversation. */
  turnMode?: "single" | "multi";
  /** Number of turns for multi-turn mode (default 3). */
  turns?: number;
}

export interface PromptsFile {
  generatedAt: string;
  llm: LlmConfig;
  target: TargetConfig;
  attacks: AttackEntry[];
  /** Copied from setup config when present; drives telemetry adapters during `astra run`. */
  telemetry?: TelemetryConfig;
  /**
   * When Langfuse curation ran during setup, the same output directory contains this markdown file
   * (human-readable trace + span summary). Same basename as in setup output dir.
   */
  traceSummaryFilename?: string;
}

// Shape of the optional config file passed to `astra setup --config`
export interface SetupConfigFile {
  llm?: {
    provider?: ProviderName;
    model?: string;
    apiKey?: string;
    baseURL?: string;
  };
  target: {
    name: string;
    description: string;
    type: "http-endpoint" | "local-script" | "python-function";
    endpoint?: string;
    requestFormat?: "auto" | "openai" | "json";
    targetApiKey?: string;
    targetModel?: string;
    sessionIdField?: string;
    promptPath?: string;
    responsePath?: string;
    scriptPath?: string;
    functionSignature?: string;
  };
  selection:
    | { mode: "suite"; suite: string }
    | { mode: "evaluators"; evaluators: string[] };
  telemetry?: TelemetryConfig;
  /** "single" (default) or "multi" — applied to all generated attack entries. */
  turnMode?: "single" | "multi";
  /** Number of turns for multi-turn mode (default 3). */
  turns?: number;
}
