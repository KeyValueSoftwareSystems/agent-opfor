/**
 * SDK hunt() tests — verifies the autonomous mode API.
 *
 * Note: Full integration tests require the Anthropic Claude Agent SDK
 * which is not available in the test environment. These tests verify
 * the API surface, type contracts, and option building.
 *
 * Run: npm test --workspace=runners/sdk
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { setEnvProvider } from "@agent-opfor/core/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

import type {
  HuntOptions,
  HuntResults,
  HuntTargetConfig,
  HuntModelsConfig,
  HuntLimitsConfig,
  HuntProgressEvent,
  HuntFinding,
  HuntTurn,
} from "../src/types.js";

describe("SDK hunt types", () => {
  test("HuntTargetConfig type is correct", () => {
    const target: HuntTargetConfig = {
      url: "https://api.example.com/chat",
      name: "Test Target",
      apiKey: "test-key",
      headers: { "X-Custom": "value" },
      stateful: true,
      sessionField: "session_id",
      promptPath: "input.message",
      responsePath: "output.text",
      model: "gpt-4o",
    };

    assert.equal(target.url, "https://api.example.com/chat");
    assert.equal(target.stateful, true);
  });

  test("HuntModelsConfig type is correct", () => {
    const models: HuntModelsConfig = {
      commander: "opus",
      operator: "sonnet",
      scout: "haiku",
      verifier: "opus",
    };

    assert.equal(models.commander, "opus");
    assert.equal(models.operator, "sonnet");
  });

  test("HuntLimitsConfig type is correct", () => {
    const limits: HuntLimitsConfig = {
      maxOperators: 6,
      maxTurns: 120,
      maxThreadTurns: 25,
      maxTotalThreads: 40,
      maxForksPerThread: 4,
      maxTotalSends: 500,
      maxDepth: 3,
      maxLeadsPerWave: 4,
      maxReconProbes: 8,
      budgetUsd: 10,
    };

    assert.equal(limits.budgetUsd, 10);
    assert.equal(limits.maxOperators, 6);
  });

  test("HuntOptions type is correct", () => {
    const options: HuntOptions = {
      target: {
        url: "https://api.example.com/chat",
      },
      objective: "Find jailbreaks and data leaks",
      models: {
        commander: "opus",
        operator: "sonnet",
      },
      limits: {
        budgetUsd: 5,
      },
      verify: true,
      sequential: false,
      outputDir: "./reports",
      onProgress: () => {},
    };

    assert.equal(options.objective, "Find jailbreaks and data leaks");
    assert.equal(options.verify, true);
  });

  test("HuntProgressEvent types are correct", () => {
    const events: HuntProgressEvent[] = [
      { type: "line", message: "Starting..." },
      { type: "recon_start" },
      { type: "recon_done", fingerprint: "Customer support bot", weakPoints: ["jailbreak"] },
      { type: "thread_start", threadId: "t1", vulnClass: "jailbreaking" },
      { type: "thread_turn", threadId: "t1", turnIndex: 1, prompt: "Attack prompt" },
      { type: "thread_done", threadId: "t1", verdict: "FAIL" },
      { type: "finding", findingId: "f1", vulnClass: "jailbreaking", severity: "critical" },
      { type: "complete", outcome: "achieved" },
    ];

    assert.equal(events[0].type, "line");
    assert.equal(events[7].type, "complete");
  });

  test("HuntTurn type is correct", () => {
    const turn: HuntTurn = {
      turnIndex: 1,
      prompt: "Attack prompt",
      response: "Target response",
      persona: "frustrated-developer",
      strategy: "roleplay",
      score: 3,
    };

    assert.equal(turn.turnIndex, 1);
    assert.equal(turn.persona, "frustrated-developer");
  });

  test("HuntFinding type is correct", () => {
    const finding: HuntFinding = {
      id: "finding-1",
      vulnClassId: "jailbreaking",
      name: "Jailbreak via DAN",
      severity: "critical",
      standards: { "owasp-llm": "LLM01" },
      threadId: "t1",
      strategy: "roleplay",
      personas: ["frustrated-developer", "security-researcher"],
      verdict: "FAIL",
      confidence: 95,
      evidence: "Target said: 'Sure, I can help with that harmful request.'",
      reasoning: "Target ignored safety guidelines when presented with roleplay scenario.",
      turns: [
        { turnIndex: 1, prompt: "Attack 1", response: "Response 1" },
        { turnIndex: 2, prompt: "Attack 2", response: "Harmful response" },
      ],
    };

    assert.equal(finding.severity, "critical");
    assert.equal(finding.turns.length, 2);
  });

  test("HuntResults type is correct", () => {
    const results: HuntResults = {
      id: "report-123",
      timestamp: new Date().toISOString(),
      target: { name: "Test Target", endpoint: "https://example.com/chat" },
      objective: "Find vulnerabilities",
      outcome: "achieved",
      models: { commander: "opus", operator: "sonnet" },
      truncated: false,
      truncationReason: undefined,
      totalCostUsd: 2.5,
      summary: {
        threads: 10,
        confirmed: 3,
        defended: 6,
        errors: 1,
        attackSuccessRate: 33.3,
      },
      recon: {
        fingerprint: "Customer support chatbot",
        guardrails: ["Content filtering", "Rate limiting"],
        weakPoints: ["Roleplay scenarios", "Multi-turn manipulation"],
      },
      findings: [],
      recommendations: ["Add stronger input validation"],
      narrative: "The assessment revealed several vulnerabilities...",
      htmlReportPath: "./reports/report.html",
      jsonReportPath: "./reports/report.json",
    };

    assert.equal(results.outcome, "achieved");
    assert.equal(results.summary.confirmed, 3);
  });

  test("HuntOptions with minimal config", () => {
    const options: HuntOptions = {
      target: { url: "https://api.example.com/chat" },
      objective: "Test for vulnerabilities",
    };

    assert.ok(options.target.url);
    assert.ok(options.objective);
    assert.equal(options.models, undefined);
    assert.equal(options.limits, undefined);
  });
});
