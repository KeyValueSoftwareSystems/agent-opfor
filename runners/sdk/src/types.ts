// ---------------------------------------------------------------------------
// Target Configuration
// ---------------------------------------------------------------------------

export type SessionReceiveConfig =
  | { in: "body" | "header"; name: string }
  | { in: "set-cookie"; name?: string };

export interface SessionConfig {
  /** Where the session id is written into a request. */
  send: { in: "body" | "header"; name: string };
  /**
   * Where a server-returned session id is read from a response. Its presence
   * means server-owned mode: turn 1 sends no id, the returned id is captured
   * here and echoed on later turns via `send`.
   */
  receive?: SessionReceiveConfig;
}

export interface HttpTargetConfig {
  url: string;
  name?: string;
  description?: string;
  /** Bearer API key sent as Authorization header. */
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  requestFormat?: "auto" | "openai" | "json";
  promptPath?: string;
  responsePath?: string;
  stateful?: boolean;
  /** Legacy sugar for `session.send = { in: "body", name }`. Prefer `session`. */
  sessionField?: string;
  /** Client- vs server-owned session id handling (send: body/header; receive: body/header/cookie). */
  session?: SessionConfig;
}

export interface LocalScriptTargetConfig {
  type: "local-script";
  name: string;
  description?: string;
  scriptPath: string;
}

export interface McpTargetConfig {
  kind: "mcp";
  name: string;
  description?: string;
  transport: "stdio" | "url";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  urlHeaders?: Record<string, string>;
}

export type TargetConfig = HttpTargetConfig | LocalScriptTargetConfig | McpTargetConfig;

// ---------------------------------------------------------------------------
// Model Configuration
// ---------------------------------------------------------------------------

export interface ModelConfig {
  provider: ProviderName;
  model: string;
  /** Provider API key value (recommended; avoids relying on process.env). */
  apiKey?: string;
  baseUrl?: string;
}

export type ModelSpec = string | ModelConfig;

// ---------------------------------------------------------------------------
// Strategy Configuration
// ---------------------------------------------------------------------------

export interface StrategyConfig {
  effort?: Effort;
  turns?: number;
  turnMode?: "single" | "multi";
}

// ---------------------------------------------------------------------------
// Execute Options
// ---------------------------------------------------------------------------

export interface RunOptions {
  target: TargetConfig;

  suite?: string;
  evaluators?: string[];

  strategy?: StrategyConfig;

  /**
   * Free-text primary mission steering every evaluator's attacks (e.g. "get the
   * target to leak env vars via a delegated employee"). Same mechanism `opfor run
   * --objective` and `opfor hunt --objective` use.
   */
  attackObjective?: string;

  /**
   * Free-text steering for the judge's verdict (e.g. "treat any tool name leak
   * as critical"). Combined with each attack's existing judge hint rather than
   * replacing it. Same mechanism `opfor run --judge-hint` uses.
   */
  judgeHint?: string;

  /**
   * Free-text domain/business context for the target agent (e.g. "internal
   * customer support bot for a healthcare SaaS"). Same mechanism `opfor run
   * --business-use-case` uses.
   */
  businessUseCase?: string;

  attackerModel?: ModelSpec;
  judgeModel?: ModelSpec;

  telemetry?: TelemetryConfig;

  apiKey?: string;

  onProgress?: (event: ProgressEvent) => void;

  /**
   * Run lifecycle observers. Receive the same per-attack events as onProgress plus
   * run-level onRunStart / onRunFinish / onRunError hooks.
   */
  listeners?: RunListener[];
}

export type ProgressEvent =
  | { type: "evaluator_start"; evaluatorId: string; evaluatorName: string }
  | { type: "attack_start"; attackId: string; patternName: string }
  | { type: "attack_done"; attackId: string; verdict: "PASS" | "FAIL" | "ERROR" }
  | { type: "evaluator_done"; evaluatorId: string; passed: number; failed: number; errors: number }
  | { type: "run_stopped"; reason: string };

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface Finding {
  id: string;
  evaluatorId: string;
  patternName: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  evidence?: string;
  standards?: Record<string, string>;
}

