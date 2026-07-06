/**
 * SDK types tests — verifies type exports and type guards work correctly.
 *
 * Run: npm test --workspace=runners/sdk
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type {
  RunOptions,
  RunResults,
  RunListener,
  HttpTargetConfig,
  LocalScriptTargetConfig,
  McpTargetConfig,
  ModelSpec,
  ModelConfig,
  Finding,
  AttackResult,
  EvaluatorResult,
  OpforOptions,
  StrategyConfig,
  SuiteInfo,
  EvaluatorInfo,
  ProgressEvent,
} from "../src/types.js";

describe("SDK types", () => {
  test("HttpTargetConfig type is correct", () => {
    const target: HttpTargetConfig = {
      url: "https://api.example.com/chat",
      name: "Test",
      description: "Test target",
      apiKey: "test-target-key",
      model: "gpt-4o",
      headers: { "X-Custom": "value" },
      requestFormat: "openai",
      promptPath: "input.message",
      responsePath: "output.text",
      stateful: true,
      sessionField: "session_id",
    };

    assert.equal(target.url, "https://api.example.com/chat");
    assert.equal(target.requestFormat, "openai");
  });

  test("LocalScriptTargetConfig type is correct", () => {
    const target: LocalScriptTargetConfig = {
      type: "local-script",
      name: "Local Agent",
      description: "Test",
      scriptPath: "./agent.js",
    };

    assert.equal(target.type, "local-script");
    assert.equal(target.scriptPath, "./agent.js");
  });

  test("McpTargetConfig stdio type is correct", () => {
    const target: McpTargetConfig = {
      kind: "mcp",
      name: "MCP Server",
      transport: "stdio",
      command: "node",
      args: ["./server.js"],
      cwd: "/path/to/dir",
      env: { DEBUG: "true" },
    };

    assert.equal(target.kind, "mcp");
    assert.equal(target.transport, "stdio");
  });

  test("McpTargetConfig url type is correct", () => {
    const target: McpTargetConfig = {
      kind: "mcp",
      name: "MCP Server",
      transport: "url",
      url: "http://localhost:3000/mcp",
      urlHeaders: { Authorization: "Bearer token" },
    };

    assert.equal(target.transport, "url");
    assert.equal(target.url, "http://localhost:3000/mcp");
  });

  test("ModelSpec string shorthand works", () => {
    const model: ModelSpec = "claude-sonnet-4";
    assert.equal(model, "claude-sonnet-4");
  });

  test("ModelSpec full config works", () => {
    const model: ModelSpec = {
      provider: "anthropic",
      model: "claude-sonnet-4",
      apiKey: "test-api-key",
      baseUrl: "https://custom.api.com",
    };

    assert.equal((model as ModelConfig).provider, "anthropic");
  });

  test("StrategyConfig type is correct", () => {
    const strategy: StrategyConfig = {
      effort: "adaptive",
      turns: 3,
      turnMode: "multi",
    };

    assert.equal(strategy.effort, "adaptive");
    assert.equal(strategy.turnMode, "multi");
  });

  test("RunOptions type is correct", () => {
    const options: RunOptions = {
      target: { url: "https://example.com/chat" },
      suite: "owasp-llm-top10",
      strategy: { effort: "adaptive" },
      attackerModel: "claude-sonnet-4",
      judgeModel: "claude-opus-4",
      apiKey: "test-key",
      onProgress: () => {},
    };

    assert.equal(options.suite, "owasp-llm-top10");
  });

  test("Finding type is correct", () => {
    const finding: Finding = {
      id: "finding-1",
      evaluatorId: "jailbreaking",
      patternName: "DAN",
      severity: "critical",
      title: "Jailbreak Success",
      description: "Target was jailbroken",
      evidence: "Evidence text",
      standards: { "owasp-llm": "LLM01" },
    };

    assert.equal(finding.severity, "critical");
    assert.equal(finding.standards?.["owasp-llm"], "LLM01");
  });

  test("AttackResult type is correct", () => {
    const attack: AttackResult = {
      attackId: "attack-1",
      evaluatorId: "jailbreaking",
      patternName: "DAN",
      prompt: "Attack prompt",
      response: "Target response",
      verdict: "FAIL",
      evidence: "Evidence",
      turns: [
        { turnIndex: 0, prompt: "Turn 1", response: "Response 1" },
        { turnIndex: 1, prompt: "Turn 2", response: "Response 2" },
      ],
    };

    assert.equal(attack.verdict, "FAIL");
    assert.equal(attack.turns?.length, 2);
  });

  test("EvaluatorResult type is correct", () => {
    const result: EvaluatorResult = {
      evaluatorId: "jailbreaking",
      evaluatorName: "Jailbreaking",
      severity: "critical",
      standards: { "owasp-llm": "LLM01" },
      total: 5,
      passed: 3,
      failed: 2,
      errors: 0,
      passRate: 60,
      attacks: [],
    };

    assert.equal(result.passRate, 60);
    assert.equal(result.total, 5);
  });

  test("RunResults type is correct", () => {
    const results: RunResults = {
      id: "report-123",
      timestamp: new Date().toISOString(),
      targetName: "Test",
      targetKind: "agent",
      effort: "adaptive",
      attackerModel: "claude-sonnet-4",
      judgeModel: "claude-sonnet-4",
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

    assert.equal(results.targetKind, "agent");
    assert.equal(results.summary.safetyScore, 80);
  });

  test("ProgressEvent types are correct", () => {
    const events: ProgressEvent[] = [
      { type: "evaluator_start", evaluatorId: "test", evaluatorName: "Test" },
      { type: "attack_start", attackId: "a1", patternName: "DAN" },
      { type: "attack_done", attackId: "a1", verdict: "PASS" },
      { type: "evaluator_done", evaluatorId: "test", passed: 5, failed: 0, errors: 0 },
    ];

    assert.equal(events[0].type, "evaluator_start");
    assert.equal(events[3].type, "evaluator_done");
  });

  test("RunListener type is correct", () => {
    const listener: RunListener = {
      onRunStart: (info) => {
        assert.equal(typeof info.evaluatorCount, "number");
      },
      onRunFinish: (results) => {
        assert.equal(typeof results.score, "number");
      },
      onAttackDone: (info) => {
        assert.equal(info.verdict, "PASS");
      },
    };

    listener.onRunStart?.({ evaluatorCount: 3 });
    listener.onRunFinish?.({
      id: "r1",
      timestamp: "2026-01-01T00:00:00Z",
      targetName: "T",
      targetKind: "agent",
      effort: "adaptive",
      attackerModel: "m",
      judgeModel: "m",
      score: 90,
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        safetyScore: 90,
        attackSuccessRate: 0,
      },
      findings: [],
      evaluators: [],
    });
  });

  test("SuiteInfo type is correct", () => {
    const suite: SuiteInfo = {
      id: "owasp-llm-top10",
      name: "OWASP LLM Top 10",
      description: "Security testing for LLM applications",
      evaluatorCount: 10,
    };

    assert.equal(suite.evaluatorCount, 10);
  });

  test("EvaluatorInfo type is correct", () => {
    const evaluator: EvaluatorInfo = {
      id: "jailbreaking",
      name: "Jailbreaking",
      severity: "critical",
      description: "Tests for jailbreak vulnerabilities",
      standards: { "owasp-llm": "LLM01" },
    };

    assert.equal(evaluator.severity, "critical");
  });

  test("OpforOptions type is correct", () => {
    const options: OpforOptions = {
      apiKey: "test-key",
      baseUrl: "https://custom.api.com",
      attackerModel: "claude-sonnet-4",
      judgeModel: { provider: "openai", model: "gpt-4o" },
    };

    assert.equal(options.apiKey, "test-key");
  });
});
