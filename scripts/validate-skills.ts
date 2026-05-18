/**
 * Validate all evaluator and suite markdown files under skills/.
 *
 * Rules are enforced identically for both agent-redteaming and mcp-redteaming:
 *   - Evaluators: id, name, severity, pass_criteria, fail_criteria are required.
 *     patterns is required and non-empty for agent evaluators; optional for MCP
 *     evaluators (some are scanner-only and have no attack patterns).
 *   - Suites: id, evaluators[] are required. Every evaluator ID in the list
 *     must resolve to an actual .md file in the corresponding evaluators/ directory.
 *
 * owasp and description are optional but warned when absent.
 *
 * Exit 0 — all files valid (warnings may still be printed).
 * Exit 1 — one or more hard errors found.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ─── Paths ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

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

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const PatternSchema = z.object({
  name: z.string().min(1, "pattern.name must be a non-empty string"),
  template: z.string().min(1, "pattern.template must be a non-empty string"),
});

/** Base evaluator schema — fields required the same for both agent and MCP. */
const BaseEvaluatorSchema = z.object({
  id: z.string().min(1, "id must be a non-empty string"),
  name: z.string().min(1, "name must be a non-empty string"),
  severity: z.enum(["critical", "high", "medium", "low"], {
    errorMap: () => ({
      message: 'severity must be one of: "critical" | "high" | "medium" | "low"',
    }),
  }),
  pass_criteria: z.string().min(1, "pass_criteria must be a non-empty string"),
  fail_criteria: z.string().min(1, "fail_criteria must be a non-empty string"),
  // optional — warn only
  ref: z.string().optional(),
  description: z.string().optional(),
});

/** Agent evaluator — patterns required and non-empty. */
const AgentEvaluatorSchema = BaseEvaluatorSchema.extend({
  patterns: z.array(PatternSchema).min(1, "patterns must be a non-empty array"),
});

/** MCP evaluator — patterns optional (scanner-only evaluators have none). */
const McpEvaluatorSchema = BaseEvaluatorSchema.extend({
  patterns: z.array(PatternSchema).optional(),
});

const SuiteSchema = z.object({
  id: z.string().min(1, "id must be a non-empty string"),
  evaluators: z.array(z.string().min(1)).min(1, "evaluators must be a non-empty array of strings"),
  // optional — no hard requirement
  name: z.string().optional(),
  description: z.string().optional(),
});

// ─── Frontmatter splitter ────────────────────────────────────────────────────

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

// ─── Result types ─────────────────────────────────────────────────────────────

interface FileResult {
  file: string;
  errors: string[];
  warnings: string[];
}

// ─── Validate one evaluator file ─────────────────────────────────────────────

async function validateEvaluator(
  filePath: string,
  requirePatterns: boolean,
  knownIds: Map<string, string>
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

  const schema = requirePatterns ? AgentEvaluatorSchema : McpEvaluatorSchema;
  const result = schema.safeParse(doc);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      errors.push(`${field ? field + ": " : ""}${issue.message}`);
    }
  }

  // Warn on missing optional-but-recommended fields
  const d = doc as Record<string, unknown>;
  if (!d?.ref || (typeof d.ref === "string" && !d.ref.trim())) {
    warnings.push(
      'ref is empty (recommended — set to e.g. "LLM01", "MCP05", "ASI02", "AML.T0054")'
    );
  }
  if (!d?.description || (typeof d.description === "string" && !d.description.trim())) {
    warnings.push("description is empty (recommended for contributor docs)");
  }

  // Duplicate ID check
  if (result.success && result.data.id) {
    const id = result.data.id;
    if (knownIds.has(id)) {
      errors.push(`duplicate id "${id}" — also used in ${knownIds.get(id)}`);
    } else {
      knownIds.set(id, relPath);
    }
  }

  return { file: relPath, errors, warnings };
}

// ─── Validate one suite file ──────────────────────────────────────────────────

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

  const result = SuiteSchema.safeParse(doc);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join(".");
      errors.push(`${field ? field + ": " : ""}${issue.message}`);
    }
  }

  // Check every evaluator ID resolves to an actual file
  if (result.success) {
    for (const evId of result.data.evaluators) {
      if (!evaluatorFiles.has(evId)) {
        errors.push(`evaluators[]: "${evId}" does not match any evaluator file in this tree`);
      }
    }

    if (!result.data.name || !result.data.name.trim()) {
      warnings.push("name is empty (recommended for display)");
    }
  }

  return { file: relPath, errors, warnings };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const allResults: FileResult[] = [];

  // Shared ID map across both trees — IDs must be globally unique
  const knownIds = new Map<string, string>();

  for (const tree of SKILL_TREES) {
    // ── Evaluators ──
    let evalFiles: string[];
    try {
      evalFiles = (await readdir(tree.evaluatorsDir))
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(tree.evaluatorsDir, f));
    } catch {
      console.error(`  Could not read evaluators directory: ${tree.evaluatorsDir}`);
      process.exit(1);
    }

    // Build the set of known evaluator IDs in this tree (by filename stem)
    // used for suite reference validation
    const evaluatorIdsByFilestem = new Set(evalFiles.map((f) => path.basename(f, ".md")));

    for (const fp of evalFiles) {
      const result = await validateEvaluator(fp, tree.requirePatterns, knownIds);
      allResults.push(result);
    }

    // ── Suites ──
    let suiteFiles: string[];
    try {
      suiteFiles = (await readdir(tree.suitesDir))
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(tree.suitesDir, f));
    } catch {
      // suites dir may not exist yet — skip silently
      suiteFiles = [];
    }

    for (const fp of suiteFiles) {
      const result = await validateSuite(fp, evaluatorIdsByFilestem);
      allResults.push(result);
    }
  }

  // ── Print results ──
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
