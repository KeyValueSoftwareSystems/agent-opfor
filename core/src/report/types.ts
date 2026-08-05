/**
 * Unified report view model — a single intermediate representation
 * that both agent and MCP red-teaming paths map into before rendering.
 */

import type { JudgeResult } from "../lib/judgeTypes.js";
import type { ModelTokenUsage } from "../execute/tokenTracker.js";
import type { RunCost } from "../pricing/types.js";

/** @deprecated Use JudgeResult from @keyvaluesystems/agent-opfor-core/lib/judgeTypes.js directly. */
export type ReportJudge = JudgeResult;

export type DetailCard =
  | { kind: "prompt"; prompt: string; response: string }
  | {
      kind: "tool";
      toolName: string;
      args: Record<string, unknown>;
      response: string;
      error?: string;
    };

export interface TurnViewModel {
  turnIndex: number;
  detail: DetailCard;
  judge?: ReportJudge;
}

export interface ResultViewModel {
  id: string;
  label: string;
  judge: ReportJudge;
  traceId?: string;
  detail: DetailCard;
  turns?: TurnViewModel[];
}

export interface EvaluatorViewModel {
  evaluatorId: string;
  evaluatorName: string;
  standards?: Record<string, string>;
  severity: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  results: ResultViewModel[];
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Same tokens as `tokenUsage`, split by the model that spent them. */
  tokenUsageByModel?: ModelTokenUsage[];
  /** Estimated USD cost of this evaluator's attacker + judge calls. */
  cost?: RunCost;
}

export interface ReportViewModel {
  mode: "agent" | "mcp";
  reportId: string;
  generatedAt: string;
  generatorModel: string;
  judgeModel: string;
  target: {
    name: string;
    endpoint?: string;
    transport?: string;
    suiteId?: string;
    /** Human-readable target type, e.g. "LLM Chatbot Interface". Extension-only today. */
    type?: string;
    /** e.g. "Browser automation (live tab)". Extension-only today. */
    accessMethod?: string;
    maxTurns?: number;
    waitBetweenTurnsSec?: number;
    messageLengthLimit?: number;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    /** Same tokens as `tokenUsage`, split by the model that spent them. */
    tokenUsageByModel?: ModelTokenUsage[];
    /**
     * Estimated USD cost of the attacker + judge LLM calls. Excludes the
     * target's own inference cost, which opfor cannot observe.
     */
    cost?: RunCost;
    /** Wall-clock time for the whole run, from the first evaluator to the last. */
    durationMs?: number;
  };
  evaluators: EvaluatorViewModel[];
  /** Set when the run was stopped early due to a non-retryable LLM error. */
  stopReason?: string;
  /** Free-text business/application context. Extension-only today. */
  businessContext?: string;
}
