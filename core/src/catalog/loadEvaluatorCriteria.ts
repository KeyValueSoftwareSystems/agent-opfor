import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getCatalogRoot } from "./loadCatalog.js";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";
import type { EvaluatorCriteria } from "../run/judge.js";

export async function loadEvaluatorCriteria(evaluatorId: string): Promise<EvaluatorCriteria> {
  const dir = path.join(getCatalogRoot(), "evaluators");
  const raw = await readFile(path.join(dir, `${evaluatorId}.md`), "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) throw new Error(`Evaluator ${evaluatorId}: missing YAML frontmatter`);
  const doc = parseYaml(sp.yaml) as Record<string, unknown>;
  return {
    id: typeof doc.id === "string" ? doc.id : evaluatorId,
    name: typeof doc.name === "string" ? doc.name : evaluatorId,
    ref: typeof doc.ref === "string" ? doc.ref : "",
    severity: typeof doc.severity === "string" ? doc.severity : "high",
    passCriteria: typeof doc.pass_criteria === "string" ? doc.pass_criteria : "",
    failCriteria: typeof doc.fail_criteria === "string" ? doc.fail_criteria : "",
    judgeInstructions:
      typeof doc.judge_instructions === "string" ? doc.judge_instructions : undefined,
  };
}
