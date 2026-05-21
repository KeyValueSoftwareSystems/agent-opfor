// Browser-safe entry for @opfor/core. Re-exports only the parts of the engine
// that are reachable from a Chrome MV3 extension or any other non-Node runtime.
//
// What's IN: attacker prompt generation, multi-turn escalation, judge logic,
// HTTP agent target, telemetry adapter factory, types, env/random shims.
//
// What's OUT (deliberately): anything that touches node:fs / node:child_process
// or assumes a writable filesystem — buildReport, telemetry curation, the
// disk-based skill/evaluator loaders, the local-script target, opforConfig.
// The extension supplies evaluator data via its pre-built catalog.json and
// writes its report through chrome.storage, not the disk-backed paths.

export { runAll } from "./execute/runAll.js";
export type {
  RunConfig,
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

export { judgeResponse, errorJudge } from "./evaluators/judge.js";
export type {
  JudgeResult,
  JudgeObservabilityContext,
  ConversationTurn,
  AttackContext,
} from "./evaluators/judge.js";

export { createAgentTarget, isTargetError, RATE_LIMITED_SENTINEL } from "./targets/agentTarget.js";

export { generateNextAgentTurn, generateNextMcpTurn } from "./generate/generateNextTurn.js";
export { generateAttacks } from "./generate/generateAttacks.js";

export { setEnvProvider, getEnv } from "./lib/env.js";
export { randomUUID, randomTraceHex } from "./lib/random.js";
export { newOtelTraceId } from "./lib/tracePropagation.js";

export { getAdapter } from "./telemetry/adapter.js";
