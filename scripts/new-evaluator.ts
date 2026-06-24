#!/usr/bin/env npx tsx
/**
 * Interactive wizard to scaffold a new evaluator.
 * Usage: npm run new:evaluator
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const AGENT_CATEGORIES = [
  "access-control",
  "accuracy",
  "bias",
  "brand-conduct",
  "code-execution",
  "disclosure",
  "excessive-agency",
  "harmful",
  "injection",
  "mcp-usage",
  "memory-rag",
  "multi-agent",
  "resource",
  "source-analysis",
  "supply-chain",
];

const MCP_CATEGORIES = [
  "auth",
  "disclosure",
  "injection",
  "protocol",
  "source-analysis",
  "supply-chain",
  "tool-poisoning",
];

async function main(): Promise<void> {
  console.log("\n🛡️  Opfor — Create New Evaluator");
  console.log("─".repeat(50));

  // 1. Surface (agent or mcp)
  const surface = await select<"agent" | "mcp">({
    message: "Evaluator surface",
    choices: [
      { name: "Agent  — tests AI agents / chatbots via HTTP or script", value: "agent" },
      { name: "MCP    — tests MCP servers via tools/call", value: "mcp" },
    ],
  });

  const categories = surface === "agent" ? AGENT_CATEGORIES : MCP_CATEGORIES;

  // 2. Category
  const categoryChoice = await select<string>({
    message: "Category",
    choices: [
      ...categories.map((c) => ({ name: c, value: c })),
      { name: "(create new category)", value: "__new__" },
    ],
  });

  let category: string;
  if (categoryChoice === "__new__") {
    category = await input({
      message: "New category name (kebab-case)",
      validate: (v) => {
        if (!v.trim()) return "Required";
        if (!/^[a-z][a-z0-9-]*$/.test(v.trim())) return "Use kebab-case (lowercase, hyphens only)";
        return true;
      },
    });
  } else {
    category = categoryChoice;
  }

  // 3. Evaluator ID
  const id = await input({
    message: "Evaluator ID (kebab-case, must be unique)",
    validate: (v) => {
      if (!v.trim()) return "Required";
      if (!/^[a-z][a-z0-9-]*$/.test(v.trim())) return "Use kebab-case (lowercase, hyphens only)";
      return true;
    },
  });

  // 4. Layout
  const layout = await select<"flat" | "directory">({
    message: "File layout",
    choices: [
      { name: "Flat      — single YAML file (simpler)", value: "flat" },
      {
        name: "Directory — evaluator.yaml + patterns/ folder (for many patterns)",
        value: "directory",
      },
    ],
  });

  // 5. Generate files
  const evaluatorsDir = path.join(REPO_ROOT, "evaluators", surface, category);

  if (layout === "flat") {
    const filePath = path.join(evaluatorsDir, `${id}.yaml`);
    const content = generateFlatEvaluator({ id, surface });

    await mkdir(evaluatorsDir, { recursive: true });
    await writeFile(filePath, content, "utf8");

    const relativePath = path.relative(REPO_ROOT, filePath);
    console.log(`\n✅ Created → ${relativePath}`);
    console.log(`\n📋 Next: Edit ${relativePath} then run: npm run build:catalog\n`);
  } else {
    const dirPath = path.join(evaluatorsDir, id);
    const patternsDir = path.join(dirPath, "patterns");

    await mkdir(patternsDir, { recursive: true });
    await writeFile(
      path.join(dirPath, "evaluator.yaml"),
      generateDirectoryEvaluator({ id, surface }),
      "utf8"
    );
    await writeFile(path.join(patternsDir, "example.yaml"), generatePatternFile(surface), "utf8");

    const relativePath = path.relative(REPO_ROOT, dirPath);
    console.log(`\n✅ Created → ${relativePath}/`);
    console.log(`   ├── evaluator.yaml`);
    console.log(`   └── patterns/example.yaml`);
    console.log(`\n📋 Next: Edit the files then run: npm run build:catalog\n`);
  }
}

function toDisplayName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getStandardsComment(surface: "agent" | "mcp"): string {
  return surface === "agent"
    ? "  # owasp-llm: LLM01  # uncomment to auto-include in owasp-llm-top10"
    : "  # owasp-mcp: MCP01  # uncomment to auto-include in owasp-mcp-top10";
}

function generateFlatEvaluator(params: { id: string; surface: "agent" | "mcp" }): string {
  const { id, surface } = params;
  const patternTemplate =
    surface === "agent"
      ? `    template: |-
      Your attack prompt here. Use {{placeholder}} for LLM-filled variables.`
      : `    template: |-
      [
        {
          "tool_name": "example_tool",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": { "name": "example_tool", "arguments": {} }
          },
          "judge_hint": "Describe what a vulnerable response looks like"
        }
      ]`;

  return `schema_version: 1
id: ${id}
name: ${toDisplayName(id)}
severity: medium
standards:
${getStandardsComment(surface)}
description: >-
  TODO: Describe what this evaluator tests.
pass_criteria: |-
  - Target refuses the malicious request
  - TODO: Add specific safe behaviors
fail_criteria: |-
  - Target executes the malicious request
  - TODO: Add specific vulnerable behaviors
patterns:
  - name: Example Pattern
${patternTemplate}
`;
}

function generateDirectoryEvaluator(params: { id: string; surface: "agent" | "mcp" }): string {
  const { id, surface } = params;
  return `schema_version: 1
id: ${id}
name: ${toDisplayName(id)}
severity: medium
standards:
${getStandardsComment(surface)}
description: >-
  TODO: Describe what this evaluator tests.
pass_criteria: |-
  - Target refuses the malicious request
  - TODO: Add specific safe behaviors
fail_criteria: |-
  - Target executes the malicious request
  - TODO: Add specific vulnerable behaviors
`;
}

function generatePatternFile(surface: "agent" | "mcp"): string {
  if (surface === "agent") {
    return `name: Example Pattern
template: |-
  Your attack prompt here. Use {{placeholder}} for LLM-filled variables.
`;
  }
  return `name: Example Pattern
template: |-
  [
    {
      "tool_name": "example_tool",
      "jsonrpc_payload": {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": { "name": "example_tool", "arguments": {} }
      },
      "judge_hint": "Describe what a vulnerable response looks like"
    }
  ]
`;
}

main().catch((err: unknown) => {
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
