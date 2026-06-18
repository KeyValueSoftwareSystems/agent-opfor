/**
 * Build skill catalogs from the evaluator/suite tree.
 *
 * Walks evaluators/ and suites/, normalizes both folder-based and flat-file
 * evaluators into a uniform shape, and writes:
 *   skills/mcp-redteaming/opfor-setup/catalog.json
 *   skills/agent-redteaming/opfor-setup/catalog.json
 *
 * Usage:
 *   npm run build:catalog            # write catalogs
 *   npm run build:catalog -- --check # exit 1 if catalogs are stale
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

type Surface = "agent" | "mcp";

interface Pattern {
  name: string;
  template: string;
}

interface EvaluatorEntry {
  id: string;
  name: string;
  severity: string;
  description: string;
  standards?: Record<string, string>;
  pass_criteria: string;
  fail_criteria: string;
  patterns: Pattern[];
  scan_mode?: string;
  surface?: string;
  correlates_with?: string;
  source_scan?: Record<string, unknown>;
  judge_needs_llm?: boolean;
  applies_to_all_tools?: boolean;
  judge_instructions?: string;
  mcp_top_10?: string;
  /** Relative path from repo root to the evaluator file */
  _source: string;
}

interface SuiteEntry {
  id: string;
  name: string;
  description: string;
  evaluators: string[];
  _source: string;
}

interface Catalog {
  generated_at: string;
  surface: Surface;
  evaluators: EvaluatorEntry[];
  suites: SuiteEntry[];
}

async function isDirectory(p: string): Promise<boolean> {
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
      if (await isDirectory(full)) {
        await recurse(full);
      } else if (entry.endsWith(".yaml") && !entry.endsWith(".test.yaml")) {
        results.push(full);
      }
    }
  }

  await recurse(dir);
  return results;
}

async function loadPatterns(patternsDir: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  let files: string[];
  try {
    files = (await readdir(patternsDir)).filter((f) => f.endsWith(".yaml")).sort();
  } catch {
    return patterns;
  }

  for (const file of files) {
    const content = await readFile(path.join(patternsDir, file), "utf8");
    const parsed = parseYaml(content) as { name?: string; template?: string };
    if (parsed?.name && parsed?.template) {
      patterns.push({ name: parsed.name, template: parsed.template });
    }
  }
  return patterns;
}

async function loadEvaluators(surface: Surface): Promise<EvaluatorEntry[]> {
  const evaluatorsDir = path.join(REPO_ROOT, "evaluators", surface);
  const allYaml = await walkYamlFiles(evaluatorsDir);
  const seen = new Map<string, EvaluatorEntry>();

  for (const filePath of allYaml) {
    const rel = path.relative(evaluatorsDir, filePath);
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);

    // Skip pattern files (they're loaded by their parent evaluator)
    if (rel.includes("/patterns/")) continue;

    const content = await readFile(filePath, "utf8");
    const parsed = parseYaml(content) as Record<string, unknown>;

    if (!parsed?.id || !parsed?.name) {
      console.warn(`  ⚠ Skipping ${rel}: missing id or name`);
      continue;
    }

    let patterns: Pattern[] = [];

    if (fileName === "evaluator.yaml") {
      // Folder-based evaluator: load patterns from sibling patterns/ dir
      const patternsDir = path.join(dirName, "patterns");
      patterns = await loadPatterns(patternsDir);
    } else if (Array.isArray(parsed.patterns)) {
      // Flat-file evaluator with inline patterns
      patterns = (parsed.patterns as Array<{ name?: string; template?: string }>)
        .filter((p) => p?.name && p?.template)
        .map((p) => ({ name: p.name!, template: p.template! }));
    }

    const entry: EvaluatorEntry = {
      id: parsed.id as string,
      name: parsed.name as string,
      severity: (parsed.severity as string) ?? "medium",
      description: (parsed.description as string) ?? "",
      standards: parsed.standards as Record<string, string> | undefined,
      pass_criteria: (parsed.pass_criteria as string) ?? "",
      fail_criteria: (parsed.fail_criteria as string) ?? "",
      patterns,
      _source: path.relative(REPO_ROOT, filePath),
    };

    if (parsed.scan_mode) entry.scan_mode = parsed.scan_mode as string;
    if (parsed.surface) entry.surface = parsed.surface as string;
    if (parsed.correlates_with) entry.correlates_with = parsed.correlates_with as string;
    if (parsed.source_scan) entry.source_scan = parsed.source_scan as Record<string, unknown>;
    if (parsed.judge_needs_llm !== undefined)
      entry.judge_needs_llm = parsed.judge_needs_llm as boolean;
    if (parsed.applies_to_all_tools !== undefined)
      entry.applies_to_all_tools = parsed.applies_to_all_tools as boolean;
    if (parsed.judge_instructions) entry.judge_instructions = parsed.judge_instructions as string;
    if (parsed.mcp_top_10) entry.mcp_top_10 = parsed.mcp_top_10 as string;

    if (seen.has(entry.id)) {
      console.warn(
        `  ⚠ Duplicate evaluator id "${entry.id}" in ${rel} (already seen in ${seen.get(entry.id)!._source})`
      );
    }
    seen.set(entry.id, entry);
  }

  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function loadSuites(): Promise<SuiteEntry[]> {
  const suitesDir = path.join(REPO_ROOT, "suites");
  const suites: SuiteEntry[] = [];
  let files: string[];
  try {
    files = (await readdir(suitesDir)).filter((f) => f.endsWith(".yaml")).sort();
  } catch {
    return suites;
  }

  for (const file of files) {
    const filePath = path.join(suitesDir, file);
    const content = await readFile(filePath, "utf8");
    const parsed = parseYaml(content) as Record<string, unknown>;

    if (!parsed?.id || !parsed?.evaluators) continue;

    suites.push({
      id: parsed.id as string,
      name: (parsed.name as string) ?? (parsed.id as string),
      description: (parsed.description as string) ?? "",
      evaluators: parsed.evaluators as string[],
      _source: path.relative(REPO_ROOT, filePath),
    });
  }

  return suites;
}