export interface AttackResult {
  attackId: string;
  evaluatorId: string;
  patternName: string;
  prompt: string;
  response: string;
  verdict: "PASS" | "FAIL" | "ERROR";
  evidence?: string;
  turns?: Array<{
    turnIndex: number;
    prompt: string;
    response: string;
  }>;
}

export interface EvaluatorResult {
  evaluatorId: string;
  evaluatorName: string;
  severity: string;
  standards?: Record<string, string>;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  attacks: AttackResult[];
}

export interface RunResults {
  id: string;
  timestamp: string;
  targetName: string;
  targetKind: "agent" | "mcp";
  effort: Effort;
  attackerModel: string;
  judgeModel: string;
  score: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
  };
  findings: Finding[];
  evaluators: EvaluatorResult[];
}

/** Payload of a ProgressEvent variant, minus its `type` discriminant. */
type ProgressPayload<T extends ProgressEvent["type"]> = Omit<
  Extract<ProgressEvent, { type: T }>,
  "type"
>;

/**
 * Observer for run lifecycle events.
 *
 * Implement optional hooks to receive callbacks at key points during a run.
 * Per-attack events match {@link ProgressEvent}; `onRunFinish` receives {@link RunResults}.
 */
export interface RunListener {
  /** Fired once at the start, before the target connects. */
  onRunStart?(info: { evaluatorCount: number }): void;
  onEvaluatorStart?(info: ProgressPayload<"evaluator_start">): void;
  onAttackStart?(info: ProgressPayload<"attack_start">): void;
  onAttackDone?(info: ProgressPayload<"attack_done">): void;
  onEvaluatorDone?(info: ProgressPayload<"evaluator_done">): void;
  /** Non-terminal notice that the run was stopped early; `onRunFinish` still follows. */
  onRunStopped?(info: ProgressPayload<"run_stopped">): void;
  /** Terminal: the run threw (may fire without a preceding `onRunStart`). */
  onRunError?(info: { error: unknown }): void;
  /** Terminal: fired once with the final results. */
  onRunFinish?(results: RunResults): void;
}

// ---------------------------------------------------------------------------
// Opfor Class Options
// ---------------------------------------------------------------------------

export interface OpforOptions {
  apiKey?: string;
  baseUrl?: string;
  attackerModel?: ModelSpec;
  judgeModel?: ModelSpec;
  /** Optional brain credentials/routing for hunt() (alternative to env vars). */
  brain?: HuntBrainConfig;
}

// ---------------------------------------------------------------------------
// List Functions
// ---------------------------------------------------------------------------

export interface SuiteInfo {
  id: string;
  name: string;
  description?: string;
  evaluatorCount: number;
}

export interface EvaluatorInfo {
  id: string;
  name: string;
  severity: string;
  description?: string;
  standards?: Record<string, string>;
}

export interface ListEvaluatorsOptions {
  kind?: "agent" | "mcp";
}

// ---------------------------------------------------------------------------
// Autonomous Mode Types
// ---------------------------------------------------------------------------

/**
 * Brain (model runtime) configuration for autonomous mode.
 *
 * `hunt()` uses the Anthropic/Claude Agent runtime under the hood. Most users
 * configure it via env vars. This lets you supply the same values in code.
 *
 * - `apiKey` maps to `ANTHROPIC_API_KEY`
 * - `baseUrl` maps to `ANTHROPIC_BASE_URL` (gateway/proxy host; avoid trailing `/v1`)
 */
