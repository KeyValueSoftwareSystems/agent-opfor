/**
 * Unified report view model — a single intermediate representation
 * that both agent and MCP red-teaming paths map into before rendering.
 */

export interface ReportJudge {
  verdict: "PASS" | "FAIL" | "ERROR";
  score: number;
  confidence: number;
  evidence: string;
  reasoning: string;
  errorMessage?: string;
}

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
