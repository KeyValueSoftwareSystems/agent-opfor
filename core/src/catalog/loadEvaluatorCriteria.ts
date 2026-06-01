import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getEvaluatorsDir } from "../config/evaluatorsLayout.js";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";
import type { EvaluatorCriteria } from "../run/judge.js";
import { resolveStandardsFromFrontmatter } from "../evaluators/standards.js";

export async function loadEvaluatorCriteria(evaluatorId: string): Promise<EvaluatorCriteria> {
  const dir = getEvaluatorsDir("mcp");
  const raw = await readFile(path.join(dir, `${evaluatorId}.md`), "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) throw new Error(`Evaluator ${evaluatorId}: missing YAML frontmatter`);
  const doc = parseYaml(sp.yaml) as Record<string, unknown>;
  const standards = resolveStandardsFromFrontmatter(doc);
  return {
    id: typeof doc.id === "string" ? doc.id : evaluatorId,
    name: typeof doc.name === "string" ? doc.name : evaluatorId,
    ...(standards ? { standards } : {}),
    severity: typeof doc.severity === "string" ? doc.severity : "high",
    passCriteria: typeof doc.pass_criteria === "string" ? doc.pass_criteria : "",
    failCriteria: typeof doc.fail_criteria === "string" ? doc.fail_criteria : "",
    judgeInstructions:
      typeof doc.judge_instructions === "string" ? doc.judge_instructions : undefined,
  };
}
