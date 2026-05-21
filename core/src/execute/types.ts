import type { LlmConfig, TelemetryConfig } from "../config/types.js";
import type { JudgeResult } from "../run/types.js";

export type Effort = "adaptive" | "comprehensive";

// ---------------------------------------------------------------------------
// Target configs
// ---------------------------------------------------------------------------

export interface AgentTargetConfig {
  kind: "agent";
  name: string;
  description: string;
  type: "http-endpoint" | "local-script";
  endpoint?: string;
  requestFormat?: "auto" | "openai" | "json";
  targetApiKey?: string;
  targetModel?: string;
  headers?: Record<string, string>;
  sessionIdField?: string;
  promptPath?: string;
  responsePath?: string;
  scriptPath?: string;
}

export interface McpTargetConfig {
  kind: "mcp";
  name: string;
  description?: string;
  transport: "stdio" | "url";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  urlHeaders?: Record<string, string>;
}

export type UnifiedTargetConfig = AgentTargetConfig | McpTargetConfig;

// ---------------------------------------------------------------------------
// Run config  (written by `setup`, read by `execute`)
// ---------------------------------------------------------------------------

export type EvaluatorSelection =
  | { mode: "suite"; suite: string }
  | { mode: "evaluators"; evaluators: string[] };

export interface RunConfig {
  target: UnifiedTargetConfig;
  selection: EvaluatorSelection;
  attackLlm: LlmConfig;
  judgeLlm?: LlmConfig;
  effort: Effort;
  turns: number;
  telemetry?: TelemetryConfig;
}

// ---------------------------------------------------------------------------
// Attack spec  (replaces AttackEntry + AttackScenario)
// ---------------------------------------------------------------------------

export interface AttackSpec {
  id: string;
  evaluatorId: string;
  evaluatorName: string;
  description?: string;
  severity: string;
  ref: string;
  patternName: string;
  passCriteria: string;
  failCriteria: string;
  turns: number;
  judgeHint?: string;
  // agent target
  prompt?: string;
  // mcp target
  toolName?: string;
  toolArguments?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result types  (unified for agent + mcp)
// ---------------------------------------------------------------------------

export interface AgentTurnRecord {
  kind: "agent";
  turnIndex: number;
  prompt: string;
  response: string;
  judge?: JudgeResult;
}

export interface McpTurnRecord {
  kind: "mcp";
  turnIndex: number;
  toolName: string;
  toolArguments: Record<string, unknown>;
  response: string;
  toolError?: string;
  judge?: JudgeResult;
}

export type TurnRecord = AgentTurnRecord | McpTurnRecord;

export interface AttackResult {
  attackId: string;
  evaluatorId: string;
  patternName: string;
  judge: JudgeResult;
  turns?: TurnRecord[];
  // agent target
  prompt?: string;
  response?: string;
  // mcp target
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResponse?: string;
  toolError?: string;
}

export interface EvaluatorResult {
  evaluatorId: string;
  evaluatorName: string;
  ref: string;
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
}
