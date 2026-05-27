#!/usr/bin/env node

// Load .env from the project the MCP server is running against.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadSkillCatalog } from "@opfor/core/config/loadSkillCatalog.js";
import { runAll } from "@opfor/core/execute/runAll.js";
import { writeReport } from "@opfor/core/report/buildReport.js";
import { PROVIDERS, type ProviderName } from "@opfor/core/config/types.js";
import type { RunConfig } from "@opfor/core/execute/types.js";
import { normalizeEffort } from "@opfor/core/execute/effortCompat.js";

const server = new McpServer({ name: "opfor", version: "0.1.0" });

// ---------------------------------------------------------------------------
// Tool: opfor_list_evaluators
// ---------------------------------------------------------------------------

server.tool(
  "opfor_list_evaluators",
  "List all available Opfor evaluators and suites. " +
    "ALWAYS call this before opfor_setup — never assume evaluator IDs. " +
    "Returns each evaluator's id, name, severity, and OWASP reference, plus predefined suites.",
  {},
  async () => {
    try {
      const catalog = await loadSkillCatalog();
      const suiteLines = catalog.suites.map(
        (s) =>
          `  Suite: ${s.id}\n` +
          `    Name: ${s.name}\n` +
          `    Evaluators (${s.evaluatorIds.length}): ${s.evaluatorIds.join(", ")}`
      );
      const evalLines = catalog.evaluators.map(
        (e) =>
          `  ${e.id}  [${e.severity.toUpperCase()}]  ${e.name}\n    Standards: ${
            e.standards
              ? Object.entries(e.standards)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")
              : "—"
          }`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `📋 Suites (${catalog.suites.length}):`,
              ...suiteLines,
              ``,
              `📋 Evaluators (${catalog.evaluators.length}):`,
              ...evalLines,
              ``,
              `Usage: pass suite_id to opfor_setup, or pass evaluator_ids array.`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error loading catalog: ${String(err)}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: opfor_setup
// Writes opfor.config.json (RunConfig) that opfor_execute will read.
// ---------------------------------------------------------------------------

const ProviderNameSchema = z.enum(Object.values(PROVIDERS) as [ProviderName, ...ProviderName[]]);

const LlmConfigSchema = z.object({
  provider: ProviderNameSchema,
  model: z.string().min(1),
  api_key_env: z.string().min(1),
  base_url: z.string().optional(),
});

server.tool(
  "opfor_setup",
  "Configure an Opfor red team run and write opfor.config.json. " +
    "Call opfor_list_evaluators first to get valid evaluator/suite IDs. " +
    "Returns the config file path — pass it to opfor_execute.",
  {
    // Target
    target_name: z.string().describe("Human-readable name for the target system"),
    target_kind: z
      .enum(["agent", "mcp"])
      .describe("'agent' for HTTP/chatbot targets, 'mcp' for MCP servers"),

    // Agent target fields (required when target_kind = agent)
    agent_endpoint: z.string().optional().describe("HTTP endpoint URL (agent targets)"),
    agent_request_format: z
      .enum(["auto", "openai", "json"])
      .optional()
      .describe("Request body format (agent targets)"),
    agent_target_api_key: z.string().optional().describe("API key for the target endpoint"),
    agent_script_path: z
      .string()
      .optional()
      .describe("Local script path (.js/.py) for local-script targets"),
    agent_description: z
      .string()
      .optional()
      .describe("What the agent does (used in attack generation)"),

    // MCP target fields (required when target_kind = mcp)
    mcp_transport: z.enum(["stdio", "url"]).optional().describe("MCP transport type"),
    mcp_command: z.string().optional().describe("Command to start MCP server (stdio transport)"),
    mcp_args: z.array(z.string()).optional().describe("Args for MCP server command"),
    mcp_env: z.record(z.string()).optional().describe("Env vars for MCP server process"),
    mcp_url: z.string().optional().describe("MCP server URL (url transport)"),

    // Evaluators
    suite_id: z
      .string()
      .optional()
      .describe("Suite ID (e.g. owasp-mcp-top10). Use this OR evaluator_ids."),
    evaluator_ids: z
      .array(z.string())
      .optional()
      .describe("Explicit evaluator IDs. Use this OR suite_id."),

    // LLM config
    attack_llm: LlmConfigSchema.describe("LLM for generating attacks"),
    judge_llm: LlmConfigSchema.optional().describe(
      "LLM for judging responses (defaults to attack_llm)"
    ),

    // Run settings
    effort: z
      .enum(["adaptive", "comprehensive"])
      .default("adaptive")
      .describe(
        "adaptive: one sustained chat per evaluator, attacker picks tactics on the fly. " +
          "comprehensive: one fresh multi-turn attack per named pattern in each evaluator."
      ),
    turns: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe("Turns per attack. 1 = single-turn, >1 = multi-turn escalation."),

    // Output
    output_dir: z.string().optional().describe("Directory to write opfor.config.json (default: .)"),
    config_path: z.string().optional().describe("Full path for config file (overrides output_dir)"),
  },
  async (args) => {
    try {
      const config = buildRunConfig(args);
      const outputPath = args.config_path
        ? path.resolve(args.config_path)
        : path.resolve(args.output_dir ?? ".", "opfor.config.json");

      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(config, null, 2), "utf8");

      const evalCount =
        config.selection.mode === "evaluators"
          ? config.selection.evaluators.length
          : `suite: ${(config.selection as { suite: string }).suite}`;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `✅ Config written to: ${outputPath}`,
              ``,
              `Target : ${config.target.name} (${config.target.kind})`,
              `Effort : ${config.effort}`,
              `Turns  : ${config.turns}`,
              `Evaluators: ${evalCount}`,
              `Attacker : ${config.attackerLlm.provider}/${config.attackerLlm.model}`,
              ``,
              `Next: call opfor_execute with config_path="${outputPath}"`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Setup failed: ${String(err)}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: opfor_execute
// ---------------------------------------------------------------------------

server.tool(
  "opfor_execute",
  "Run the red team evaluation from a config file produced by opfor_setup. " +
    "Generates attacks on-the-fly, runs them against the target, judges responses, and writes an HTML + JSON report.",
  {
    config_path: z.string().describe("Path to opfor.config.json written by opfor_setup"),
    output_dir: z.string().optional().describe("Directory to write report files (default: .)"),
    effort_override: z
      .enum(["adaptive", "comprehensive"])
      .optional()
      .describe("Override the effort level from config."),
    turns_override: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Override turns per attack from config"),
  },
  async (args) => {
    try {
      const raw = await readFile(path.resolve(args.config_path), "utf8");
      let config = JSON.parse(raw) as RunConfig;

      if (args.effort_override) config = { ...config, effort: args.effort_override };
      if (args.turns_override) config = { ...config, turns: args.turns_override };
      // Defensive coerce in case the config file has an unexpected value.
      config = { ...config, effort: normalizeEffort(config.effort as unknown) };

      const lines: string[] = [
        `🔴 Opfor Execute`,
        `Target: ${config.target.name} (${config.target.kind})`,
        `Effort: ${config.effort}  Turns: ${config.turns}`,
        ``,
        `Running...`,
      ];

      const report = await runAll(config, {
        onProgress: (event) => {
          if (event.type === "evaluator_start") {
            lines.push(`\n▶ ${event.evaluatorName}`);
          } else if (event.type === "evaluator_done") {
            lines.push(`  ${event.passed} passed, ${event.failed} failed, ${event.errors} errors`);
          }
        },
      });

      const outputDir = path.resolve(args.output_dir ?? path.dirname(args.config_path));
      const { html, json } = await writeReport(report, outputDir);

      const { summary } = report;
      lines.push(``, `📊 Results`);
      lines.push(`  Safety score : ${summary.safetyScore}%`);
      lines.push(`  Passed  : ${summary.passed}/${summary.total}`);
      lines.push(`  Failed  : ${summary.failed}`);
      lines.push(`  Errors  : ${summary.errors}`);
      lines.push(``, `Report: ${html}`);
      lines.push(`JSON  : ${json}`);

      // Summary of failures for agent action
      const failures = report.evaluators
        .filter((e) => e.failed > 0)
        .map((e) => `  ${e.evaluatorName}: ${e.failed} failure(s)`);
      if (failures.length > 0) {
        lines.push(``, `⚠️  Vulnerabilities found:`);
        lines.push(...failures);
      } else {
        lines.push(``, `✅ No vulnerabilities found.`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Execute failed: ${String(err)}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRunConfig(args: Record<string, unknown>): RunConfig {
  const kind = args.target_kind as "agent" | "mcp";

  let target: RunConfig["target"];
  if (kind === "agent") {
    const agentType: "http-endpoint" | "local-script" = args.agent_script_path
      ? "local-script"
      : "http-endpoint";
    target = {
      kind: "agent",
      name: String(args.target_name),
      description: String(args.agent_description ?? args.target_name),
      type: agentType,
      endpoint: args.agent_endpoint ? String(args.agent_endpoint) : undefined,
      requestFormat: (args.agent_request_format as "auto" | "openai" | "json") ?? "auto",
      targetApiKey: args.agent_target_api_key ? String(args.agent_target_api_key) : undefined,
      scriptPath: args.agent_script_path ? String(args.agent_script_path) : undefined,
    };
  } else {
    const transport = (args.mcp_transport as "stdio" | "url") ?? "stdio";
    target = {
      kind: "mcp",
      name: String(args.target_name),
      transport,
      command: args.mcp_command ? String(args.mcp_command) : undefined,
      args: Array.isArray(args.mcp_args) ? (args.mcp_args as string[]) : undefined,
      env:
        args.mcp_env && typeof args.mcp_env === "object"
          ? (args.mcp_env as Record<string, string>)
          : undefined,
      url: args.mcp_url ? String(args.mcp_url) : undefined,
    };
  }

  const selection: RunConfig["selection"] = args.suite_id
    ? { mode: "suite", suite: String(args.suite_id) }
    : { mode: "evaluators", evaluators: args.evaluator_ids as string[] };

  const rawAttackLlm = args.attack_llm as {
    provider: ProviderName;
    model: string;
    api_key_env: string;
    base_url?: string;
  };
  const attackerLlm = {
    provider: rawAttackLlm.provider,
    model: rawAttackLlm.model,
    apiKeyEnv: rawAttackLlm.api_key_env,
    baseURL: rawAttackLlm.base_url,
  };

  let judgeLlm: RunConfig["judgeLlm"];
  if (args.judge_llm) {
    const raw = args.judge_llm as typeof rawAttackLlm;
    judgeLlm = {
      provider: raw.provider,
      model: raw.model,
      apiKeyEnv: raw.api_key_env,
      baseURL: raw.base_url,
    };
  }

  return {
    target,
    selection,
    attackerLlm,
    judgeLlm,
    effort: normalizeEffort(args.effort),
    turns: (args.turns as number) ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Opfor MCP server error: ${msg}\n`);
  process.exit(1);
});
