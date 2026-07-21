#!/usr/bin/env node
/**
 * Bundles evaluator + suite metadata from repo-root `evaluators/agent` +
 * `suites/agent` into `runners/extension/catalog.json` for the MV3 extension
 * (no filesystem access at runtime).
 *
 * Run from repo root: node runners/extension/scripts/build-catalog.mjs
 *
 * Parsing + standard-suite derivation are shared with the skills generator via
 * scripts/lib/catalog-core.mjs so the two can't drift. The extension keeps only
 * its own differences here:
 *   - it DROPS pattern-less evaluators (the browser can't run source-scan
 *     evaluators — they read code, not the live chat), and
 *   - it emits a minimal evaluator shape (no whitebox / MCP fields).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAllEvaluators,
  parseAllSuites,
  deriveStandardSuites,
  warnDanglingSuiteRefs,
} from "../../../scripts/lib/catalog-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EVALUATORS_DIR = path.join(REPO_ROOT, "evaluators/agent");
const SUITES_DIR = path.join(REPO_ROOT, "suites/agent");
const OUT = path.join(REPO_ROOT, "runners/extension/catalog.json");

/** The extension can only run evaluators that send a prompt to the chat UI. */
function isRunnableInBrowser(e) {
  return e.patterns.length > 0 || e.strategy === "mcp-scanner";
}

/** Minimal evaluator shape the extension consumes (stable key order). */
function toExtensionEvaluator(e) {
  const out = {
    id: e.id,
    name: e.name,
    severity: e.severity,
    description: e.description,
    passCriteria: e.passCriteria,
    failCriteria: e.failCriteria,
    patterns: e.patterns.map((p) => {
      const pat = { name: p.name, template: p.template };
      if (p.judgeHint) pat.judgeHint = p.judgeHint;
      return pat;
    }),
  };
  if (e.standards) out.standards = e.standards;
  if (e.judgeHint) out.judgeHint = e.judgeHint;
  if (e.strategy) out.strategy = e.strategy;
  if (e.turnMode) out.turnMode = e.turnMode;
  return out;
}

async function main() {
  console.log("[build-catalog] Starting catalog generation...");
  console.log(`[build-catalog] Evaluators dir: ${EVALUATORS_DIR}`);
  console.log(`[build-catalog] Suites dir: ${SUITES_DIR}`);

  const allEvaluators = await parseAllEvaluators(EVALUATORS_DIR);
  const evaluators = allEvaluators.filter(isRunnableInBrowser);
  const dropped = allEvaluators.length - evaluators.length;
  console.log(
    `[build-catalog] ${evaluators.length} runnable evaluators (${dropped} pattern-less dropped)`
  );

  const suites = await parseAllSuites(SUITES_DIR);
  const derivedSuites = deriveStandardSuites(evaluators);
  suites.push(...derivedSuites);
  console.log(`[build-catalog] Derived ${derivedSuites.length} standard suites`);
  suites.sort((a, b) => a.id.localeCompare(b.id));

  warnDanglingSuiteRefs(suites, evaluators);

  const payload = {
    version: 1,
    source: "evaluators/agent",
    suites,
    evaluators: evaluators.map(toExtensionEvaluator),
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `[build-catalog] Wrote ${OUT} (${suites.length} suites, ${evaluators.length} evaluators)`
  );

  const totalPatterns = evaluators.reduce((sum, e) => sum + e.patterns.length, 0);
  console.log(`[build-catalog] ${totalPatterns} total patterns`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
