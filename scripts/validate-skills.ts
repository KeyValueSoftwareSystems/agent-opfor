/**
 * Validate evaluator and suite YAML at repo root (`evaluators/`, `suites/`).
 *
 * Evaluator rules:
 *   - id, name, severity, pass_criteria, fail_criteria required
 *   - patterns required and non-empty for agent evaluators; optional for MCP
 *     (exception: scan_mode: source_code evaluators read source, so no patterns)
 *
 * Exit 0 — all files valid (warnings may still be printed).
 * Exit 1 — one or more hard errors found.
 */

import { execSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  EvaluatorFrontmatterSchema,
  SuiteFrontmatterSchema,
} from "../core/src/evaluators/schema.js";
import { loadAtlasTechniqueIdSet } from "../core/src/standards/atlas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const STAGED_ONLY = process.argv.includes("--staged");

function getStagedPaths(): Set<string> | null {
  if (!STAGED_ONLY) return null;
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const paths = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (!p.endsWith(".yaml")) continue;
      if (/^evaluators\/(agent|mcp)\//.test(p) || /^suites\//.test(p)) {
        paths.add(p);
      }
    }
    return paths;
  } catch {
    return new Set();
  }
}

const EVALUATOR_TREES = [
  {
    label: "agent",
    evaluatorsDir: path.join(REPO_ROOT, "evaluators/agent"),
    requirePatterns: true,
  },
  {
    label: "mcp",
    evaluatorsDir: path.join(REPO_ROOT, "evaluators/mcp"),
    requirePatterns: false,
  },
];

const SUITES_DIR = path.join(REPO_ROOT, "suites");

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function walkYamlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function recurse(d: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = path.join(d, entry);
      if (await isDir(full)) {
        if (entry === "patterns") continue;
        await recurse(full);
      } else if (entry.endsWith(".yaml") && !entry.endsWith(".test.yaml")) {
        results.push(full);
      }
    }
  }
  await recurse(dir);
  return results;
}

interface FileResult {
  file: string;
  errors: string[];
  warnings: string[];
}

type TreeConfig = (typeof EVALUATOR_TREES)[number];

async function validateEvaluator(
  filePath: string,
  tree: TreeConfig,
  knownIds: Map<string, string>,
  stagedPaths: Set<string> | null,
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

  const result = EvaluatorFrontmatterSchema.safeParse(doc);
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

  const inlinePatterns = data.patterns ?? [];
  const isSourceScan = (data as Record<string, unknown>).scan_mode === "source_code";
  const isFolderBased = path.basename(filePath) === "evaluator.yaml";

  // Folder-based evaluators store patterns in a sibling patterns/ directory
  let hasPatterns = inlinePatterns.length > 0;
  if (!hasPatterns && isFolderBased) {
    const patternsDir = path.join(path.dirname(filePath), "patterns");
    try {
      const pFiles = (await readdir(patternsDir)).filter((f) => f.endsWith(".yaml"));
      hasPatterns = pFiles.length > 0;
    } catch {
      // no patterns dir
    }
  }

  if (tree.requirePatterns && !hasPatterns && !isSourceScan) {
    errors.push(`patterns must be a non-empty array for ${tree.label} evaluators`);
  }

  if (!data.description?.trim()) {
    warnings.push("description is empty (recommended for contributor docs)");
  }

  const rawDoc = doc as Record<string, unknown>;
  const enforceStandardsShape = stagedPaths === null || stagedPaths.has(relPath);
  if (enforceStandardsShape) {
    if ("ref" in rawDoc) {
      errors.push(
        "ref is not supported — use standards: { owasp-llm: LLM07 } (see docs/evaluator-schema.md)"
      );
    }
    if ("mitre" in rawDoc) {
      errors.push(
        "mitre is not supported — use standards.atlas: AML.T0056 (see docs/evaluator-schema.md)"
      );
    }
  }

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

  return { file: relPath, errors, warnings };
}

async function validateSuite(filePath: string, allEvaluatorIds: Set<string>): Promise<FileResult> {
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

  const result = SuiteFrontmatterSchema.safeParse(doc);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      errors.push(`${field ? field + ": " : ""}${issue.message}`);
    }
  }

  if (result.success) {
    for (const evId of result.data.evaluators) {
      if (!allEvaluatorIds.has(evId)) {
        errors.push(`evaluators[]: "${evId}" does not match any evaluator`);
      }
    }
    if (!result.data.name?.trim()) {
      warnings.push("name is empty (recommended for display)");
    }
  }

  return { file: relPath, errors, warnings };
}

async function main(): Promise<void> {
  const allResults: FileResult[] = [];
  const knownIds = new Map<string, string>();
  const stagedPaths = getStagedPaths();
  let atlasTechniqueIds: Set<string>;
  try {
    atlasTechniqueIds = await loadAtlasTechniqueIdSet();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n✗ Could not load MITRE ATLAS data for validation.\n\n${msg}\n`);
    process.exit(1);
  }

  for (const tree of EVALUATOR_TREES) {
    const evalFiles = await walkYamlFiles(tree.evaluatorsDir);

    for (const fp of evalFiles) {
      allResults.push(await validateEvaluator(fp, tree, knownIds, stagedPaths, atlasTechniqueIds));
    }
  }

  // Suites
  let suiteFiles: string[];
  try {
    suiteFiles = (await readdir(SUITES_DIR))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => path.join(SUITES_DIR, f));
  } catch {
    suiteFiles = [];
  }

  const allEvaluatorIds = new Set(knownIds.keys());
  for (const fp of suiteFiles) {
    allResults.push(await validateSuite(fp, allEvaluatorIds));
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
    console.log(`\n  All skills files are valid.\n`);
  }
}

main().catch((e) => {
  console.error("validate-skills crashed:", e);
  process.exit(1);
});
