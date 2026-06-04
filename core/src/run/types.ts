import { z } from "zod";

export const JudgeResultSchema = z.object({
  verdict: z.enum(["PASS", "FAIL", "ERROR"]),
  score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(100),
  evidence: z.string(),
  reasoning: z.string(),
  failingTurns: z.array(z.number()).optional(),
  errorMessage: z.string().optional(),
});

export type JudgeResult = z.infer<typeof JudgeResultSchema>;

/** One turn in an adaptive multi-turn attack sequence. */
export interface TurnRecord {
  turnIndex: number;
  toolName: string;
  toolArguments: Record<string, unknown>;
  rawToolResponse: string;
  toolError?: string;
  judge?: JudgeResult;
}

export interface AttackExecutionResult {
  attackId: string;
  evaluatorId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  /** Raw JSON-stringified result returned by the MCP tool call. */
  rawToolResponse: string;
  /** Error message if the tool call itself threw (not a security finding). */
  toolError?: string;
}

export interface AttackRunResult extends AttackExecutionResult {
  judge: JudgeResult;
  /** Populated for adaptive multi-turn attacks (turns > 1). */
  turns?: TurnRecord[];
}

export interface EvaluatorRunSummary {
  evaluatorId: string;
  evaluatorName: string;
  standards?: Record<string, string>;
  severity: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  results: AttackRunResult[];
}

export interface RunReport {
  reportId: string;
  generatedAt: string;
  suiteId: string;
  serverSummary: string;
  transport: "stdio" | "url";
  generatorModel: string;
  judgeModel: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
  };
  evaluators: EvaluatorRunSummary[];
}
