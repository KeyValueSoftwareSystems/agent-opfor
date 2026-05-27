/**
 * Validate all evaluator and suite markdown files under skills/.
 *
 * Evaluator rules:
 *   - id, name, severity, pass_criteria, fail_criteria required
 *   - patterns required and non-empty for agent evaluators; optional for MCP
 *
 * Exit 0 — all files valid (warnings may still be printed).
 * Exit 1 — one or more hard errors found.
 */

import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  EvaluatorFrontmatterSchema,
  SuiteFrontmatterSchema,
} from "../core/src/evaluators/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const STAGED_ONLY = process.argv.includes("--staged");

/** Paths (repo-relative) of staged evaluator .md files when --staged is set. */
function getStagedEvaluatorPaths(): Set<string> | null {
  if (!STAGED_ONLY) return null;
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const paths = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (!p.endsWith(".md")) continue;
      if (p.includes("/opfor-setup/evaluators/")) paths.add(p);
    }
    return paths;
  } catch {
    return new Set();
  }
}

const SKILL_TREES = [
  {
    label: "agent-redteaming",
    evaluatorsDir: path.join(REPO_ROOT, "skills/agent-redteaming/opfor-setup/evaluators"),
    suitesDir: path.join(REPO_ROOT, "skills/agent-redteaming/opfor-setup/suites"),
    requirePatterns: true,
  },
  {
    label: "mcp-redteaming",
    evaluatorsDir: path.join(REPO_ROOT, "skills/mcp-redteaming/opfor-setup/evaluators"),
    suitesDir: path.join(REPO_ROOT, "skills/mcp-redteaming/opfor-setup/suites"),
    requirePatterns: false,
  },
];

function splitFrontmatter(raw: string): { yaml: string; body: string } | null {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return {
        yaml: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
}

interface FileResult {
  file: string;
  errors: string[];
  warnings: string[];
}

async function validateEvaluator(
  filePath: string,
  tree: (typeof SKILL_TREES)[number],
  knownIds: Map<string, string>,
  stagedEvaluatorPaths: Set<string> | null
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

  const fm = splitFrontmatter(raw);
  if (!fm) {
    return {
      file: relPath,
      errors: ["file must start with YAML frontmatter between --- lines"],
      warnings,
    };
  }

  let doc: unknown;
  try {
    doc = parseYaml(fm.yaml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { file: relPath, errors: [`invalid YAML in frontmatter: ${msg}`], warnings };
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

  const patterns = data.patterns ?? [];

  if (tree.requirePatterns && patterns.length === 0) {
    errors.push("patterns must be a non-empty array for agent evaluators");
  }

  if (!data.description?.trim()) {
    warnings.push("description is empty (recommended for contributor docs)");
  }

  const rawDoc = doc as Record<string, unknown>;
  const enforceStandardsShape = stagedEvaluatorPaths === null || stagedEvaluatorPaths.has(relPath);
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

  return { file: relPath, errors, warnings };
}

async function validateSuite(filePath: string, evaluatorFiles: Set<string>): Promise<FileResult> {
  const relPath = path.relative(REPO_ROOT, filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { file: relPath, errors: ["could not read file"], warnings };
  }

  const fm = splitFrontmatter(raw);
  if (!fm) {
    return {
      file: relPath,
      errors: ["file must start with YAML frontmatter between --- lines"],
      warnings,
    };
  }

  let doc: unknown;
  try {
    doc = parseYaml(fm.yaml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { file: relPath, errors: [`invalid YAML in frontmatter: ${msg}`], warnings };
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
      if (!evaluatorFiles.has(evId)) {
        errors.push(`evaluators[]: "${evId}" does not match any evaluator file in this tree`);
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
  const stagedEvaluatorPaths = getStagedEvaluatorPaths();

  for (const tree of SKILL_TREES) {
    let evalFiles: string[];
    try {
      evalFiles = (await readdir(tree.evaluatorsDir))
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(tree.evaluatorsDir, f));
    } catch {
      console.error(`  Could not read evaluators directory: ${tree.evaluatorsDir}`);
      process.exit(1);
    }

    const evaluatorIdsByFilestem = new Set(evalFiles.map((f) => path.basename(f, ".md")));

    for (const fp of evalFiles) {
      allResults.push(await validateEvaluator(fp, tree, knownIds, stagedEvaluatorPaths));
    }

    let suiteFiles: string[];
    try {
      suiteFiles = (await readdir(tree.suitesDir))
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(tree.suitesDir, f));
    } catch {
      suiteFiles = [];
    }

    for (const fp of suiteFiles) {
      allResults.push(await validateSuite(fp, evaluatorIdsByFilestem));
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
    console.log(`\n  All skills files are valid.\n`);
  }
}

main().catch((e) => {
  console.error("validate-skills crashed:", e);
  process.exit(1);
});
