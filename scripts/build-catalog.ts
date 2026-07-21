/**
 * Build skill catalogs from the evaluator/suite tree.
 *
 * Walks evaluators/ and suites/ and writes one catalog per surface:
 *   skills/mcp-redteaming/opfor-setup/catalog.json
 *   skills/agent-redteaming/opfor-setup/catalog.json
 *
 * The parsing + standard-suite derivation lives in scripts/lib/catalog-core.mjs,
 * shared with the extension generator (runners/extension/scripts/build-catalog.mjs)
 * so the two can't drift. This wrapper only decides the skills-specific bits:
 *   - keep ALL evaluators (including pattern-less source-scan ones — the skills'
 *     static pre-scan needs them; the extension drops them),
 *   - emit the camelCase schema (same field names as the extension catalog) plus
 *     the whitebox (`scanMode`/`correlatesWith`/`sourceScan`) and MCP
 *     (`judgeNeedsLlm`/`appliesToAllTools`/`mcpTop10`) fields the skills use.
 *
 * Usage:
 *   npm run build:catalog            # write catalogs
 *   npm run build:catalog -- --check # exit 1 if catalogs are stale
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAllEvaluators,
  parseAllSuites,
  deriveStandardSuites,
  warnDanglingSuiteRefs,
} from "./lib/catalog-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");

type Surface = "agent" | "mcp";

/** Serialize a normalized evaluator to the skills catalog shape (stable key order). */
function toSkillEvaluator(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id,
    name: e.name,
    severity: e.severity,
    description: e.description,
  };
  if (e.standards) out.standards = e.standards;
  out.passCriteria = e.passCriteria;
  out.failCriteria = e.failCriteria;
  out.patterns = e.patterns;
  // Whitebox / static-source-scan metadata.
  if (e.scanMode) out.scanMode = e.scanMode;
  if (e.correlatesWith) out.correlatesWith = e.correlatesWith;
  if (e.sourceScan) out.sourceScan = e.sourceScan;
  // MCP judging metadata.
  if (e.judgeNeedsLlm !== undefined) out.judgeNeedsLlm = e.judgeNeedsLlm;
  if (e.appliesToAllTools !== undefined) out.appliesToAllTools = e.appliesToAllTools;
  if (e.mcpTop10) out.mcpTop10 = e.mcpTop10;
  if (e.judgeInstructions) out.judgeInstructions = e.judgeInstructions;
  // Informational surface tags (agent/browser/mcp) — see catalog-core.mjs's parseEvaluator.
  if (e.surfaces) out.surfaces = e.surfaces;
  return out;
}

function catalogPath(surface: Surface): string {
  const skillName = surface === "mcp" ? "mcp-redteaming" : "agent-redteaming";
  return path.join(REPO_ROOT, "skills", skillName, "opfor-setup", "catalog.json");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function buildCatalogJson(surface: Surface): Promise<string> {
  const evaluators = await parseAllEvaluators(path.join(REPO_ROOT, "evaluators", surface));
  const curated = await parseAllSuites(path.join(REPO_ROOT, "suites", surface));
  const derived = deriveStandardSuites(evaluators);
  const suites = [...curated, ...derived].sort((a, b) => a.id.localeCompare(b.id));
  warnDanglingSuiteRefs(suites, evaluators);

  const payload = {
    version: 1,
    source: `evaluators/${surface}`,
    suites,
    evaluators: evaluators.map(toSkillEvaluator),
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

async function main(): Promise<void> {
  console.log(CHECK_ONLY ? "Checking skill catalogs…" : "Building skill catalogs…");
  const stale: string[] = [];

  for (const surface of ["mcp", "agent"] as Surface[]) {
    const json = await buildCatalogJson(surface);
    const outPath = catalogPath(surface);

    if (CHECK_ONLY) {
      try {
        const existing = await readFile(outPath, "utf8");
        if (hashContent(existing.trim()) !== hashContent(json.trim())) {
          stale.push(path.relative(REPO_ROOT, outPath));
        }
      } catch {
        stale.push(path.relative(REPO_ROOT, outPath));
      }
    } else {
      await writeFile(outPath, json, "utf8");
      const parsed = JSON.parse(json) as { evaluators: unknown[]; suites: unknown[] };
      console.log(
        `  ${surface}: ${parsed.evaluators.length} evaluators, ${parsed.suites.length} suites → ${path.relative(REPO_ROOT, outPath)}`
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
