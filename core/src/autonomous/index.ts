/**
 * Autonomous red-team engine — public API.
 *
 * Consumers import from "@agent-opfor/core/autonomous/index.js" (or sub-paths
 * like "@agent-opfor/core/autonomous/report/types.js" for deeper access).
 */

export { runAutonomous } from "./orchestrator/run.js";
export type { RunHooks } from "./orchestrator/run.js";
export type { RunContext } from "./orchestrator/context.js";
export type { ProgressReporter } from "./state/hooks.js";
export type { RunEvent } from "./state/observe.js";

export type { HuntOptions, TargetConfig, TargetMode } from "./lib/types.js";
export { BudgetGuard } from "./lib/budget.js";
export type { BudgetGuardOptions } from "./lib/budget.js";

export type { AutonomousReport } from "./report/types.js";
export { mapRunLogToReport } from "./report/mapRunLog.js";
export { renderReportHtml } from "./report/html.js";
export { writeAutonomousReport } from "./report/writeReport.js";

export { loadKnowledge } from "./knowledge/load.js";
export type {
  KnowledgeBase,
  VulnClass,
  Persona,
  Strategy,
  KnowledgeKind,
} from "./knowledge/types.js";

export { createTargetClient } from "./target/http.js";
export type { TargetClient, TargetSendOptions } from "./target/http.js";

export { createRunLog } from "./state/runLog.js";
export type { RunLog, ThreadState, Finding } from "./state/runLog.js";
export { countsLine, threadTreeText, renderForest } from "./state/observe.js";
