/**
 * Evaluator frontmatter contract (Zod).
 * Shared by runtime parseEvaluator and validate-skills.
 */
import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const SurfaceSchema = z.enum(["agent", "browser", "mcp"]);

export const TurnModeSchema = z.enum(["single", "multi"]);

/** Registered engine strategies for evaluators that need more than static patterns. */
export const StrategySchema = z.enum([
  "declarative-patterns",
  "adaptive-multi-turn",
  "mcp-scanner",
]);

export const PatternSchema = z.object({
  name: z.string().min(1),
  template: z.string().min(1),
});

export const StandardsRecordSchema = z.record(z.string().min(1), z.string().min(1));

export type StandardsMap = Record<string, string>;

export const EvaluatorFrontmatterSchema = z
  .object({
    schema_version: z.literal(1).optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    severity: SeveritySchema,
    standards: StandardsRecordSchema.optional(),
    pass_criteria: z.string().min(1),
    fail_criteria: z.string().min(1),
    description: z.string().optional(),
    patterns: z.array(PatternSchema).optional(),
    judge_hint: z.string().optional(),
    surfaces: z.array(SurfaceSchema).optional(),
    turn_mode: TurnModeSchema.optional(),
    strategy: StrategySchema.optional(),
  })
  .passthrough();

export type EvaluatorFrontmatter = z.infer<typeof EvaluatorFrontmatterSchema>;

export const SuiteFrontmatterSchema = z.object({
  schema_version: z.literal(1).optional(),
  id: z.string().min(1),
  evaluators: z.array(z.string().min(1)).min(1),
  name: z.string().optional(),
  description: z.string().optional(),
});
