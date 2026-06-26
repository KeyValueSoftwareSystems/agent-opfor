/**
 * SDK Opfor class tests — verifies the class-based API works correctly.
 *
 * Run: npm test --workspace=runners/sdk
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setEnvProvider } from "@keyvaluesystems/agent-opfor-core/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

import { Opfor } from "../src/opfor.js";

describe("Opfor class", () => {
  test("constructor accepts options", () => {
    const opfor = new Opfor({
      apiKey: "test-key",
      attackerModel: "claude-sonnet-4",
      judgeModel: "claude-opus-4",
    });

    assert.ok(opfor, "should create instance");
  });

  test("constructor works without options", () => {
    const opfor = new Opfor();
    assert.ok(opfor, "should create instance with no options");
  });

  test("report method returns ReportBuilder", async () => {
    const opfor = new Opfor();

    const mockResults = {
      id: "test-id",
      timestamp: new Date().toISOString(),
      targetName: "Test",
      targetKind: "agent" as const,
      effort: "adaptive" as const,
      attackerModel: "test",
      judgeModel: "test",
      score: 80,
      summary: {
        total: 10,
        passed: 8,
        failed: 2,
        errors: 0,
        safetyScore: 80,
        attackSuccessRate: 20,
      },
      findings: [],
      evaluators: [],
    };

    const builder = opfor.report(mockResults);

    assert.ok(typeof builder.json === "function", "should have json method");
    assert.ok(typeof builder.html === "function", "should have html method");
  });
});
