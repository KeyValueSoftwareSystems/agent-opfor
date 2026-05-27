import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";
import { getOpforSetupRoot } from "../config/skillsLayout.js";
import { getCatalogRoot } from "../catalog/loadCatalog.js";
import { EvaluatorFrontmatterSchema } from "./schema.js";
import type { StandardsMap } from "./schema.js";
import type { EvaluatorStrategy } from "./strategies.js";
import { resolveStandardsFromFrontmatter } from "./standards.js";

export interface AttackPattern {
  name: string;
  template: string;
}

export interface EvaluatorSpec {
  id: string;
  name: string;
  severity: string;
  standards?: StandardsMap;
  description: string;
  passCriteria: string;
  failCriteria: string;
  patterns: AttackPattern[];
  /** Optional operator hint that sharpens the judge for this evaluator. */
  judgeHint?: string;
  surfaces?: Array<"agent" | "browser" | "mcp">;
  turnMode?: "single" | "multi";
  strategy?: EvaluatorStrategy;
}

export function parseEvaluatorFrontmatter(doc: unknown, mdPath: string): EvaluatorSpec {
  const parsed = EvaluatorFrontmatterSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Evaluator ${mdPath}: frontmatter validation failed: ${issues}`);
  }

  const fm = parsed.data;
  const patterns = (fm.patterns ?? []).map((p) => ({
    name: p.name.trim(),
    template: p.template.trim(),
  }));

  if (patterns.length === 0) {
    throw new Error(`Evaluator ${mdPath}: frontmatter must set patterns (non-empty array)`);
  }

  const spec: EvaluatorSpec = {
    id: fm.id.trim(),
    name: fm.name.trim(),
    severity: fm.severity,
    description: fm.description?.trim() ?? "",
    passCriteria: fm.pass_criteria.trim(),
    failCriteria: fm.fail_criteria.trim(),
    patterns,
    judgeHint: fm.judge_hint?.trim() || undefined,
  };

  const standards = resolveStandardsFromFrontmatter(doc as Record<string, unknown>);
  if (standards && Object.keys(standards).length > 0) spec.standards = standards;
  if (fm.surfaces?.length) spec.surfaces = fm.surfaces;
  if (fm.turn_mode) spec.turnMode = fm.turn_mode;
  if (fm.strategy) spec.strategy = fm.strategy;

  return spec;
}

/** Parse evaluator from `skills/opfor-setup/evaluators/<id>.md` (YAML frontmatter). */
export async function parseEvaluator(mdPath: string): Promise<EvaluatorSpec> {
  const raw = await readFile(mdPath, "utf8");
  const sp = splitYamlFrontmatter(raw);
  if (!sp) {
    throw new Error(`Evaluator ${mdPath}: file must start with YAML frontmatter between --- lines`);
  }
  let doc: unknown;
  try {
    doc = parseYaml(sp.yaml) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Evaluator ${mdPath}: invalid YAML in frontmatter: ${msg}`, { cause: e });
  }

  return parseEvaluatorFrontmatter(doc, mdPath);
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
