import type { Effort, UnifiedRunReport } from "@opfor/core";
import type { TelemetryConfig, LlmConfig, ProviderName } from "@opfor/core/config/types.js";

// ---------------------------------------------------------------------------
// Target Configuration
// ---------------------------------------------------------------------------

export interface HttpTargetConfig {
  url: string;
  name?: string;
  description?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  requestFormat?: "auto" | "openai" | "json";
  promptPath?: string;
  responsePath?: string;
  stateful?: boolean;
  sessionField?: string;
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
  apiKeyEnv?: string;
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

export interface ExecuteOptions {
  target: TargetConfig;

  suite?: string;
  evaluators?: string[];

  strategy?: StrategyConfig;

  attackerModel?: ModelSpec;
  judgeModel?: ModelSpec;

  telemetry?: TelemetryConfig;

  apiKey?: string;

  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: "evaluator_start"; evaluatorId: string; evaluatorName: string }
  | { type: "attack_start"; attackId: string; patternName: string }
  | { type: "attack_done"; attackId: string; verdict: "PASS" | "FAIL" | "ERROR" }
  | { type: "evaluator_done"; evaluatorId: string; passed: number; failed: number; errors: number };

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

export interface ExecuteResults {
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

// ---------------------------------------------------------------------------
// Opfor Class Options
// ---------------------------------------------------------------------------

export interface OpforOptions {
  apiKey?: string;
  baseUrl?: string;
  attackerModel?: ModelSpec;
  judgeModel?: ModelSpec;
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
// Re-exports from core
// ---------------------------------------------------------------------------

export type { TelemetryConfig, LlmConfig, ProviderName, Effort, UnifiedRunReport };
