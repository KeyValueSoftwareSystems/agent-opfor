/**
 * Ensures every evaluator YAML file loads the same way the engine does
 * (parseYamlEvaluator / loadBuiltinEvaluator), including non-empty patterns
 * for non-source-scan evaluators.
 *
 * Run: npm test --workspace=core
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEvaluatorsDir } from "../src/config/evaluatorsLayout.js";
import { parseYamlEvaluator } from "../src/evaluators/parseEvaluator.js";

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function walkEvaluatorFiles(dir: string): Promise<string[]> {
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

async function assertAllEvaluatorsParse(
  evaluatorsDir: string,
  _targetKind: "agent" | "mcp"
): Promise<void> {
  const files = await walkEvaluatorFiles(evaluatorsDir);
  assert.ok(files.length > 0, `expected evaluators under ${evaluatorsDir}`);

  for (const fp of files) {
    const rel = path.relative(evaluatorsDir, fp);
    const spec = await parseYamlEvaluator(fp);
    assert.ok(spec.id, `${rel}: must have an id`);
    assert.ok(spec.name, `${rel}: must have a name`);

    const isSourceScan = spec.patterns.length === 0;
    if (!isSourceScan) {
      for (const p of spec.patterns) {
        assert.ok(p.name.length > 0, `${rel}: pattern name required`);
        assert.ok(p.template.length > 0, `${rel}: pattern template required`);
      }
    }
  }
}

test("agent evaluators parse via parseYamlEvaluator", async () => {
  await assertAllEvaluatorsParse(getEvaluatorsDir("agent"), "agent");
});

test("mcp evaluators parse via parseYamlEvaluator", async () => {
  await assertAllEvaluatorsParse(getEvaluatorsDir("mcp"), "mcp");
});
