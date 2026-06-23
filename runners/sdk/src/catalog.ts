import { loadSkillCatalog } from "@agent-opfor/core/config/loadSkillCatalog.js";
import { loadCatalog } from "@agent-opfor/core/catalog/loadCatalog.js";
import type { SuiteInfo, EvaluatorInfo, ListEvaluatorsOptions } from "./types.js";

/**
 * List available test suites.
 *
 * @example
 * ```typescript
 * const suites = await listSuites();
 * // [{ id: "owasp-llm-top10", name: "OWASP LLM Top 10", evaluatorCount: 10 }, ...]
 * ```
 */
export async function listSuites(): Promise<SuiteInfo[]> {
  const catalog = await loadSkillCatalog();

  return catalog.suites.map((suite) => ({
    id: suite.id,
    name: suite.name,
    description: suite.description,
    evaluatorCount: suite.evaluatorIds.length,
  }));
}

/**
 * List available evaluators.
 *
 * @example
 * ```typescript
 * const evaluators = await listEvaluators();
 * const mcpEvaluators = await listEvaluators({ kind: "mcp" });
 * ```
 */
export async function listEvaluators(options?: ListEvaluatorsOptions): Promise<EvaluatorInfo[]> {
  const kind = options?.kind ?? "agent";

  const catalog = kind === "mcp" ? await loadCatalog() : await loadSkillCatalog();

  return catalog.evaluators.map((evaluator) => ({
    id: evaluator.id,
    name: evaluator.name,
    severity: evaluator.severity,
    standards: evaluator.standards,
  }));
}
