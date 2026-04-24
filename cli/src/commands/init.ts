import type { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SetupConfigFile } from "@astra/core/config/types";

const SAMPLE_CONFIG: SetupConfigFile = {
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "",
    // baseURL: ""  — only for provider "other" (OpenAI-compatible endpoint)
  },
  target: {
    name: "My AI Agent",
    description: "Describe your application here. Include: what it does, types of users, sensitive data it handles, dangerous actions it can perform, topics it should never discuss.",
    type: "http-endpoint",
    endpoint: "http://localhost:4000/chat",
    requestFormat: "openai",
    targetModel: "gpt-4o-mini",
    // targetApiKey: ""  — Bearer token for target endpoint (optional)
    // scriptPath: "./astra-local-target.js"  — only for type "local-script"
  },
  selection: {
    mode: "suite",
    suite: "owasp-llm-top10",
    // To pick individual evaluators instead:
    // mode: "evaluators",
    // evaluators: ["prompt-injection", "jailbreaking", "sensitive-disclosure"]
  },
  // Optional: telemetry. Never put Langfuse keys here — use env:
  //   export LANGFUSE_PUBLIC_KEY=pk-lf-...
  //   export LANGFUSE_SECRET_KEY=sk-lf-...
  // Optional langfuse.publicKeyEnv / secretKeyEnv rename which env vars are read.
  telemetry: {
    provider: "none",
    // provider: "langfuse",
    // langfuse: {
    //   baseUrlEnv: "LANGFUSE_BASE_URL",
    //   traceSelection: { listLimit: 100, listMaxPages: 3 },
    //   traceCurationListJsonMaxChars: 28000,
    //   traceSummaryForAttackMaxChars: 26000,
    // },
    // enrichJudgeFromTrace: true,
    // propagation: { traceIdStrategy: "per-attack", headers: { "X-Langfuse-Trace-Id": "{{traceId}}" } },
  },
};

const PYTHON_STUB = `#!/usr/bin/env python3
"""Astra local target stub (stdin/stdout JSON).

Planned contract for a future local-script target type:
  - Read one JSON object from stdin with keys: prompt, context (optional).
  - Print one JSON line/object to stdout: {"response": "..."} or {"error": "..."}.

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
    name = context.get("targetName", "?")

    # -------------------------------------------------------------------------
    # EDIT HERE: Replace the demo reply below. Call your own function, HTTP API,
    # LLM SDK, or whatever backs your app — then assign the result to reply.
    # Inputs: prompt (user message), context (optional harness metadata).
    # Output: reply becomes the "response" string in the JSON printed to stdout.
    # -------------------------------------------------------------------------
    reply = (
        f"[astra-local-target demo] target={name}\\n"
        f"Prompt was:\\n{prompt}\\n\\n"
        "Stub response: wire your stack here (LLM, RAG, agent, etc.)."
    )
    print(json.dumps({"response": reply}))


if __name__ == "__main__":
    main()
`;

const NODE_STUB = `#!/usr/bin/env node
/**
 * Astra local target stub (stdin/stdout JSON).
 *
 * Planned contract for a future local-script target type:
 *   - Read one JSON object from stdin: { version, prompt, context? }
 *   - Write one JSON object to stdout: { response: "..." } or { error: "..." }
 *
 * Replace the stub body with your model, tools, or API calls.
 *
 * CommonJS (require) so this file runs as: node astra-local-target.js
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
const name = context.targetName ?? "?";

// ---------------------------------------------------------------------------
// EDIT HERE: Replace the demo reply below. Call your own function, HTTP API,
// LLM SDK, or whatever backs your app — then assign the result to reply.
// Inputs: prompt (user message), context (optional harness metadata).
// Output: reply becomes the "response" string in the JSON printed to stdout.
// ---------------------------------------------------------------------------
const reply =
  "[astra-local-target demo] target=" +
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
      "Generate a sample astra.config.json, and/or sample local target scripts (--example)."
    )
    .option("-o, --output <path>", "Config output path (default: astra.config.json)", "astra.config.json")
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
            const pyPath = path.join(dir, "astra-local-target.py");
            await writeFile(pyPath, PYTHON_STUB, "utf8");
            written.push(pyPath);
          }
          if (example === "node" || example === "both") {
            const jsPath = path.join(dir, "astra-local-target.js");
            await writeFile(jsPath, NODE_STUB, "utf8");
            written.push(jsPath);
          }

          console.log("\nSample local target script(s) written:");
          for (const p of written) console.log(`  ${p}`);
          console.log(
            "\nContract (planned): stdin JSON { prompt, context? } → stdout JSON { response } or { error }."
          );
          console.log(
            'Test: echo \'{"prompt":"hi","context":{}}\' | python3 astra-local-target.py'
          );
          console.log(
            '      echo \'{"prompt":"hi","context":{}}\' | node astra-local-target.js'
          );
          console.log(
            "\nConfig: run `astra init` (no --example) for astra.config.json, set target.type to local-script and target.scriptPath.\n" +
              "Test a scan: `astra run --input astra-prompts-....json --target-script ./astra-local-target.js`\n"
          );
          return;
        }

        await writeFile(opts.output, JSON.stringify(SAMPLE_CONFIG, null, 2), "utf8");
        console.log(`\nConfig template written to: ${opts.output}`);
        console.log(`Edit it, then run: astra setup --config ${opts.output}`);
        console.log(
          "Optional: `astra init --example python`, `node`, or `both` for .py / .js sample scripts.\n"
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });
}
