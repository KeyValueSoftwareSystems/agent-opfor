// Browser-safe entry for @keyvaluesystems/agent-opfor-core. Re-exports only the parts of the engine
// that are reachable from a Chrome MV3 extension or any other non-Node runtime.
//
// What's IN: attacker prompt generation, multi-turn escalation, judge logic,
// LLM model factory, telemetry adapter factory, types, env/random shims.
//
// What's OUT (deliberately): anything that touches node:fs / node:child_process
// or assumes a writable filesystem — runAll (disk-based evaluator loaders),
// createAgentTarget (local-script variant uses node:child_process), buildReport,
// telemetry curation, opforConfig.
// The extension supplies evaluator data via its pre-built catalog.json,
// drives the attack loop itself, and writes reports through chrome.storage.
//
// runAll will be re-added once it accepts pre-loaded EvaluatorSpec[] directly
// (planned for Phase C — no disk loader needed at that point).

export type {
  AttackSpec,
  AttackResult,
  EvaluatorResult,
  UnifiedRunReport,
  AgentTargetConfig,
  McpTargetConfig,
  UnifiedTargetConfig,
  EvaluatorSelection,
  Effort,
} from "./execute/types.js";

export { runAllBrowser } from "./execute/runAllBrowser.js";
export type {
  BrowserRunConfig,
  BrowserProgressEvent,
  BrowserRunAllOptions,
} from "./execute/runAllBrowser.js";

export type { EvaluatorSpec, AttackPattern } from "./evaluators/parseEvaluator.js";
export type { AgentTarget } from "./targets/agentTarget.js";

export { judgeResponse } from "./evaluators/judge.js";
export { errorJudge } from "./lib/judgeTypes.js";
export type {
  JudgeResult,
  JudgeObservabilityContext,
  ConversationTurn,
  AttackContext,
} from "./evaluators/judge.js";

export { isTargetError, RATE_LIMITED_SENTINEL } from "./targets/agentTarget.js";

export { generateNextAdaptiveTurn, generateNextMcpTurn } from "./generate/generateNextTurn.js";
export { generateAttacks } from "./generate/generateAttacks.js";

export { generateJsonObject } from "./lib/generateJsonObject.js";
export type { JsonLlmMessage } from "./lib/generateJsonObject.js";

export { setEnvProvider, getEnv } from "./lib/env.js";
export { randomUUID, randomTraceHex } from "./lib/random.js";
export { newOtelTraceId } from "./lib/tracePropagation.js";

export {
  createModel,
  PROVIDERS,
  PROVIDER_ENV_VARS,
  PROVIDER_DEFAULTS,
  PROVIDER_CAPABILITIES,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_BASE_URL_PROMPTS,
  PROVIDER_CHOICES,
} from "./providers/factory.js";
export type { LlmConfig, ProviderName } from "./config/types.js";

export { getAdapter } from "./telemetry/adapter.js";
