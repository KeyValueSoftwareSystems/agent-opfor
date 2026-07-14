/**
 * Validate evaluator and suite YAML files at repo root (`evaluators/`, `suites/`).
 *
 * Evaluator structure (new YAML format):
 *   evaluators/{category}/{subcategory}/{evaluator-name}/
 *     - evaluator.yaml (required: id, name, severity, pass_criteria, fail_criteria)
 *     - patterns/*.yaml (attack patterns)
 *     - *.test.yaml (optional test cases)
 *
 * Suite structure:
 *   suites/{category}/*.yaml (id, name, description, evaluators[])
 *
 * Exit 0 — all files valid (warnings may still be printed).
 * Exit 1 — one or more hard errors found.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadAtlasTechniqueIdSet } from "../core/src/standards/atlas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Schema for pattern YAML files
const PatternYamlSchema = z.object({
  name: z.string().min(1),
  template: z.string().min(1),
  judge_hint: z.string().optional(),
});

// Schema for evaluator.yaml files (and flat-file evaluators, which allow inline `patterns`)
const EvaluatorYamlSchema = z.object({
  schema_version: z.number().optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  description: z.string().optional(),
  pass_criteria: z.string().min(1),
  fail_criteria: z.string().min(1),
  standards: z
    .object({
      "owasp-llm": z.string().optional(),
      "owasp-agentic": z.string().optional(),
      "owasp-api": z.string().optional(),
      "owasp-mcp": z.string().optional(),
      atlas: z.string().optional(),
      "eu-ai-act": z.string().optional(),
      nist: z.string().optional(),
    })
    .optional(),
  judge_hint: z.string().optional(),
  surfaces: z.array(z.enum(["agent", "browser", "mcp"])).optional(),
  turn_mode: z.enum(["single", "multi"]).optional(),
  strategy: z.string().optional(),
  depends_on: z.union([z.string(), z.array(z.string())]).optional(),
  patterns: z.array(PatternYamlSchema).optional(),
});

// Schema for suite YAML files
const SuiteYamlSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  evaluators: z.array(z.string().min(1)).min(1),
});

const EVALUATOR_TREES = [
  {
    label: "agent",
    evaluatorsDir: path.join(REPO_ROOT, "evaluators/agent"),
    suitesDir: path.join(REPO_ROOT, "suites/agent"),
  },
  {
    label: "mcp",
    evaluatorsDir: path.join(REPO_ROOT, "evaluators/mcp"),
    suitesDir: path.join(REPO_ROOT, "suites/mcp"),
  },
];

interface FileResult {
  file: string;
  errors: string[];
  warnings: string[];
}

/**
 * Recursively find all evaluator files in a directory — both directory-form
 * (evaluator.yaml) and flat-file form (<id>.yaml, patterns inline).
 */
async function findEvaluatorFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const skipDirs = new Set(["patterns", "_shared", "node_modules", ".git"]);

  const isFlatEvaluatorFile = (entry: string): boolean =>
    /\.ya?ml$/i.test(entry) && !/\.test\.ya?ml$/i.test(entry) && !/^evaluator\.ya?ml$/i.test(entry);

  async function walk(currentDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        if (skipDirs.has(entry)) continue;
        await walk(fullPath);
      } else if (entry === "evaluator.yaml") {
        results.push(fullPath);
      } else if (isFlatEvaluatorFile(entry)) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/** Find all pattern YAML files for an evaluator. */
async function findPatternFiles(evaluatorDir: string): Promise<string[]> {
  const patternsDir = path.join(evaluatorDir, "patterns");
  try {
    const entries = await readdir(patternsDir);
    return entries
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => path.join(patternsDir, f));
  } catch {
    return [];
  }
}

