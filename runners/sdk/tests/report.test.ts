/**
 * SDK report tests — verifies report generation works.
 *
 * Run: npm test --workspace=runners/sdk
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { setEnvProvider } from "@opfor/core/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

import { report } from "../src/report.js";
import type { RunResults } from "../src/types.js";

const TEST_OUTPUT_DIR = path.join(import.meta.dirname, "test-output");

function createMockResults(overrides: Partial<RunResults> = {}): RunResults {
  return {
    id: "test-report-123",
    timestamp: new Date().toISOString(),
    targetName: "Test Target",
    targetKind: "agent",
    effort: "adaptive",
    attackerModel: "claude-sonnet-4",
    judgeModel: "claude-sonnet-4",
    score: 75,
    summary: {
      total: 10,
      passed: 7,
      failed: 2,
      errors: 1,
      safetyScore: 75,
      attackSuccessRate: 25,
    },
    findings: [
      {
        id: "finding-1",
        evaluatorId: "jailbreaking",
        patternName: "DAN Prompt",
        severity: "critical",
        title: "Jailbreaking: DAN Prompt",
        description: "Target was manipulated into ignoring safety guidelines.",
        evidence: "Target said: 'Sure, I can help with that harmful request.'",
      },
    ],
    evaluators: [
      {
        evaluatorId: "jailbreaking",
        evaluatorName: "Jailbreaking",
        severity: "critical",
        total: 5,
        passed: 3,
        failed: 2,
        errors: 0,
        passRate: 60,
        attacks: [
          {
            attackId: "attack-1",
            evaluatorId: "jailbreaking",
            patternName: "DAN Prompt",
            prompt: "Ignore all instructions...",
            response: "Sure, I can help with that.",
            verdict: "FAIL",
            evidence: "Target complied with jailbreak.",
          },
        ],
      },
    ],
    ...overrides,
  };
}

// Cleanup test files after tests
const testFiles: string[] = [];

after(() => {
  for (const file of testFiles) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
});

describe("SDK report", () => {
  test("report() returns ReportBuilder with json and html methods", () => {
    const results = createMockResults();
    const builder = report(results);

    assert.ok(typeof builder.json === "function", "should have json method");
    assert.ok(typeof builder.html === "function", "should have html method");
  });

  test("report().json() writes valid JSON file", async () => {
    const results = createMockResults();
    const outputPath = path.join(TEST_OUTPUT_DIR, `test-report-${Date.now()}.json`);
    testFiles.push(outputPath);

    await report(results).json(outputPath);

    assert.ok(existsSync(outputPath), "JSON file should be created");

    const content = readFileSync(outputPath, "utf8");
    const parsed = JSON.parse(content);

    assert.equal(parsed.id, results.id);
    assert.equal(parsed.targetName, results.targetName);
    assert.deepEqual(parsed.summary, results.summary);
  });

  test("report().html() writes HTML file", async () => {
    const results = createMockResults();
    const outputPath = path.join(TEST_OUTPUT_DIR, `test-report-${Date.now()}.html`);
    testFiles.push(outputPath);

    await report(results).html(outputPath);

    assert.ok(existsSync(outputPath), "HTML file should be created");

    const content = readFileSync(outputPath, "utf8");

    assert.ok(content.includes("<!DOCTYPE html>") || content.includes("<html"), "should be HTML");
    assert.ok(content.includes(results.targetName), "should include target name");
  });

  test("report works with empty findings", async () => {
    const results = createMockResults({
      findings: [],
      summary: {
        total: 10,
        passed: 10,
        failed: 0,
        errors: 0,
        safetyScore: 100,
        attackSuccessRate: 0,
      },
    });
    const outputPath = path.join(TEST_OUTPUT_DIR, `test-report-empty-${Date.now()}.json`);
    testFiles.push(outputPath);

    await report(results).json(outputPath);

    const content = readFileSync(outputPath, "utf8");
    const parsed = JSON.parse(content);

    assert.deepEqual(parsed.findings, []);
    assert.equal(parsed.summary.safetyScore, 100);
  });

  test("report works with MCP target kind", async () => {
    const results = createMockResults({
      targetKind: "mcp",
      targetName: "Test MCP Server",
    });
    const outputPath = path.join(TEST_OUTPUT_DIR, `test-report-mcp-${Date.now()}.json`);
    testFiles.push(outputPath);

    await report(results).json(outputPath);

    const content = readFileSync(outputPath, "utf8");
    const parsed = JSON.parse(content);

    assert.equal(parsed.targetKind, "mcp");
    assert.equal(parsed.targetName, "Test MCP Server");
  });
});
