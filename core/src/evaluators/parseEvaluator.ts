import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitYamlFrontmatter } from "../util/yamlFrontmatter.js";
import { getEvaluatorsDir, type EvaluatorCategory } from "../config/evaluatorsLayout.js";
import { findEvaluatorFile } from "../catalog/findEvaluatorFile.js";
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
  /** IDs of evaluators whose session context this evaluator depends on. */
  dependsOn?: string[];
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

function parseDependsOn(doc: Record<string, unknown>): string[] {
  const raw = doc.depends_on ?? doc.dependsOn;
  if (!raw) return [];
  if (typeof raw === "string") return [raw.trim()].filter(Boolean);
  if (Array.isArray(raw))
    return raw
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
  return [];
}

/** Parse evaluator from `evaluators/{agent|mcp}/<id>.md` (YAML frontmatter). */
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

  const spec = parseEvaluatorFrontmatter(doc, mdPath);
  const dependsOn = parseDependsOn(doc as Record<string, unknown>);
  if (dependsOn.length > 0) spec.dependsOn = dependsOn;
  return spec;
}

export function getEvaluatorsDirForTarget(targetKind: EvaluatorCategory): string {
  return getEvaluatorsDir(targetKind);
}

/** Load patterns from a sibling patterns/ directory (folder-based evaluators). */
async function loadFolderPatterns(evaluatorDir: string): Promise<AttackPattern[]> {
  const patternsDir = path.join(evaluatorDir, "patterns");
  let files: string[];
  try {
    files = (await readdir(patternsDir)).filter((f) => f.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
  const patterns: AttackPattern[] = [];
  for (const f of files) {
    const raw = await readFile(path.join(patternsDir, f), "utf8");
    const p = parseYaml(raw) as Record<string, unknown>;
    const n = typeof p?.name === "string" ? p.name.trim() : "";
    const t = typeof p?.template === "string" ? p.template.trim() : "";
    if (n && t) patterns.push({ name: n, template: t });
  }
  return patterns;
}

/** Parse a pure YAML evaluator file (new format). */
export async function parseYamlEvaluator(yamlPath: string): Promise<EvaluatorSpec> {
  const raw = await readFile(yamlPath, "utf8");
  const doc = parseYaml(raw) as Record<string, unknown>;

  let patterns: AttackPattern[] = [];

  if (path.basename(yamlPath) === "evaluator.yaml") {
    patterns = await loadFolderPatterns(path.dirname(yamlPath));
  } else if (Array.isArray(doc.patterns)) {
    patterns = (doc.patterns as Array<Record<string, unknown>>)
      .filter((p) => typeof p?.name === "string" && typeof p?.template === "string")
      .map((p) => ({ name: (p.name as string).trim(), template: (p.template as string).trim() }));
  }

  const spec: EvaluatorSpec = {
    id: typeof doc.id === "string" ? doc.id.trim() : path.basename(yamlPath, ".yaml"),
    name: typeof doc.name === "string" ? doc.name.trim() : "",
    severity: typeof doc.severity === "string" ? doc.severity : "high",
    description: typeof doc.description === "string" ? doc.description.trim() : "",
    passCriteria: typeof doc.pass_criteria === "string" ? doc.pass_criteria.trim() : "",
    failCriteria: typeof doc.fail_criteria === "string" ? doc.fail_criteria.trim() : "",
    patterns,
  };

  const standards = resolveStandardsFromFrontmatter(doc);
  if (standards && Object.keys(standards).length > 0) spec.standards = standards;
  if (Array.isArray(doc.surfaces) && doc.surfaces.length) {
    spec.surfaces = doc.surfaces as Array<"agent" | "browser" | "mcp">;
  }
  if (typeof doc.turn_mode === "string") spec.turnMode = doc.turn_mode as "single" | "multi";
  if (typeof doc.strategy === "string") spec.strategy = doc.strategy as EvaluatorStrategy;
  if (typeof doc.judge_hint === "string") spec.judgeHint = doc.judge_hint.trim() || undefined;

  const dependsOn = parseDependsOn(doc);
  if (dependsOn.length > 0) spec.dependsOn = dependsOn;

  return spec;
}

export async function loadBuiltinEvaluator(
  id: string,
  targetKind: "agent" | "mcp" = "agent"
): Promise<EvaluatorSpec> {
  const filePath = await findEvaluatorFile(id, targetKind);
  if (filePath.endsWith(".yaml")) {
    return parseYamlEvaluator(filePath);
  }
  return parseEvaluator(filePath);
}
