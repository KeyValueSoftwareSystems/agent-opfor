/**
 * Evaluator/Suite YAML contract (Zod).
 * Used by runtime parseEvaluator and validation scripts.
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
  judge_hint: z.string().optional(),
});

export const StandardsRecordSchema = z.record(z.string().min(1), z.string().min(1));

export type StandardsMap = Record<string, string>;

export const EvaluatorFrontmatterSchema = z
  .object({
    schema_version: z.number().optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    severity: SeveritySchema,
    standards: StandardsRecordSchema.optional(),
    pass_criteria: z.string().min(1),
    fail_criteria: z.string().min(1),
    description: z.string().optional(),
    // Patterns optional - can come from patterns/ directory for directory-form
    patterns: z.array(PatternSchema).optional(),
    judge_hint: z.string().optional(),
    // Also allow camelCase judgeHint variant
    judgeHint: z.string().optional(),
    // Verbose, evaluator-specific guidance injected into the judge prompt
    // (consumed by loadEvaluatorCriteria.ts → judge.ts). Sibling to judge_hint.
    judge_instructions: z.string().optional(),
    surfaces: z.array(SurfaceSchema).optional(),
    turn_mode: TurnModeSchema.optional(),
    strategy: StrategySchema.optional(),
    // New fields from restructure
    types: z.array(z.string()).optional(),
    scan_mode: z.enum(["source_code", "tool_description"]).optional(),
    applies_to_all_tools: z.boolean().optional(),
    metric_threshold: z.number().optional(),
    untestable_reason: z.string().optional(),
    // Dependency chain for multi-phase evaluators
    depends_on: z.union([z.string(), z.array(z.string())]).optional(),
    // MCP-specific fields
    mcp_top_10: z.string().optional(),
    judge_needs_llm: z.boolean().optional(),
  })
  .strict(); // Strict mode - unknown keys error instead of being ignored

export type EvaluatorFrontmatter = z.infer<typeof EvaluatorFrontmatterSchema>;

/**
 * Frontmatter contract for the `source-analysis` family ONLY.
 *
 * These are white-box static-analysis (SAST) evaluators meant to be driven by
 * skills, not the dynamic CLI attack engine — a different modality with a
 * different shape (`surface: code`, `scan_mode: source_code`, a `source_scan`
 * block, no attack `patterns`). Validating them against the dynamic
 * `EvaluatorFrontmatterSchema` would fail on those keys, so files under a
 * `source-analysis/` folder are routed here instead (see parseEvaluator).
 *
 * Kept `.strict()` deliberately: the dynamic schema stays strict too, so a typo
 * in either family is still caught — we did NOT loosen everything to passthrough.
 */
export const SourceAnalysisFrontmatterSchema = z
  .object({
    schema_version: z.literal(1).optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    severity: SeveritySchema,
    /** Static source inspection, not a runtime surface — distinct from `surfaces`. */
    surface: z.literal("code"),
    scan_mode: z.literal("source_code"),
    standards: StandardsRecordSchema.optional(),
    /** Dynamic sibling evaluator this static check seeds/confirms. */
    correlates_with: z.string().min(1),
    description: z.string().optional(),
    /** SAST config (languages, sink/source patterns, taint question) — freeform internally. */
    source_scan: z.record(z.string(), z.unknown()).optional(),
    pass_criteria: z.string().min(1),
    fail_criteria: z.string().min(1),
    /** Static evaluators carry no attack patterns; an empty list is expected. */
    patterns: z.array(PatternSchema).optional(),
    judge_needs_llm: z.boolean().optional(),
    applies_to_all_tools: z.boolean().optional(),
    /** MCP Top-10 mapping (e.g. "MCP05"), present on mcp-surface source scans. */
    mcp_top_10: z.string().optional(),
  })
  .strict();

export type SourceAnalysisFrontmatter = z.infer<typeof SourceAnalysisFrontmatterSchema>;

/**
 * Frontmatter contract for `evaluators/{agent|mcp}/<category>/README.md` category
 * overview files — the family-level description, boundary, and rubric.
 *
 * Consumed by the autonomous hunt vuln-class loader
 * (`core/src/autonomous/knowledge/vulnClasses.ts`) for the allow-listed agent
 * categories, so hunt's vulnerability-class menu stays in sync with the same
 * taxonomy `opfor run` uses instead of a separate hand-maintained library.
 *
 * `severity` is a deliberate one-time editorial addition to each category README
 * (see AGENTS.md) — it is NOT auto-derived from child `evaluator.yaml` files.
 * Kept `.strict()` to match the sibling evaluator schemas so a typo is caught.
 */
/**
 * Category-level standards allow a single id or a list per framework
 * (e.g. `owasp-llm: [LLM02, LLM07]`), unlike leaf evaluators which map one id
 * per framework. Consumers that need a flat string join the list.
 */
export const CategoryStandardsSchema = z.record(
  z.string().min(1),
  z.union([z.string().min(1), z.array(z.string().min(1))])
);

export const CategoryFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    surface: SurfaceSchema,
    severity: SeveritySchema,
    description: z.string().min(1),
    boundary: z.string().optional(),
    standards: CategoryStandardsSchema.optional(),
    applies_to: z.array(z.string()).optional(),
    status: z.string().optional(),
    scan_mode: z.enum(["source_code", "tool_description"]).optional(),
    metric_kind: z.boolean().optional(),
    fail_rubric: z.string().min(1),
    pass_rubric: z.string().min(1),
  })
  .strict();

export type CategoryFrontmatter = z.infer<typeof CategoryFrontmatterSchema>;

export const SuiteFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    evaluators: z.array(z.string().min(1)).min(1),
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export type SuiteFrontmatter = z.infer<typeof SuiteFrontmatterSchema>;
