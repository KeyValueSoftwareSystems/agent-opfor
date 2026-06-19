import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  discoverEvaluatorFiles,
  discoverPatternFiles,
  buildEvaluatorIndex,
  type DiscoveredEvaluator,
} from "../catalog/discoverEvaluators.js";
import { EvaluatorFrontmatterSchema } from "./schema.js";
import type { StandardsMap } from "./schema.js";
import type { EvaluatorStrategy } from "./strategies.js";
import { resolveStandardsFromFrontmatter } from "./standards.js";

export interface AttackPattern {
  name: string;
  template: string;
  judgeHint?: string;
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
  judgeHint?: string;
  dependsOn?: string[];
  surfaces?: Array<"agent" | "browser" | "mcp">;
  turnMode?: "single" | "multi";
  strategy?: EvaluatorStrategy;
}

// Cached evaluator index
let evaluatorIndex: Map<string, DiscoveredEvaluator> | null = null;

async function getEvaluatorIndex(): Promise<Map<string, DiscoveredEvaluator>> {
  if (!evaluatorIndex) {
    evaluatorIndex = await buildEvaluatorIndex();
  }
  return evaluatorIndex;
}

/** Clear the cached index (useful for tests). */
export function clearEvaluatorIndexCache(): void {
  evaluatorIndex = null;
}

/**
 * Parse an evaluator from a YAML file path.
 * Handles both directory-form (evaluator.yaml + patterns/) and inline patterns.
 */
export async function parseEvaluator(yamlPath: string): Promise<EvaluatorSpec> {
  const raw = await readFile(yamlPath, "utf8");
  const doc = parseYaml(raw) as Record<string, unknown>;

  const parsed = EvaluatorFrontmatterSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Evaluator ${yamlPath}: validation failed: ${issues}`);
  }

  const fm = parsed.data;

  // Collect patterns - inline or from patterns/ directory
  const patterns: AttackPattern[] = (fm.patterns ?? []).map((p) => ({
    name: p.name.trim(),
    template: p.template.trim(),
    judgeHint: p.judge_hint?.trim(),
  }));

  // If no inline patterns, look for a patterns/ directory — but ONLY for
  // directory-form evaluators (evaluator.yaml), whose dirname IS the evaluator's
  // own folder. A flat-form evaluator (<id>.yaml) shares its dirname with the
  // whole category, so scanning patterns/ there would load some OTHER evaluator's
  // patterns. Flat-form evaluators must therefore define their patterns inline.
  const isDirectoryForm = /^evaluator\.ya?ml$/i.test(path.basename(yamlPath));
  if (patterns.length === 0 && isDirectoryForm) {
    const evaluatorDir = path.dirname(yamlPath);
    const patternFiles = await discoverPatternFiles(evaluatorDir);

    for (const pf of patternFiles) {
      try {
        const patternContent = await readFile(pf.filePath, "utf8");
        const patternDoc = parseYaml(patternContent) as Record<string, unknown>;
        const name = typeof patternDoc.name === "string" ? patternDoc.name.trim() : pf.name;
        const template = typeof patternDoc.template === "string" ? patternDoc.template.trim() : "";
        const judgeHint =
          typeof patternDoc.judge_hint === "string" ? patternDoc.judge_hint.trim() : undefined;

        if (template) {
          patterns.push({ name, template, judgeHint });
        }
      } catch {
        // Skip unparseable pattern files
      }
    }
  }

  // Patterns required unless strategy is mcp-scanner
  if (patterns.length === 0 && fm.strategy !== "mcp-scanner") {
    const where = isDirectoryForm
      ? "inline or in a patterns/ directory"
      : "inline (flat-form evaluators cannot use a patterns/ directory)";
    throw new Error(`Evaluator ${yamlPath}: must have patterns (${where})`);
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

  const standards = resolveStandardsFromFrontmatter(doc);
  if (standards && Object.keys(standards).length > 0) spec.standards = standards;
  if (fm.surfaces?.length) spec.surfaces = fm.surfaces;
  if (fm.turn_mode) spec.turnMode = fm.turn_mode;
  if (fm.strategy) spec.strategy = fm.strategy;

  // Parse depends_on
  const dependsOn = parseDependsOn(doc);
  if (dependsOn.length > 0) spec.dependsOn = dependsOn;

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

/**
 * Load an evaluator by ID. Uses the discovery index to find the file.
 */
export async function loadBuiltinEvaluator(
  id: string,
  targetKind: "agent" | "mcp" = "agent"
): Promise<EvaluatorSpec> {
  const index = await getEvaluatorIndex();
  const discovered = index.get(id);

  if (!discovered) {
    throw new Error(`Evaluator "${id}" not found in ${targetKind} category`);
  }

  return parseEvaluator(discovered.filePath);
}

/**
 * Load all evaluators for a category.
 */
export async function loadAllEvaluators(category: "agent" | "mcp"): Promise<EvaluatorSpec[]> {
  const discovered = await discoverEvaluatorFiles(category);
  const specs: EvaluatorSpec[] = [];

  for (const d of discovered) {
    try {
      const spec = await parseEvaluator(d.filePath);
      specs.push(spec);
    } catch (e) {
      console.error(`Failed to parse ${d.filePath}: ${e}`);
    }
  }

  return specs;
}
