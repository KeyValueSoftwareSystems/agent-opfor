import type { LlmConfig, TelemetryConfig } from "../config/types.js";
import type { JudgeResult } from "../run/types.js";

export type Effort = "adaptive" | "comprehensive";

// ---------------------------------------------------------------------------
// Target configs
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

export interface AgentTargetConfig {
  kind: "agent";
  name: string;
  description: string;
  type: "http-endpoint" | "local-script";
  endpoint?: string;
  requestFormat?: "auto" | "openai" | "json";
  /** Env var name containing the API key (e.g., "TARGET_API_KEY") */
  apiKeyEnv?: string;
  model?: string;
  headers?: Record<string, string>;
  /** Legacy alias for `session.send = { in: "body", name: sessionIdField }`. */
  sessionIdField?: string;
  session?: SessionConfig;
  promptPath?: string;
  responsePath?: string;
  scriptPath?: string;
  /**
   * Whether the target maintains conversation history server-side.
   * - true (default): OPFOR sends only the latest prompt per turn and threads
   *   `sessionId` via `sessionIdField`. The target is expected to look up
   *   prior turns by that id.
   * - false: OPFOR sends the full chat history as a `messages` array each
   *   turn (OpenAI chat-completions shape). Used to test stateless LLM APIs
   *   directly. Both `sessionIdField` and `requestFormat` are ignored in
   *   this mode — the chat-completions shape is fixed by the spec.
   */
  stateful?: boolean;
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

export type UnifiedTargetConfig = AgentTargetConfig | McpTargetConfig;

// ---------------------------------------------------------------------------
// Run config  (written by `setup`, read by `execute`)
// ---------------------------------------------------------------------------

export type EvaluatorSelection =
  | { mode: "suite"; suite: string; dependsOn?: Record<string, string[]> }
  | { mode: "evaluators"; evaluators: string[]; dependsOn?: Record<string, string[]> }
  | {
      mode: "preloaded";
      evaluators: import("../evaluators/parseEvaluator.js").EvaluatorSpec[];
      dependsOn?: Record<string, string[]>;
    };

export interface RunConfig {
  target: UnifiedTargetConfig;
  selection: EvaluatorSelection;
  attackerLlm: LlmConfig;
  judgeLlm?: LlmConfig;
  effort: Effort;
  /**
   * User intent for conversation shape. When "single", the engine forces 1 turn
   * regardless of `turns`. When "multi" (or omitted), `turns` is honored.
   * Optional for back-compat — when absent, behavior is inferred from `turns`.
   */
  turnMode?: "single" | "multi";
  turns: number;
  telemetry?: TelemetryConfig;
  /**
   * Free-text primary mission steering every evaluator's attacks (e.g. "get the
   * target to leak env vars via a delegated employee"). Threaded onto each
   * generated AgentAttackSpec; consumed by generateNextAdaptiveTurn as the
   * attacker's top-priority goal, same mechanism the browser extension's
   * popup-driven `attackObjective` already uses.
   */
  attackObjective?: string;
}

// ---------------------------------------------------------------------------
// Session context — captured after an evaluator run so downstream evaluators
// (declared via `depends_on`) can leverage what happened in an earlier session.
// ---------------------------------------------------------------------------

export interface SessionContext {
  evaluatorId: string;
  evaluatorName: string;
  /** Conversation turns from the upstream evaluator's attacks. */
  turns: TurnRecord[];
  /** The judge verdicts from the upstream evaluator's attacks. */
  results: Array<{ attackId: string; patternName: string; verdict: "PASS" | "FAIL" | "ERROR" }>;
  /** Flat prompt→response pairs for easy consumption by attacker/judge prompts. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

// ---------------------------------------------------------------------------
// Attack spec  (replaces AttackEntry + AttackScenario)
// ---------------------------------------------------------------------------

/** Fields common to every attack, regardless of target kind. */
export interface BaseAttackSpec {
  id: string;
  evaluatorId: string;
  evaluatorName: string;
  description?: string;
  severity: string;
  standards?: Record<string, string>;
  patternName: string;
  passCriteria: string;
  failCriteria: string;
  turns: number;
  turnMode?: "single" | "multi";
  judgeHint?: string;
  /**
   * Telemetry-derived summary of real production traces (from `opfor setup`/curation).
   * Threaded into the attacker so adaptive turns can mirror real user phrasing and
   * target real flows. Set in generateAttacks; consumed by generateNextAdaptiveTurn.
   */
  traceContext?: string;
  /** Resolved session contexts from evaluators this attack depends on. */
  upstreamSessions?: SessionContext[];
}

/**
 * Attack against an agent/chatbot target — carries a prompt and (for DOM-driven
 * runners) operator-intent signals. The compiler guarantees these fields never
 * appear on an MCP attack, and vice versa.
 */
export interface AgentAttackSpec extends BaseAttackSpec {
  kind: "agent";
  /** Seed prompt. Empty string in adaptive mode (turn 1 is engine-generated). */
  prompt?: string;
  // Operator-intent signals (DOM-driven runners). Optional — CLI doesn't populate
  // these; the extension threads them through from the popup.
  attackObjective?: string;
  businessUseCase?: string;
  siteSnapshot?: string;
  maxMessageLength?: number;
}

/** Attack against an MCP server target — carries a tool call. */
export interface McpAttackSpec extends BaseAttackSpec {
  kind: "mcp";
  toolName?: string;
  toolArguments?: Record<string, unknown>;
}

export type AttackSpec = AgentAttackSpec | McpAttackSpec;

// ---------------------------------------------------------------------------
// Result types  (unified for agent + mcp)
// ---------------------------------------------------------------------------

export interface AgentTurnRecord {
  kind: "agent";
  turnIndex: number;
  prompt: string;
  response: string;
}

export interface McpTurnRecord {
  kind: "mcp";
  turnIndex: number;
  toolName: string;
  toolArguments: Record<string, unknown>;
  response: string;
  toolError?: string;
}

export type TurnRecord = AgentTurnRecord | McpTurnRecord;

export interface BaseAttackResult {
  attackId: string;
  evaluatorId: string;
  patternName: string;
  judge: JudgeResult;
  turns?: TurnRecord[];
}

export interface AgentAttackResult extends BaseAttackResult {
  kind: "agent";
  prompt?: string;
  response?: string;
}

export interface McpAttackResult extends BaseAttackResult {
  kind: "mcp";
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResponse?: string;
  toolError?: string;
}

export type AttackResult = AgentAttackResult | McpAttackResult;

export interface EvaluatorResult {
  evaluatorId: string;
  evaluatorName: string;
  standards?: Record<string, string>;
  severity: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  attacks: AttackResult[];
}

export interface UnifiedRunReport {
  reportId: string;
  generatedAt: string;
  targetName: string;
  targetKind: "agent" | "mcp";
  effort: Effort;
  attackModel: string;
  judgeModel: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
  };
  evaluators: EvaluatorResult[];
  /** Set when the run was stopped early due to a non-retryable LLM error. */
  stopReason?: string;
}

/**
 * Per-attack progress events emitted by the run engine — the single source of
 * truth for run lifecycle payloads. {@link RunListener} hooks derive from it.
 */
export type ProgressEvent =
  | { type: "evaluator_start"; evaluatorId: string; evaluatorName: string }
  | { type: "attack_start"; attackId: string; patternName: string }
  | { type: "attack_done"; attackId: string; verdict: "PASS" | "FAIL" | "ERROR" }
  | { type: "evaluator_done"; evaluatorId: string; passed: number; failed: number; errors: number }
  | { type: "run_stopped"; reason: string };
