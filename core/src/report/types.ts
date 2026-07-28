/**
 * Unified report view model — a single intermediate representation
 * that both agent and MCP red-teaming paths map into before rendering.
 */

import type { JudgeResult } from "../lib/judgeTypes.js";

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
  /**
   * Deployment-aware risk on a 0..10 scale (higher = more dangerous). >0 only for
   * findings; 0 when the evaluator held. Undefined when no agent profile was
   * available. Rendered as the "Risk (this agent)" column.
   */
  risk?: number;
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
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
  };
  evaluators: EvaluatorViewModel[];
  /**
   * Derived agentic power profile of the target. When present, its `rationale`
   * explains (in plain English) why findings were amplified above their base
   * severity. Drives the "Risk (this agent)" column.
   */
  agentProfile?: { power: number; rationale: string };
  /** Set when the run was stopped early due to a non-retryable LLM error. */
  stopReason?: string;
}
