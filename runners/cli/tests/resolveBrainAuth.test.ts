import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveBrainAuth, noBrainAuthMessage } from "../src/lib/brainAuth.js";

/**
 * Regression coverage for the orphaned-gateway-token footgun: ANTHROPIC_AUTH_TOKEN
 * set without its required ANTHROPIC_BASE_URL pair is silently discarded by
 * buildChildEnv() in core, and the run falls through to whatever credential is
 * next — which can mean billing a personal Claude subscription instead of the
 * intended gateway. resolveBrainAuth()/noBrainAuthMessage() exist to surface that
 * instead of letting it pass unnoticed.
 */

const BRAIN_AUTH_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

type BrainEnv = Partial<Record<(typeof BRAIN_AUTH_VARS)[number], string>>;

function withBrainEnv(vars: BrainEnv, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of BRAIN_AUTH_VARS) saved.set(key, process.env[key]);
  try {
    for (const key of BRAIN_AUTH_VARS) delete process.env[key];
    for (const [key, value] of Object.entries(vars)) process.env[key] = value;
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const hasClaudeSubscription = existsSync(path.join(homedir(), ".claude", ".credentials.json"));

test("ANTHROPIC_API_KEY resolves first, but still flags an orphaned gateway token", () => {
  withBrainEnv({ ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_AUTH_TOKEN: "orphaned" }, () => {
    const result = resolveBrainAuth();
    assert.ok(result);
    assert.equal(result!.method, "ANTHROPIC_API_KEY");
    assert.ok(
      result!.warning,
      "a leftover orphaned token is a real misconfiguration even when a working key resolves"
    );
  });
});

test("the gateway pair resolves cleanly with no warning", () => {
  withBrainEnv(
    { ANTHROPIC_BASE_URL: "https://gateway.example.com", ANTHROPIC_AUTH_TOKEN: "tok" },
    () => {
      const result = resolveBrainAuth();
      assert.ok(result);
      assert.equal(result!.method, "gateway (https://gateway.example.com)");
      assert.equal(result!.warning, undefined);
    }
  );
});

test("a bare ANTHROPIC_AUTH_TOKEN is not treated as a gateway credential", () => {
  withBrainEnv({ ANTHROPIC_AUTH_TOKEN: "orphaned-token" }, () => {
    const result = resolveBrainAuth();
    if (hasClaudeSubscription) {
      // Falls through to the subscription tier on this machine — still flagged.
      assert.ok(result);
      assert.ok(result!.warning);
    } else {
      assert.equal(result, null);
    }
  });
});

// noBrainAuthMessage() never touches the filesystem — unlike resolveBrainAuth(), its
// behavior is deterministic on every machine, real Claude login or not.
test("noBrainAuthMessage explains the orphaned-token case regardless of any fallback credential", () => {
  withBrainEnv({ ANTHROPIC_AUTH_TOKEN: "orphaned-token" }, () => {
    // The bug this guards against: without the special case, this says "no credentials
    // found" even though the user configured one — just not correctly.
    assert.match(noBrainAuthMessage(), /ANTHROPIC_BASE_URL is not/);
  });
});

test("noBrainAuthMessage falls back to the generic message when nothing is configured", () => {
  withBrainEnv({}, () => {
    assert.doesNotMatch(noBrainAuthMessage(), /ANTHROPIC_BASE_URL is not/);
    assert.match(noBrainAuthMessage(), /No Claude credentials found/);
  });
});
