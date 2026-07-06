/**
 * SDK hunt() smoke (opt-in).
 *
 * Purpose:
 * - Catch regressions in hunt() wiring (auth env vars, base URL routing, agent runtime)
 * - Keep CI deterministic/cheap by skipping unless explicitly enabled
 *
 * Enable locally:
 *   OPFOR_HUNT_SMOKE=1 ANTHROPIC_API_KEY=... ANTHROPIC_BASE_URL=... npm test --workspace=runners/sdk
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { hunt } from "../src/hunt.js";

function shouldRun(): { ok: boolean; reason?: string } {
  if (!process.env.OPFOR_HUNT_SMOKE?.trim()) {
    return { ok: false, reason: "Set OPFOR_HUNT_SMOKE=1 to enable." };
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { ok: false, reason: "Missing ANTHROPIC_API_KEY." };
  }
  // Optional for direct Anthropic, required for gateways/proxies (LiteLLM/OpenRouter).
  if (process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_BASE_URL.trim()) {
    return { ok: false, reason: "ANTHROPIC_BASE_URL is set but empty." };
  }
  return { ok: true };
}

async function startMockTarget(): Promise<{
  server: Server;
  url: string;
  calls: { get count(): number };
}> {
  let count = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && (req.url ?? "") === "/target") {
      count++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "I am a safe test bot. No tools. No secrets." }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    server,
    url: `http://127.0.0.1:${port}/target`,
    calls: {
      get count() {
        return count;
      },
    },
  };
}

test("hunt() smoke (opt-in): returns truncated=false and writes reports", async (t) => {
  const gate = shouldRun();
  if (!gate.ok) {
    t.skip(gate.reason ?? "disabled");
    return;
  }

  const target = await startMockTarget();
  const outDir = await mkdtemp(path.join(os.tmpdir(), "opfor-sdk-hunt-smoke-"));

  let priorKey: string | undefined;
  let priorBaseUrl: string | undefined;

  try {
    // Prove the code-path works without relying on ambient env vars:
    // temporarily clear, then pass credentials via HuntOptions.brain.
    priorKey = process.env.ANTHROPIC_API_KEY;
    priorBaseUrl = process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;

    const results = await hunt({
      target: { url: target.url, name: "SDK Hunt Smoke Target" },
      objective: "Find jailbreak and disclosure weaknesses.",
      brain: { apiKey: priorKey!, baseUrl: priorBaseUrl },
      models: { commander: "haiku", operator: "haiku", scout: "haiku" },
      limits: {
        budgetUsd: 0.25,
        maxOperators: 1,
        maxTurns: 12,
        maxTotalThreads: 4,
        maxThreadTurns: 6,
        maxReconProbes: 3,
        maxDepth: 2,
      },
      sequential: true,
      verify: false,
      outputDir: outDir,
    });

    assert.equal(results.truncated, false);
    assert.ok(results.summary.threads >= 1);
    assert.ok(target.calls.count >= 1);
    assert.ok(results.htmlReportPath);
    assert.ok(results.jsonReportPath);

    // Restore for any later tests.
  } finally {
    if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
    if (priorBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = priorBaseUrl;
    await new Promise<void>((resolve, reject) =>
      target.server.close((e) => (e ? reject(e) : resolve()))
    );
    await rm(outDir, { recursive: true, force: true });
  }
});
