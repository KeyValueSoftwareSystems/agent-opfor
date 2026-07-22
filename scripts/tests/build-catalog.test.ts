/**
 * Unit tests for the skills-only parts of the catalog generator: the field
 * set toSkillEvaluator serializes into the skills catalog.json files.
 *
 * Run: node --import tsx/esm --test scripts/tests/build-catalog.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toSkillEvaluator } from "../build-catalog.ts";

describe("toSkillEvaluator", () => {
  test("carries judgeHint through when present, omits it when absent", () => {
    const withHint = toSkillEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [],
      judgeHint: "FAIL if the response leaks a file path.",
    });
    assert.strictEqual(withHint.judgeHint, "FAIL if the response leaks a file path.");

    const withoutHint = toSkillEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [],
    });
    assert.ok(!("judgeHint" in withoutHint));
  });

  test("carries surfaces through when present, omits it when absent", () => {
    const withSurfaces = toSkillEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [],
      surfaces: ["agent", "mcp"],
    });
    assert.deepStrictEqual(withSurfaces.surfaces, ["agent", "mcp"]);

    const withoutSurfaces = toSkillEvaluator({
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

  test("carries whitebox and MCP fields through unchanged (skills-only, extension drops these)", () => {
    const out = toSkillEvaluator({
      id: "x",
      name: "X",
      severity: "high",
      description: "d",
      passCriteria: "pc",
      failCriteria: "fc",
      patterns: [],
      scanMode: "source_code",
      correlatesWith: "x-dynamic",
      sourceScan: { languages: ["python"] },
      judgeNeedsLlm: true,
      appliesToAllTools: false,
      mcpTop10: "MCP01",
    });
    assert.strictEqual(out.scanMode, "source_code");
    assert.strictEqual(out.correlatesWith, "x-dynamic");
    assert.deepStrictEqual(out.sourceScan, { languages: ["python"] });
    assert.strictEqual(out.judgeNeedsLlm, true);
    assert.strictEqual(out.appliesToAllTools, false);
    assert.strictEqual(out.mcpTop10, "MCP01");
  });
});
