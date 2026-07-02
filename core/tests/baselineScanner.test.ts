/**
 * PR12 — BaselineScanner chain.
 *
 * The MCP pre-flight scans had no test coverage before extraction. This pins the
 * chain wiring: with an empty target (no resources, no tools) the resource and
 * tool-description scanners contribute nothing (dropped), and the rug-pull scanner
 * records a first-run baseline — so exactly one EvaluatorResult comes back, and no
 * judge LLM is called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { setEnvProvider } from "../src/lib/env.js";

setEnvProvider(() => "fake-test-api-key");

const { runBaselineScans } = await import("../src/execute/baselineScanner.js");

function emptyTarget() {
  return {
    async callTool() {
      return { response: "" };
    },
    async listTools() {
      return [];
    },
    async listResources() {
      return [];
    },
    async readResource() {
      return "";
    },
    async close() {},
  };
}

test("empty target: only the rug-pull baseline scan contributes a result", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "opfor-baseline-"));
  // The scan logs a burst of progress lines; silence console so the volume can't
  // race the node:test worker's result channel.
  const origLog = console.log;
  console.log = () => {};
  try {
    const results = await runBaselineScans({
      target: emptyTarget(),
      tools: [],
      judgeModelConfig: {
        provider: "openai-compatible",
        model: "m",
        apiKeyEnv: "K",
        baseURL: "http://127.0.0.1:1/v1",
      },
      config: { target: { kind: "mcp", name: "test-srv", transport: "stdio" } } as never,
      outputDir,
      notify: () => {},
    });

    // resource-exposure (no resources) and tool-description (no tools) drop out;
    // rug-pull records a first-run baseline.
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].evaluatorId, "rug-pull-detection");
    assert.strictEqual(results[0].attacks[0].judge.verdict, "PASS");
    assert.match(results[0].attacks[0].judge.reasoning, /baseline recorded/i);
  } finally {
    console.log = origLog;
    await rm(outputDir, { recursive: true, force: true });
  }
});