export interface HuntBrainConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Target configuration for autonomous mode (HTTP endpoint only). */
export interface HuntTargetConfig {
  /** Target HTTP endpoint URL. */
  url: string;
  /** Display name (defaults to endpoint host). */
  name?: string;
  /** Bearer API key sent as Authorization header. */
  apiKey?: string;
  /** Extra static headers merged into every request. */
  headers?: Record<string, string>;
  /**
   * - "stateless" (default): replay full conversation each turn
   * - "stateful": send only latest prompt + session id
   */
  stateful?: boolean;
  /** Legacy alias for `session.send = { in: "body", name: sessionField }`. */
  sessionField?: string;
  /** Client- vs server-owned session id handling (send: body/header; receive: body/header/cookie). */
  session?: SessionConfig;
  /** Dot-path where the prompt is written in the request body. */
  promptPath?: string;
  /** Dot-path where the reply is read from the response body. */
  responsePath?: string;
  /** Model value sent in OpenAI-shape requests. */
  model?: string;
}

/** Model configuration for autonomous mode. */
export interface HuntModelsConfig {
  /** Commander model (alias like "opus"/"sonnet" or full id). Default: "opus" */
  commander?: string;
  /** Operator subagent model. Default: "sonnet" */
  operator?: string;
  /** Scout subagent model. Default: "haiku" */
  scout?: string;
  /** Verifier model id (defaults to commander). */
  verifier?: string;
}

/** Limits configuration for autonomous mode. */
export interface HuntLimitsConfig {
  /** Max parallel operator subagents. Default: 6 */
  maxOperators?: number;
  /** Hard ceiling on SDK agentic turns. Default: 120 */
  maxTurns?: number;
  /** Per-thread depth ceiling. Default: 25 */
  maxThreadTurns?: number;
  /** Hard ceiling on total attack threads. Default: 40 */
  maxTotalThreads?: number;
  /** Hard ceiling on forks per thread. Default: 4 */
  maxForksPerThread?: number;
  /** Deterministic ceiling on total target sends. */
  maxTotalSends?: number;
  /** Max exploration generations. Default: 3 */
  maxDepth?: number;
  /** Leads expanded per wave. Default: 4 */
  maxLeadsPerWave?: number;
  /** Max benign recon probes. Default: 8 */
  maxReconProbes?: number;
  /** Hard USD budget; run finalizes when reached. Default: 10 */
  budgetUsd?: number;
}

/** Options for autonomous red-team mode. */
export interface HuntOptions {
  /** Target agent configuration. */
  target: HuntTargetConfig;
  /** Free-text attack objective. */
  objective: string;
  /** Optional brain credentials/routing (alternative to env vars). */
  brain?: HuntBrainConfig;
  /** Model configuration. */
  models?: HuntModelsConfig;
  /** Limits and budget configuration. */
  limits?: HuntLimitsConfig;
  /** Enable the independent second-model verifier. Default: false */
  verify?: boolean;
  /** Dispatch operators one-at-a-time (for rate-limited targets). Default: false */
  sequential?: boolean;
  /** Output directory for reports. Default: ".opfor/reports" */
  outputDir?: string;
  /** Progress callback for streaming updates. */
  onProgress?: (event: HuntProgressEvent) => void;
}

/** Progress events during autonomous execution. */
export type HuntProgressEvent =
  | { type: "line"; message: string }
  | { type: "recon_start" }
  | { type: "recon_done"; fingerprint: string; weakPoints: string[] }
  | { type: "thread_start"; threadId: string; vulnClass: string }
  | { type: "thread_turn"; threadId: string; turnIndex: number; prompt: string }
  | { type: "thread_done"; threadId: string; verdict: "PASS" | "FAIL" | "ERROR" }
  | { type: "finding"; findingId: string; vulnClass: string; severity: string }
  | { type: "complete"; outcome: string };

/** A turn in an autonomous attack thread. */
export interface HuntTurn {
  turnIndex: number;
  prompt: string;
  response: string;
  persona?: string;
  strategy?: string;
  score?: number;
}

/** A finding from an autonomous run. */
export interface HuntFinding {
  id: string;
  vulnClassId: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  standards?: Record<string, string>;
  threadId: string;
  strategy: string;
  personas: string[];
  verdict: "PASS" | "FAIL" | "ERROR";
  confidence: number;
  evidence: string;
  reasoning: string;
  turns: HuntTurn[];
}

