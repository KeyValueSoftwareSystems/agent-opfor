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
 * MVP: how to discover traces in Langfuse (`GET /api/public/traces` + explicit ids).
 * Maps to Langfuse list/query params; adapter fills `fromTimestamp` from `lookbackHours` when needed.
 */
export interface LangfuseTraceSelectionConfig {
  /** Explicit trace ids to fetch for setup-time context (highest precision). */
  setupTraceIds?: string[];
  /**
   * When listing traces without `fromTimestamp`, adapter may use now minus this many hours.
   * Ignored if `fromTimestamp` is set.
   */
  lookbackHours?: number;
  /** ISO 8601 lower bound for trace.timestamp (Langfuse `fromTimestamp`). */
  fromTimestamp?: string;
  /** ISO 8601 upper bound (Langfuse `toTimestamp`). */
  toTimestamp?: string;
  /**
   * Langfuse `tags` query filter (trace must include these tags).
   * With OpenTelemetry + Langfuse, instrumentation `scope.name` is often surfaced as a tag
   * (e.g. `"langfuse-sdk"` for the official JS SDK).
   */
  tags?: string[];
  /** Langfuse `environment` filter (string or repeated values per API). */
  environment?: string | string[];
  /** Langfuse `sessionId` filter. */
  sessionId?: string;
  /** Max rows per page for `GET /api/public/traces` (Langfuse `limit`, default 100). */
  listLimit?: number;
  /**
   * How many list pages to fetch and merge before trace curation (default 1).
   * Increase to pull more traces (e.g. `listLimit` 100 × `listMaxPages` 5 → up to 500 rows), stopping early if a page returns fewer than `listLimit` rows.
   */
  listMaxPages?: number;
  /**
   * Langfuse `fields` on list/get (e.g. `core,io`) to limit payload size.
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
    scriptPath?: string;
    functionSignature?: string;
  };
  selection:
    | { mode: "suite"; suite: string }
    | { mode: "evaluators"; evaluators: string[] };
  telemetry?: TelemetryConfig;
}
