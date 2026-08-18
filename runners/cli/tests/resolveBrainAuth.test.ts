import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveBrainAuth,
  noBrainAuthMessage,
  resolveBrainConfig,
  brainKeyEnvVar,
} from "../src/lib/brainAuth.js";

/**
 * Hunt's agents authenticate with an ordinary provider key, resolved through the same registry
 * `opfor run` uses. These tests pin the two behaviors a user actually feels: which env var a
 * given `--brain-provider` reads, and that an unknown provider fails loudly at startup rather
 * than surfacing as a confusing error mid-run.
 *
 * Note this used to also accept a Claude subscription (`claude login`). That path only worked
 * because the Claude Agent SDK spawned the Claude Code CLI; hunt no longer does.
 */

const BRAIN_AUTH_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "OPFOR_API_KEY",
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

test("defaults to anthropic when no provider flag is given", () => {
  const brain = resolveBrainConfig({});
  assert.equal(brain.provider, "anthropic");
  assert.equal(brainKeyEnvVar(brain), "ANTHROPIC_API_KEY");
});

test("each provider resolves to its own conventional env var", () => {
  assert.equal(brainKeyEnvVar(resolveBrainConfig({ brainProvider: "openai" })), "OPENAI_API_KEY");
  assert.equal(brainKeyEnvVar(resolveBrainConfig({ brainProvider: "groq" })), "GROQ_API_KEY");
});

test("--brain-key-env overrides the conventional var", () => {
  const brain = resolveBrainConfig({ brainProvider: "groq", brainKeyEnv: "MY_GROQ_KEY" });
  assert.equal(brainKeyEnvVar(brain), "MY_GROQ_KEY");
});

test("an unknown provider throws with the valid list, rather than failing later", () => {
  assert.throws(
    () => resolveBrainConfig({ brainProvider: "not-a-provider" }),
    /Unknown --brain-provider.*anthropic/s
  );
});

test("resolves when the provider's key is present", () => {
  withBrainEnv({ GROQ_API_KEY: "gsk-test" }, () => {
    const brain = resolveBrainConfig({ brainProvider: "groq" });
    const result = resolveBrainAuth(brain);
    assert.ok(result);
    assert.match(result!.method, /GROQ_API_KEY/);
  });
});

test("returns null when the selected provider's key is missing", () => {
  // A key for a DIFFERENT provider must not satisfy the check — that would send the run
  // into a 401 from the provider instead of an actionable startup error.
  withBrainEnv({ OPENAI_API_KEY: "sk-test" }, () => {
    const brain = resolveBrainConfig({ brainProvider: "groq" });
    assert.equal(resolveBrainAuth(brain), null);
  });
});

test("a gateway base URL is reflected in the reported method", () => {
  withBrainEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
    const brain = resolveBrainConfig({ brainBaseUrl: "https://gateway.example.com" });
    const result = resolveBrainAuth(brain);
    assert.ok(result);
    assert.match(result!.method, /gateway/);
  });
});

test("the base URL itself is never interpolated into the label", () => {
  // It can carry userinfo or a signed query string, and this label is rendered in the setup
  // UI, not just a terminal line.
  withBrainEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () => {
    const brain = resolveBrainConfig({
      brainBaseUrl: "https://user:secret@gw.example.com?sig=abc",
    });
    const result = resolveBrainAuth(brain);
    assert.ok(result);
    assert.doesNotMatch(result!.method, /secret|sig=abc/);
  });
});

test("noBrainAuthMessage names the env var to set and the alternatives", () => {
  const brain = resolveBrainConfig({ brainProvider: "groq" });
  const message = noBrainAuthMessage(brain);
  assert.match(message, /GROQ_API_KEY/);
  assert.match(message, /--brain-provider/);
});
