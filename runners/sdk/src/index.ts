/**
 * Opfor SDK - Adversarial testing for AI systems
 *
 * @packageDocumentation
 */

// Class-based API
export { Opfor } from "./opfor.js";

// Functional API
export { run } from "./run.js";
export { hunt } from "./hunt.js";
export { report, type ReportBuilder } from "./report.js";
export { listSuites, listEvaluators } from "./catalog.js";

// Types
export type {
  // Run options & results
  RunOptions,
  RunResults,
  ProgressEvent,
  RunListener,

  // Target configuration
  TargetConfig,
  HttpTargetConfig,
  LocalScriptTargetConfig,
  McpTargetConfig,
  SessionConfig,

  // Model configuration
  ModelConfig,
  ModelSpec,

  // Strategy
  StrategyConfig,

  // Results
  Finding,
  AttackResult,
  EvaluatorResult,

  // Opfor class
  OpforOptions,

  // Catalog
  SuiteInfo,
  EvaluatorInfo,
  ListEvaluatorsOptions,

  // Autonomous mode
  HuntOptions,
  HuntTargetConfig,
  HuntModelsConfig,
  HuntLimitsConfig,
  HuntResults,
  HuntFinding,
  HuntTurn,
  HuntProgressEvent,

  // Re-exports from core
  TelemetryConfig,
  LlmConfig,
  ProviderName,
  Effort,
} from "./types.js";
