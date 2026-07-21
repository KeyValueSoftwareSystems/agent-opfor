/**
 * Unit tests for the extension-only parts of the catalog generator: which
 * evaluators the browser can run, and the minimal shape it serializes.
 *
 * Run: node --test runners/extension/scripts/*.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isRunnableInBrowser, toExtensionEvaluator } from "./build-catalog.mjs";

describe("isRunnableInBrowser", () => {
  test("an evaluator with patterns is runnable", () => {
    assert.strictEqual(isRunnableInBrowser({ patterns: [{ name: "p", template: "t" }] }), true);
  });

  test("a pattern-less evaluator is not runnable", () => {
    assert.strictEqual(isRunnableInBrowser({ patterns: [] }), false);
  });

  test("a pattern-less mcp-scanner evaluator is still runnable", () => {
    assert.strictEqual(isRunnableInBrowser({ patterns: [], strategy: "mcp-scanner" }), true);
  });
});

describe("toExtensionEvaluator", () => {
  test("emits only the minimal fields, dropping whitebox/MCP-only ones", () => {
    const out = toExtensionEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [{ name: "p", template: "t" }],
      scanMode: "source_code",
      correlatesWith: "x-dynamic",
      sourceScan: { languages: ["python"] },
      judgeNeedsLlm: true,
      mcpTop10: "MCP01",
    });

    for (const whiteboxOrMcpField of [
      "scanMode",
      "correlatesWith",
      "sourceScan",
      "judgeNeedsLlm",
      "mcpTop10",
    ]) {
      assert.ok(
        !(whiteboxOrMcpField in out),
        `${whiteboxOrMcpField} should not reach the extension`
      );
    }
    assert.strictEqual(out.id, "x");
    assert.strictEqual(out.passCriteria, "pc");
  });

  test("carries surfaces through when present, omits it when absent", () => {
    const withSurfaces = toExtensionEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [],
      surfaces: ["agent", "browser"],
    });
    assert.deepStrictEqual(withSurfaces.surfaces, ["agent", "browser"]);

    const withoutSurfaces = toExtensionEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [],
    });
    assert.ok(!("surfaces" in withoutSurfaces));
  });
});
