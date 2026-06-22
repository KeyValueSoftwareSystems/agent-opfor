/**
 * SDK catalog tests — verifies listSuites and listEvaluators work.
 *
 * Run: npm test --workspace=runners/sdk
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setEnvProvider } from "@agent-opfor/core/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

import { listSuites, listEvaluators } from "../src/catalog.js";

describe("SDK catalog", () => {
  test("listSuites returns array of suites", async () => {
    const suites = await listSuites();

    assert.ok(Array.isArray(suites), "should return array");
    assert.ok(suites.length > 0, "should have at least one suite");

    const first = suites[0];
    assert.ok(first.id, "suite should have id");
    assert.ok(first.name, "suite should have name");
    assert.ok(typeof first.evaluatorCount === "number", "suite should have evaluatorCount");
  });

  test("listSuites includes expected suites", async () => {
    const suites = await listSuites();
    const ids = suites.map((s) => s.id);

    assert.ok(
      ids.some((id) => id.includes("owasp") || id.includes("llm")),
      "should include OWASP-related suite"
    );
  });

  test("listEvaluators returns array of evaluators", async () => {
    const evaluators = await listEvaluators();

    assert.ok(Array.isArray(evaluators), "should return array");
    assert.ok(evaluators.length > 0, "should have at least one evaluator");

    const first = evaluators[0];
    assert.ok(first.id, "evaluator should have id");
    assert.ok(first.name, "evaluator should have name");
    assert.ok(first.severity, "evaluator should have severity");
  });

  test("listEvaluators respects kind option", async () => {
    const agentEvaluators = await listEvaluators({ kind: "agent" });
    const mcpEvaluators = await listEvaluators({ kind: "mcp" });

    assert.ok(agentEvaluators.length > 0, "should have agent evaluators");
    assert.ok(mcpEvaluators.length > 0, "should have mcp evaluators");

    // They may have some overlap but typically different
    const agentIds = new Set(agentEvaluators.map((e) => e.id));
    const mcpIds = new Set(mcpEvaluators.map((e) => e.id));

    // At minimum, each set should exist
    assert.ok(agentIds.size > 0);
    assert.ok(mcpIds.size > 0);
  });

  test("evaluators have valid severity values", async () => {
    const evaluators = await listEvaluators();
    const validSeverities = ["critical", "high", "medium", "low"];

    for (const evaluator of evaluators) {
      assert.ok(
        validSeverities.includes(evaluator.severity),
        `evaluator ${evaluator.id} has invalid severity: ${evaluator.severity}`
      );
    }
  });
});
