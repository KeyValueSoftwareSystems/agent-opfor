import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";
import { getOpforSetupRoot } from "../config/skillsLayout.js";
import { getCatalogRoot } from "../catalog/loadCatalog.js";

export interface AttackPattern {
  name: string;
  template: string;
}

export interface EvaluatorSpec {
  id: string;
  name: string;
  severity: string;
  ref: string;
  description: string;
  passCriteria: string;
  failCriteria: string;
  patterns: AttackPattern[];
  /** Optional operator hint that sharpens the judge for this evaluator. */
  judgeHint?: string;
}

function str(doc: Record<string, unknown>, key: string): string {
  const v = doc[key];
  return typeof v === "string" ? v : "";
}

function parsePatterns(doc: Record<string, unknown>): AttackPattern[] {
  const raw = doc.patterns;
  if (!Array.isArray(raw)) return [];
  const out: AttackPattern[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = str(o, "name");
    const template = str(o, "template");
    if (!name.trim() || !template.trim()) continue;
    out.push({ name: name.trim(), template: template.trim() });
  }
  return out;
}

/** Parse evaluator from `skills/opfor-setup/evaluators/<id>.md` (YAML frontmatter only). */
export async function parseEvaluator(mdPath: string): Promise<EvaluatorSpec> {
  const raw = await readFile(mdPath, "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) {
    throw new Error(`Evaluator ${mdPath}: file must start with YAML frontmatter between --- lines`);
  }
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(sp.yaml) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Evaluator ${mdPath}: invalid YAML in frontmatter: ${msg}`, { cause: e });
  }

  const id = str(doc, "id");
  const name = str(doc, "name");
  const severity = str(doc, "severity");
  const ref = str(doc, "ref");
  const description = str(doc, "description");
  const passCriteria = str(doc, "pass_criteria") || str(doc, "passCriteria");
  const failCriteria = str(doc, "fail_criteria") || str(doc, "failCriteria");
  const patterns = parsePatterns(doc);

  if (!id) throw new Error(`Evaluator ${mdPath}: frontmatter must set id`);
  if (!name) throw new Error(`Evaluator ${mdPath}: frontmatter must set name`);

  return {
    id,
    name,
    severity,
    ref,
    description,
    passCriteria,
    failCriteria,
    patterns,
  };
}

export function getEvaluatorsDir(targetKind: "agent" | "mcp"): string {
  return targetKind === "mcp"
    ? path.join(getCatalogRoot(), "evaluators")
    : path.join(getOpforSetupRoot(), "evaluators");
}

export async function loadBuiltinEvaluator(
  id: string,
  targetKind: "agent" | "mcp" = "agent"
): Promise<EvaluatorSpec> {
  return parseEvaluator(path.join(getEvaluatorsDir(targetKind), `${id}.md`));
}
