import type { EvaluatorCriteria } from "../run/judge.js";
import { resolveStandardsFromFrontmatter } from "../evaluators/standards.js";
import { loadEvaluatorYaml } from "./findEvaluatorFile.js";
import type { EvaluatorCategory } from "../config/evaluatorsLayout.js";

export async function loadEvaluatorCriteria(
  evaluatorId: string,
  category: EvaluatorCategory = "mcp"
): Promise<EvaluatorCriteria> {
  const { doc } = await loadEvaluatorYaml(evaluatorId, category);
  const standards = resolveStandardsFromFrontmatter(doc);

  const criteria: EvaluatorCriteria = {
    id: typeof doc.id === "string" ? doc.id : evaluatorId,
    name: typeof doc.name === "string" ? doc.name : evaluatorId,
    ...(standards ? { standards } : {}),
    severity: typeof doc.severity === "string" ? doc.severity : "high",
    passCriteria: typeof doc.pass_criteria === "string" ? doc.pass_criteria : "",
    failCriteria: typeof doc.fail_criteria === "string" ? doc.fail_criteria : "",
    judgeInstructions:
      typeof doc.judge_instructions === "string" ? doc.judge_instructions : undefined,
  };

  return criteria;
}
