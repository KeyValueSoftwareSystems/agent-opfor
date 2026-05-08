import { z } from "zod";
import { McpServerConfigSchema, ModelConfigSchema } from "../config/schema.js";
import type { McpServerConfig, ModelConfig } from "../config/schema.js";

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
  /** Attacker-generated instruction for the judge: what FAIL looks like for this specific attack. */
  judgeHint: z.string().nullish().transform((v) => v ?? undefined),
});

export const AttackPlanSchema = z.object({
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
  server: McpServerConfigSchema.optional(),
  generatorModel: ModelConfigSchema.optional(),
  judgeModel: ModelConfigSchema.optional(),
  attackerInstructions: z.string().optional(),
});

export type AttackPlan = z.infer<typeof AttackPlanSchema>;
export type AttackScenario = z.infer<typeof AttackScenarioSchema>;
export type { McpServerConfig, ModelConfig };

/** Extra replay hints attached when writing the plan (not LLM-generated). */
export type AttackReplayHints = {
  stdio?: { toolsListLine: string; toolsCallLine?: string };
  http?: { toolsListCurl: string; toolsCallCurl?: string };
};

export type AttackScenarioWithReplay = AttackScenario & { replay: AttackReplayHints };

export type AttackPlanWritten = Omit<AttackPlan, "attacks"> & {
  attacks: AttackScenarioWithReplay[];
};
