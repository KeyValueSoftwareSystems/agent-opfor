/**
 * Ensures every evaluator markdown file loads the same way the engine does
 * (parseEvaluator), including non-empty patterns for agent and MCP trees.
 *
 * Run: npm test --workspace=core
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEvaluatorsDir } from "../src/config/evaluatorsLayout.js";
import { parseEvaluator } from "../src/evaluators/parseEvaluator.js";

async function assertAllEvaluatorsParse(
  evaluatorsDir: string,
  targetKind: "agent" | "mcp"
): Promise<void> {
  const files = (await readdir(evaluatorsDir)).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 0, `expected evaluators under ${evaluatorsDir}`);

  for (const f of files) {
    const mdPath = path.join(evaluatorsDir, f);
    const spec = await parseEvaluator(mdPath);
    assert.equal(spec.id, f.replace(/\.md$/i, ""), `${f}: parsed id should match filename stem`);
    assert.ok(spec.patterns.length > 0, `${f}: must have non-empty patterns (engine requirement)`);
    for (const p of spec.patterns) {
      assert.ok(p.name.length > 0, `${f}: pattern name required`);
      assert.ok(p.template.length > 0, `${f}: pattern template required`);
    }
    void targetKind; // reserved for divergent rules later
  }
}

test("agent evaluators parse via parseEvaluator", async () => {
  await assertAllEvaluatorsParse(getEvaluatorsDir("agent"), "agent");
});

test("mcp evaluators parse via parseEvaluator", async () => {
  await assertAllEvaluatorsParse(getEvaluatorsDir("mcp"), "mcp");
});
