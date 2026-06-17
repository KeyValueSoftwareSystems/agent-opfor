/**
 * Unified report view model — a single intermediate representation
 * that both agent and MCP red-teaming paths map into before rendering.
 */

import type { JudgeResult } from "../lib/judgeTypes.js";

/** @deprecated Use JudgeResult from @opfor/core/lib/judgeTypes.js directly. */
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
}
