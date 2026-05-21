import type { Command } from "commander";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Legacy helper: writes only an `"agent"` block; unified CLI uses `opfor setup --agent`. */
const SAMPLE_CONFIG = `{
  "agent": {
    "attackLlm": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "apiKeyEnv": "OPENAI_API_KEY"
    },
    "target": {
      "name": "My AI Agent",
      "description": "Describe your application here. Include: what it does, types of users, sensitive data it handles, dangerous actions it can perform, topics it should never discuss.",
      "type": "http-endpoint",
      "endpoint": "http://localhost:4000/chat",
      "requestFormat": "openai",
      "targetModel": "gpt-4o-mini"
    },
    "selection": {
      "mode": "suite",
      "suite": "owasp-llm-top10"
    },
    "turnMode": "single",
    "telemetry": {
      "provider": "none"
    }
  }
}
`;

const PYTHON_STUB = `#!/usr/bin/env python3
"""Opfor local target stub (stdin/stdout JSON).

Stdin:  one JSON object { "prompt": "...", "context": {...}, "sessionId": "..." }
Stdout: one JSON object { "response": "..." } or { "error": "..." }

sessionId is present for multi-turn attacks. Use it to key your own conversation
history so the agent under test can maintain context across turns.

Replace the stub body with your model, tools, or API calls.
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"invalid json: {e}"}))
        sys.exit(1)

    prompt = data.get("prompt", "")
    context = data.get("context") or {}
    session_id = data.get("sessionId")  # present for multi-turn attacks; None for single-turn
    name = context.get("targetName", "?")

    # -------------------------------------------------------------------------
    # EDIT HERE: Replace the demo reply below. Call your own function, HTTP API,
    # LLM SDK, or whatever backs your app — then assign the result to reply.
    #
    # For multi-turn support: use session_id to look up and store conversation
    # history so your agent can respond in context across turns.
    #
    # Inputs:  prompt (current user message), session_id (None = single-turn),
    #          context (harness metadata e.g. targetName)
    # Output:  reply string → printed as {"response": reply}
    # -------------------------------------------------------------------------
    reply = (
        f"[opfor-local-target demo] target={name}\\n"
        f"Prompt was:\\n{prompt}\\n\\n"
        "Stub response: wire your stack here (LLM, RAG, agent, etc.)."
    )
    print(json.dumps({"response": reply}))


if __name__ == "__main__":
    main()
`;

const NODE_STUB = `#!/usr/bin/env node
/**
 * Opfor local target stub (stdin/stdout JSON).
 *
 * Stdin:  one JSON object { "prompt": "...", "context": {...}, "sessionId": "..." }
 * Stdout: one JSON object { "response": "..." } or { "error": "..." }
 *
 * sessionId is present for multi-turn attacks. Use it to key your own conversation
 * history so the agent under test can maintain context across turns.
 *
 * Replace the stub body with your model, tools, or API calls.
 *
 * CommonJS (require) so this file runs as: node opfor-local-target.js
 * without needing "type": "module" in package.json.
 */
const { readFileSync } = require("node:fs");

const raw = readFileSync(0, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(JSON.stringify({ error: "invalid json: " + msg }));
  process.exit(1);
}

const prompt = data.prompt ?? "";
const context = data.context ?? {};
const sessionId = data.sessionId; // present for multi-turn attacks; undefined for single-turn
const name = context.targetName ?? "?";

// ---------------------------------------------------------------------------
// EDIT HERE: Replace the demo reply below. Call your own function, HTTP API,
// LLM SDK, or whatever backs your app — then assign the result to reply.
//
// For multi-turn support: use sessionId to look up and store conversation
// history so your agent can respond in context across turns.
//
// Inputs:  prompt (current user message), sessionId (undefined = single-turn),
//          context (harness metadata e.g. targetName)
// Output:  reply becomes the "response" string in the JSON printed to stdout.
// ---------------------------------------------------------------------------
const reply =
  "[opfor-local-target demo] target=" +
  name +
  "\\nPrompt was:\\n" +
  prompt +
  "\\n\\nStub response: wire your stack here (LLM, RAG, agent, etc.).";

console.log(JSON.stringify({ response: reply }));
`;

type ExampleKind = "python" | "node" | "both";

function parseExample(value: string | undefined): ExampleKind | null {
  if (value === undefined || value === "") return null;
  const v = value.toLowerCase().trim();
  if (v === "python" || v === "py") return "python";
  if (v === "node" || v === "js" || v === "javascript") return "node";
  if (v === "both" || v === "all") return "both";
  throw new Error(`Invalid --example "${value}". Use: python, node, or both.`);
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(
      "Generate a sample opfor.config.json, and/or sample local target scripts (--example)."
    )
    .option(
      "-o, --output <path>",
      "Config output path (default: opfor.config.json)",
      "opfor.config.json"
    )
    .option(
      "--example <kind>",
      "Write sample .py and/or .js local targets (JSON stdin → JSON stdout; does not write config)"
    )
    .option("--script-dir <dir>", "Directory for --example scripts (default: .)", ".")
    .action(async (opts: { output: string; example?: string; scriptDir: string }) => {
      try {
        const example = parseExample(opts.example);

        if (example) {
          const dir = path.resolve(opts.scriptDir);
          await mkdir(dir, { recursive: true });

          const written: string[] = [];
          if (example === "python" || example === "both") {
            const pyPath = path.join(dir, "opfor-local-target.py");
            await writeFile(pyPath, PYTHON_STUB, "utf8");
            written.push(pyPath);
          }
          if (example === "node" || example === "both") {
            const jsPath = path.join(dir, "opfor-local-target.js");
            await writeFile(jsPath, NODE_STUB, "utf8");
            written.push(jsPath);
          }

          console.log("\nSample local target script(s) written:");
          for (const p of written) console.log(`  ${p}`);
          console.log(
            "\nContract: stdin JSON { prompt, context?, sessionId? } → stdout JSON { response } or { error }."
          );
          console.log(
            'Test: echo \'{"prompt":"hi","context":{}}\' | python3 opfor-local-target.py'
          );
          console.log('      echo \'{"prompt":"hi","context":{}}\' | node opfor-local-target.js');
          console.log(
            "\nConfig: use `opfor setup --agent` to create a timestamped config under .opfor/configs/.\n" +
              "Then: `opfor generate --config .opfor/configs/opfor-config-....json` and `opfor execute --attacks .opfor/attacks/opfor-attacks-....json`.\n"
          );
          return;
        }

        const outPath = path.resolve(opts.output);
        let doc = JSON.parse(SAMPLE_CONFIG) as Record<string, unknown>;
        try {
          const prevRaw = await readFile(outPath, "utf8");
          const prev = JSON.parse(prevRaw) as Record<string, unknown>;
          if (typeof prev.configId === "string" && prev.mcp && typeof prev.mcp === "object") {
            doc = { ...doc, mcp: prev.mcp };
          }
        } catch {
          /* new file or unreadable — write template only */
        }
        await writeFile(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
        console.log(`\nConfig template written to: ${opts.output}`);
        console.log(`Edit it, then run: opfor generate --config ${opts.output}`);
        console.log(
          "Optional: `opfor agent init --example python`, `node`, or `both` for .py / .js sample scripts.\n"
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });
}
