import { z } from "zod";

/** One concrete red-team attempt against the MCP surface (LLM-generated, validated). */
export const AttackScenarioSchema = z.object({
  id: z.string().min(1),
  evaluatorId: z.string().min(1),
  patternName: z.string().nullish().transform((v) => v ?? undefined),
  summary: z.string().min(1),
  suggestedToolName: z.string().nullish().transform((v) => v ?? undefined),
  suggestedToolArguments: z.record(z.string(), z.any()).nullish().transform((v) => v ?? undefined),
  /** Number of adaptive turns. If > 1, the run loop calls the attacker LLM between turns. */
  turns: z.number().int().min(1).optional(),
});

export const AttackPlanSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  transport: z.enum(["stdio", "url"]),
  suiteId: z.string(),
  serverSummary: z.string(),
  toolsDigest: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.record(z.string(), z.any()).optional(),
    })
  ),
  attacks: z.array(AttackScenarioSchema),
});

export type AttackPlan = z.infer<typeof AttackPlanSchema>;
export type AttackScenario = z.infer<typeof AttackScenarioSchema>;

/** Extra replay hints attached when writing the plan (not LLM-generated). */
export type AttackReplayHints = {
  stdio?: { toolsListLine: string; toolsCallLine?: string };
  http?: { toolsListCurl: string; toolsCallCurl?: string };
};

export type AttackScenarioWithReplay = AttackScenario & { replay: AttackReplayHints };

export type AttackPlanWritten = Omit<AttackPlan, "attacks"> & {
  attacks: AttackScenarioWithReplay[];
};