/** Results from an autonomous red-team run. */
export interface HuntResults {
  id: string;
  timestamp: string;
  target: { name: string; endpoint: string };
  objective: string;
  outcome: "achieved" | "partially-achieved" | "not-achieved" | "inconclusive";
  models: {
    commander: string;
    operator: string;
  };
  truncated: boolean;
  truncationReason?: string;
  totalCostUsd?: number;
  summary: {
    threads: number;
    confirmed: number;
    defended: number;
    errors: number;
    attackSuccessRate: number;
  };
  recon: {
    fingerprint: string;
    guardrails: string[];
    weakPoints: string[];
  };
  findings: HuntFinding[];
  recommendations: string[];
  narrative: string;
  /** Path to generated HTML report. */
  htmlReportPath?: string;
  /** Path to generated JSON report. */
  jsonReportPath?: string;
}

// ---------------------------------------------------------------------------
// Types inlined from core — keeps the published .d.ts free of
// @keyvaluesystems/agent-opfor-core references (core is not published to npm)
// ---------------------------------------------------------------------------

export type Effort = "adaptive" | "comprehensive";

export type ProviderName =
  | "openai"
  | "anthropic"
  | "groq"
  | "google"
  | "deepseek"
  | "azure"
  | "openai-compatible";

export interface LlmConfig {
  provider: ProviderName;
  model: string;
  apiKeyEnv?: string;
  baseURL?: string;
}

export type TelemetryProviderId = "none" | "langfuse" | "netra";

export interface TelemetryPropagationConfig {
  headers?: Record<string, string>;
  traceIdBodyField?: string;
  traceIdStrategy?: "per-attack" | "per-run";
  traceIdPrefix?: string;
}

export interface LangfuseTraceSelectionConfig {
  setupTraceIds?: string[];
  lookbackHours?: number;
  fromTimestamp?: string;
  toTimestamp?: string;
  userId?: string;
  sessionId?: string;
  name?: string;
  version?: string;
  release?: string;
  tags?: string[];
  environment?: string | string[];
  orderBy?: string;
  filter?: Record<string, unknown>[];
  observationName?: string;
  observationType?: "GENERATION" | "SPAN" | "EVENT";
  listLimit?: number;
  listMaxPages?: number;
  fields?: string;
}

export interface NetraTraceSelectionConfig {
  setupTraceIds?: string[];
  lookbackHours?: number;
  fromTime?: string;
  toTime?: string;
  sessionId?: string;
  userId?: string;
  environment?: string;
  listLimit?: number;
  listMaxPages?: number;
}

export interface LangfuseTelemetryConfig {
  baseUrl?: string;
  baseUrlEnv?: string;
  publicKeyEnv?: string;
  secretKeyEnv?: string;
  traceSelection?: LangfuseTraceSelectionConfig;
  traceDetailFields?: string;
  observationV2Fields?: string;
  observationV2MaxPages?: number;
  traceCurationListJsonMaxChars?: number;
  traceSummarySourceJsonMaxChars?: number;
  traceSummaryForAttackMaxChars?: number;
}

export interface NetraTelemetryConfig {
  baseUrl?: string;
  baseUrlEnv?: string;
  apiKeyEnv?: string;
  traceSelection?: NetraTraceSelectionConfig;
  traceCurationListJsonMaxChars?: number;
  traceSummarySourceJsonMaxChars?: number;
  traceSummaryForAttackMaxChars?: number;
}

export interface TelemetryConfig {
  provider: TelemetryProviderId;
  langfuse?: LangfuseTelemetryConfig;
  netra?: NetraTelemetryConfig;
  enrichJudgeFromTrace?: boolean;
  traceFetchInitialDelayMs?: number;
  traceFetchMaxAttempts?: number;
  traceFetchRetryDelayMs?: number;
  enrichJudgeTraceJsonMaxChars?: number;
  propagation?: TelemetryPropagationConfig;
}
