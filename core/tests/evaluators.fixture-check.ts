/**
 * Verify every evaluator has a companion *.test.yaml fixture.
 *
 * This is a fast, no-LLM check that runs in CI on every PR to enforce the
 * convention that evaluator contributions include test fixtures.
 *
 * Run:
 *   node --import tsx/esm core/tests/evaluators.fixture-check.ts
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { discoverEvaluatorFiles } from "../src/catalog/discoverEvaluators.js";
import type { EvaluatorCategory } from "../src/config/evaluatorsLayout.js";

async function findTestYaml(dirPath: string, _evalBaseName: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return false;
  }
  return entries.some((e) => /\.test\.ya?ml$/i.test(e));
}

async function checkCategory(category: EvaluatorCategory): Promise<string[]> {
  const evaluators = await discoverEvaluatorFiles(category);
  const missing: string[] = [];

  for (const ev of evaluators) {
    // source-analysis evaluators are skill-driven static checks with no judge
    // fixtures — skip them.
    if (ev.filePath.split(path.sep).includes("source-analysis")) continue;

    const baseName = ev.isDirectoryForm
      ? path.basename(ev.dirPath)
      : path.basename(ev.filePath).replace(/\.ya?ml$/i, "");

    const hasFixture = await findTestYaml(ev.dirPath, baseName);
    if (!hasFixture) {
      const rel = path.relative(process.cwd(), ev.filePath);
      missing.push(rel);
    }
  }

  return missing;
}

async function main(): Promise<void> {
  const agentMissing = await checkCategory("agent");
  const mcpMissing = await checkCategory("mcp");
  const allMissing = [...agentMissing, ...mcpMissing];

  if (allMissing.length === 0) {
    console.log("All evaluators have companion .test.yaml fixtures.");
    process.exit(0);
  }

  console.error(`${allMissing.length} evaluator(s) missing a .test.yaml fixture:\n`);
  for (const m of allMissing) {
    console.error(`  - ${m}`);
  }
  console.error(
    "\nEvery evaluator must include a .test.yaml file with pass_case and fail_case entries."
  );
  console.error("See evaluators/agent/injection/prompt-injection/prompt-injection.test.yaml");
  process.exit(1);
}

main();
