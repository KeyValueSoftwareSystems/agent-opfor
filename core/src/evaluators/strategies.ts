/**
 * Named engine strategies for evaluators too complex for YAML-only patterns.
 */
import { StrategySchema } from "./schema.js";
import { z } from "zod";

export type EvaluatorStrategy = z.infer<typeof StrategySchema>;

const STRATEGY_DESCRIPTIONS: Record<EvaluatorStrategy, string> = {
  "declarative-patterns":
    "Use frontmatter patterns (and optional attacker LLM paraphrase). Default for most evaluators.",
  "adaptive-multi-turn":
    "Attacker LLM adapts each turn from target responses (browser/agent orchestrator).",
  "mcp-scanner": "MCP-specific scanner flow without declarative chat patterns.",
};

export function describeStrategy(strategy: EvaluatorStrategy): string {
  return STRATEGY_DESCRIPTIONS[strategy] ?? strategy;
}

export function assertKnownStrategy(strategy: string): EvaluatorStrategy {
  const parsed = StrategySchema.safeParse(strategy);
  if (!parsed.success) {
    throw new Error(
      `Unknown strategy "${strategy}". Registered: declarative-patterns, adaptive-multi-turn, mcp-scanner`
    );
  }
  return parsed.data;
}
