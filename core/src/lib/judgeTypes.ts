/**
 * Unified verdict and judge-result types shared across core runners
 * (execute, MCP, autonomous). Single source of truth for the
 * PASS/FAIL/ERROR verdict enum and the judge-result shape.
 */
import { z } from "zod";

export type Verdict = "PASS" | "FAIL" | "ERROR";

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

/**
 * Build an ERROR JudgeResult without calling an LLM judge. Used for transport
 * failures (MCP server crash, unknown tool) and unparseable judge output.
 * Canonical home so the agent and MCP judges share one definition.
 */
export function errorJudge(errorMessage: string): JudgeResult {
  return {
    verdict: "ERROR",
    score: 0,
    confidence: 0,
    evidence: "N/A",
    reasoning: "",
    errorMessage,
  };
}