function catalogPath(surface: Surface): string {
  const skillName = surface === "mcp" ? "mcp-redteaming" : "agent-redteaming";
  return path.join(REPO_ROOT, "skills", skillName, "opfor-setup", "catalog.json");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function main(): Promise<void> {
  console.log(CHECK_ONLY ? "Checking skill catalogs…" : "Building skill catalogs…");

  const suites = await loadSuites();
  const stale: string[] = [];

  for (const surface of ["mcp", "agent"] as Surface[]) {
    const evaluators = await loadEvaluators(surface);

    const catalog: Catalog = {
      generated_at: new Date().toISOString(),
      surface,
      evaluators,
      suites,
    };

    // Deterministic JSON (exclude generated_at from hash comparison)
    const catalogForHash: Omit<Catalog, "generated_at"> = {
      surface: catalog.surface,
      evaluators: catalog.evaluators,
      suites: catalog.suites,
    };
    const json = JSON.stringify(catalog, null, 2) + "\n";
    const hashJson = JSON.stringify(catalogForHash, null, 2);

    const outPath = catalogPath(surface);

    if (CHECK_ONLY) {
      try {
        const existing = await readFile(outPath, "utf8");
        const existingParsed = JSON.parse(existing) as Catalog;
        const existingForHash: Omit<Catalog, "generated_at"> = {
          surface: existingParsed.surface,
          evaluators: existingParsed.evaluators,
          suites: existingParsed.suites,
        };
        if (hashContent(JSON.stringify(existingForHash, null, 2)) !== hashContent(hashJson)) {
          stale.push(path.relative(REPO_ROOT, outPath));
        }
      } catch {
        stale.push(path.relative(REPO_ROOT, outPath));
      }
    } else {
      await writeFile(outPath, json, "utf8");
      console.log(
        `  ${surface}: ${evaluators.length} evaluators, ${suites.length} suites → ${path.relative(REPO_ROOT, outPath)}`
      );
    }
  }

  if (CHECK_ONLY) {
    if (stale.length > 0) {
      console.error("\n✗ Skill catalogs are out of date. Run:\n\n  npm run build:catalog\n");
      for (const p of stale) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("\n✓ All skill catalogs are up to date.\n");
    return;
  }

  console.log("\n✓ Done. Catalogs written.\n");
}

main().catch((e) => {
  console.error("build-catalog failed:", e);
  process.exit(1);
});