async function validateEvaluator(
  filePath: string,
  knownIds: Map<string, string>,
  atlasTechniqueIds: Set<string>
): Promise<FileResult> {
  const relPath = path.relative(REPO_ROOT, filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { file: relPath, errors: ["could not read file"], warnings };
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { file: relPath, errors: [`invalid YAML: ${msg}`], warnings };
  }

  const result = EvaluatorYamlSchema.safeParse(doc);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      errors.push(`${field ? field + ": " : ""}${issue.message}`);
    }
    return { file: relPath, errors, warnings };
  }

  const data = result.data;
  const id = data.id;

  if (knownIds.has(id)) {
    errors.push(`duplicate id "${id}" — also used in ${knownIds.get(id)}`);
  } else {
    knownIds.set(id, relPath);
  }

  if (!data.description?.trim()) {
    warnings.push("description is empty (recommended for docs)");
  }

  // Validate ATLAS technique ID
  const atlasId = data.standards?.atlas;
  if (typeof atlasId === "string" && atlasId.trim()) {
    const normalized = atlasId.trim();
    if (!/^AML\.T\d{4}(\.\d{3})?$/.test(normalized)) {
      errors.push(
        `standards.atlas: invalid format "${normalized}" (expected AML.T#### or AML.T####.###)`
      );
    } else if (!atlasTechniqueIds.has(normalized)) {
      errors.push(
        `standards.atlas: unknown technique id "${normalized}" (not found in third_party/atlas-data)`
      );
    }
  }

  // Validate patterns exist — directory-form evaluators keep them in patterns/*.yaml;
  // flat-file evaluators declare them inline (already schema-validated above).
  const isDirectoryForm = path.basename(filePath) === "evaluator.yaml";
  if (isDirectoryForm) {
    const evaluatorDir = path.dirname(filePath);
    const patternFiles = await findPatternFiles(evaluatorDir);
    if (patternFiles.length === 0) {
      warnings.push("no patterns found in patterns/ directory");
    }

    // Validate each pattern file
    for (const patternFile of patternFiles) {
      const patternRelPath = path.relative(REPO_ROOT, patternFile);
      try {
        const patternRaw = await readFile(patternFile, "utf8");
        const patternDoc = parseYaml(patternRaw);
        const patternResult = PatternYamlSchema.safeParse(patternDoc);
        if (!patternResult.success) {
          for (const issue of patternResult.error.issues) {
            const field = issue.path.join(".");
            errors.push(`${patternRelPath}: ${field ? field + ": " : ""}${issue.message}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${patternRelPath}: ${msg}`);
      }
    }
  } else if (!data.patterns || data.patterns.length === 0) {
    warnings.push("no inline patterns found");
  }

  return { file: relPath, errors, warnings };
}

async function validateSuite(filePath: string, evaluatorIds: Set<string>): Promise<FileResult> {
  const relPath = path.relative(REPO_ROOT, filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { file: relPath, errors: ["could not read file"], warnings };
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { file: relPath, errors: [`invalid YAML: ${msg}`], warnings };
  }

  const result = SuiteYamlSchema.safeParse(doc);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      errors.push(`${field ? field + ": " : ""}${issue.message}`);
    }
    return { file: relPath, errors, warnings };
  }

  // Check that all referenced evaluators exist
  for (const evId of result.data.evaluators) {
    if (!evaluatorIds.has(evId)) {
      errors.push(`evaluators[]: "${evId}" does not match any evaluator`);
    }
  }

  if (!result.data.description?.trim()) {
    warnings.push("description is empty (recommended for display)");
  }

  return { file: relPath, errors, warnings };
}

async function main(): Promise<void> {
  const allResults: FileResult[] = [];
  const knownIds = new Map<string, string>();

  let atlasTechniqueIds: Set<string>;
  try {
    atlasTechniqueIds = await loadAtlasTechniqueIdSet();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n✗ Could not load MITRE ATLAS data for validation.\n\n${msg}\n`);
    process.exit(1);
  }

  // Validate all evaluators
  for (const tree of EVALUATOR_TREES) {
    const evaluatorFiles = await findEvaluatorFiles(tree.evaluatorsDir);

    for (const fp of evaluatorFiles) {
      allResults.push(await validateEvaluator(fp, knownIds, atlasTechniqueIds));
    }
  }

  // Collect all evaluator IDs for suite validation
  const allEvaluatorIds = new Set(knownIds.keys());

  // Validate all suites
  for (const tree of EVALUATOR_TREES) {
    let suiteFiles: string[];
    try {
      const entries = await readdir(tree.suitesDir);
      suiteFiles = entries
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .map((f) => path.join(tree.suitesDir, f));
    } catch {
      suiteFiles = [];
    }

    for (const fp of suiteFiles) {
      allResults.push(await validateSuite(fp, allEvaluatorIds));
    }
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithIssues = 0;

  for (const r of allResults) {
    if (r.errors.length === 0 && r.warnings.length === 0) continue;
    filesWithIssues++;

    if (r.errors.length > 0) {
      console.log(`\n✗ ${r.file}`);
      for (const e of r.errors) {
        console.log(`    error: ${e}`);
        totalErrors++;
      }
    }
    if (r.warnings.length > 0) {
      if (r.errors.length === 0) console.log(`\n⚠ ${r.file}`);
      for (const w of r.warnings) {
        console.log(`    warn:  ${w}`);
        totalWarnings++;
      }
    }
  }

  const totalFiles = allResults.length;
  const cleanFiles = totalFiles - filesWithIssues;

  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(
    `  ${totalFiles} files checked   ${cleanFiles} clean   ${totalErrors} errors   ${totalWarnings} warnings`
  );
  console.log(`─────────────────────────────────────────────────────`);

  if (totalErrors > 0) {
    console.log(`\n  Fix the errors above before committing.\n`);
    process.exit(1);
  }

  if (totalWarnings > 0) {
    console.log(`\n  Warnings found — consider addressing them, but commit is allowed.\n`);
  } else {
    console.log(`\n  All evaluator/suite files are valid.\n`);
  }
}

main().catch((e) => {
  console.error("validate-skills crashed:", e);
  process.exit(1);
});
