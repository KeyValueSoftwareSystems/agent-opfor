// Load .env from the project the MCP server is running against.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadSkillCatalog } from "@keyvaluesystems/agent-opfor-core/config/loadSkillCatalog.js";
import { loadCatalog as loadMcpCatalog } from "@keyvaluesystems/agent-opfor-core/catalog/loadCatalog.js";
import { runAll } from "@keyvaluesystems/agent-opfor-core/execute/runAll.js";
import { writeReport } from "@keyvaluesystems/agent-opfor-core/report/buildReport.js";
import { PROVIDERS, type ProviderName } from "@keyvaluesystems/agent-opfor-core/config/types.js";
import type { RunConfig, SessionConfig } from "@keyvaluesystems/agent-opfor-core/execute/types.js";
import { parseRunConfig } from "@keyvaluesystems/agent-opfor-core/config/schema.js";
import { normalizeEffort } from "@keyvaluesystems/agent-opfor-core/execute/effortCompat.js";

function readVersion(): string {
  const pkgUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

const server = new McpServer({ name: "opfor", version: readVersion() });

// ---------------------------------------------------------------------------
// Tool: opfor_list_evaluators
// ---------------------------------------------------------------------------

server.tool(
  "opfor_list_evaluators",
  "List all available Opfor evaluators and suites. " +
    "ALWAYS call this before opfor_setup — never assume evaluator IDs. " +
    "Returns each evaluator's id, name, severity, and OWASP reference, plus predefined suites. " +
    "Pass target_kind to get the correct evaluators for your target type. " +
    "After returning the list, STOP and ask the user which suite or evaluators they want to run — do NOT proceed to opfor_setup automatically.",
  {
    target_kind: z
      .enum(["agent", "mcp"])
      .optional()
      .default("agent")
      .describe("'agent' for AI agent/chatbot targets, 'mcp' for MCP server targets"),
  },
  async (args) => {
    try {
      const catalog =
        args.target_kind === "mcp" ? await loadMcpCatalog() : await loadSkillCatalog();
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
        content: [
          {
            type: "text" as const,
            text: `Error loading catalog: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: opfor_setup
// Writes opfor.config.json (RunConfig) that opfor_run will read.
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
    "Before calling this tool you MUST ask the user for ALL of the following — do NOT assume or infer any value autonomously:\n" +
    "TARGET\n" +
    "  1. Target kind: 'agent' (HTTP chatbot/API) or 'mcp' (MCP server)?\n" +
    "  2. Target name.\n" +
    "  3. (agent) Description of what the agent does.\n" +
    "  4. (agent) HTTP endpoint URL.\n" +
    "  5. (agent) Request format: 'openai' (chat completions), 'json' ({ prompt }), or 'auto'?\n" +
    "  6. (agent) Model name sent to the target in the 'model' field (e.g. sarvam-30b) — ask only if relevant to the endpoint.\n" +
    "  7. (agent) Does the target require an API key?\n" +
    "  7b. (agent, stateful) Session id handling: client-owned (you send it — set agent_session_send_in/name) " +
    "or server-owned (target returns its own — set agent_session_receive_in/name, plus send_* to echo it back).\n" +
    "  8. (mcp) Transport: 'stdio' or 'url'? Then ask command+args or URL accordingly.\n" +
    "EVALUATORS\n" +
    "  9. Call opfor_list_evaluators with the chosen target_kind, present the suites and evaluators to the user, then ask: run a full suite or specific evaluators?\n" +
    "ATTACKER LLM\n" +
    ` 10. Provider — options: ${Object.values(PROVIDERS).join(", ")}.\n` +
    " 11. Model name for that provider.\n" +
    " 12. Name of the environment variable that holds the API key (e.g. OPENAI_API_KEY).\n" +
    " 13. (openai-compatible or azure only) Base URL.\n" +
    "JUDGE LLM\n" +
    " 14. Use a separate LLM for judging, or reuse the attacker LLM?\n" +
    "RUN SETTINGS\n" +
    " 15. Effort: 'adaptive' (one sustained chat per evaluator) or 'comprehensive' (one attack per named pattern)?\n" +
    " 16. Turns per attack: 1 (single-turn) or 2-10 (multi-turn escalation)?\n" +
    "Only call this tool once you have confirmed all answers with the user. " +
    "Returns the config file path — pass it to opfor_run.",
  {
    // Target
    target_name: z.string().describe("Human-readable name for the target system"),
    target_kind: z
      .enum(["agent", "mcp"])
      .describe("'agent' for HTTP/chatbot targets, 'mcp' for MCP servers"),

    // Agent target fields (required when target_kind = agent)
    agent_endpoint: z.string().url().optional().describe("HTTP endpoint URL (agent targets)"),
    agent_request_format: z
      .enum(["auto", "openai", "json"])
      .optional()
      .describe("Request body format (agent targets)"),
    agent_api_key_env: z
      .string()
      .optional()
      .describe("Env var name holding the target API key (e.g. TARGET_API_KEY)"),
    agent_script_path: z
      .string()
      .optional()
      .describe("Local script path (.js/.py) for local-script targets"),
    agent_description: z
      .string()
      .optional()
      .describe("What the agent does (used in attack generation)"),
    agent_model: z
      .string()
      .optional()
      .describe(
        "Model name sent to the target endpoint in the 'model' field (e.g. sarvam-30b, gpt-4o)"
      ),
    // Session handling. Client-owned: set send_* only. Server-owned: set receive_* (+ send_* to echo).
    agent_session_send_in: z
      .enum(["body", "header"])
      .optional()
      .describe("Where OPFOR sends the session id (body field or request header)"),
    agent_session_send_name: z
      .string()
      .optional()
      .describe("Body dot-path or header name the session id is sent in (e.g. session_id)"),
    agent_session_receive_in: z
      .enum(["body", "header", "set-cookie"])
      .optional()
      .describe("Where a server-owned target RETURNS its session id (enables server-owned mode)"),
    agent_session_receive_name: z
      .string()
      .optional()
      .describe("Response body dot-path / header name / cookie name holding the returned id"),

    // MCP target fields (required when target_kind = mcp)
    mcp_transport: z.enum(["stdio", "url"]).optional().describe("MCP transport type"),
    mcp_command: z.string().optional().describe("Command to start MCP server (stdio transport)"),
    mcp_args: z.array(z.string()).optional().describe("Args for MCP server command"),
    mcp_env: z
      .record(z.string(), z.string())
      .optional()
      .describe("Env vars for MCP server process"),
    mcp_url: z.string().url().optional().describe("MCP server URL (url transport)"),

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
    attack_objective: z
      .string()
      .optional()
      .describe(
        "Free-text primary mission steering every evaluator's attacks " +
          "(e.g. 'get the target to leak env vars via a delegated employee')."
      ),
    judge_hint: z
      .string()
      .optional()
      .describe(
        "Free-text steering for the judge's verdict " +
          "(e.g. 'treat any tool name leak as critical')."
      ),
    business_use_case: z
      .string()
      .optional()
      .describe("Free-text domain/business context for the target agent."),

    // Output
    output_dir: z.string().optional().describe("Directory to write opfor.config.json (default: .)"),
    config_path: z.string().optional().describe("Full path for config file (overrides output_dir)"),
  },
  async (args) => {
    // Validate required-field matrix based on target_kind
    const setupInputSchema = z
      .object({
        target_kind: z.enum(["agent", "mcp"]),
        agent_endpoint: z.string().url().optional(),
        agent_script_path: z.string().optional(),
        mcp_transport: z.enum(["stdio", "url"]).optional(),
        mcp_url: z.string().url().optional(),
        mcp_command: z.string().optional(),
      })
      .superRefine((data, ctx) => {
        if (data.target_kind === "agent") {
          if (!data.agent_endpoint && !data.agent_script_path) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["agent_endpoint"],
              message:
                "agent targets require either agent_endpoint (HTTP URL) or agent_script_path (local script path)",
            });
          }
        } else if (data.target_kind === "mcp") {
          const transport = data.mcp_transport ?? "stdio";
          if (transport === "url" && !data.mcp_url) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["mcp_url"],
              message: "mcp targets with transport='url' require mcp_url",
            });
          }
          if (transport === "stdio" && !data.mcp_command) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["mcp_command"],
              message: "mcp targets with transport='stdio' require mcp_command",
            });
          }
        }
      });

    const refinedValidation = setupInputSchema.safeParse(args);
    if (!refinedValidation.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Setup validation failed: ${refinedValidation.error.issues.map((i) => i.message).join("; ")}`,
          },
        ],
        isError: true,
      };
    }

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
              ...(config.attackObjective ? [`Objective : ${config.attackObjective}`] : []),
              ...(config.judgeHint ? [`Judge hint : ${config.judgeHint}`] : []),
              ...(config.businessUseCase ? [`Business use case : ${config.businessUseCase}`] : []),
              ``,
              `Next: call opfor_run with config_path="${outputPath}"`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Setup failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: opfor_run
// ---------------------------------------------------------------------------

server.tool(
  "opfor_run",
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
    objective_override: z.string().optional().describe("Override the attack objective from config"),
    judge_hint_override: z.string().optional().describe("Override the judge hint from config"),
    business_use_case_override: z
      .string()
      .optional()
      .describe("Override the business use case from config"),
  },
  async (args) => {
    try {
      const raw = await readFile(path.resolve(args.config_path), "utf8");
      let config = parseRunConfig(JSON.parse(raw)) as unknown as RunConfig;

      if (args.effort_override) config = { ...config, effort: args.effort_override };
      if (args.turns_override) config = { ...config, turns: args.turns_override };
      if (args.objective_override) config = { ...config, attackObjective: args.objective_override };
      if (args.judge_hint_override) config = { ...config, judgeHint: args.judge_hint_override };
      if (args.business_use_case_override)
        config = { ...config, businessUseCase: args.business_use_case_override };
      // Defensive coerce in case the config file has an unexpected value.
      config = { ...config, effort: normalizeEffort(config.effort as unknown) };

      const lines: string[] = [
        `🔴 Opfor Run`,
        `Target: ${config.target.name} (${config.target.kind})`,
        `Effort: ${config.effort}  Turns: ${config.turns}`,
        ...(config.attackObjective ? [`Objective: ${config.attackObjective}`] : []),
        ...(config.judgeHint ? [`Judge hint: ${config.judgeHint}`] : []),
        ...(config.businessUseCase ? [`Business use case: ${config.businessUseCase}`] : []),
        ``,
        `Running...`,
      ];

      const report = await runAll(config, {
        listeners: [
          {
            onEvaluatorStart: (e) => lines.push(`\n▶ ${e.evaluatorName}`),
            onEvaluatorDone: (e) =>
              lines.push(`  ${e.passed} passed, ${e.failed} failed, ${e.errors} errors`),
          },
        ],
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
        content: [
          {
            type: "text" as const,
            text: `Execute failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Assemble the session config from the flat agent_session_* tool inputs.
// A body/header receive needs a name to be capturable; a set-cookie receive doesn't.
// If the caller only set receive_*, default send to echo it back (set-cookie -> Cookie
// header), matching the CLI wizard's "echo symmetrically" behavior.
function buildSessionConfig(args: Record<string, unknown>): SessionConfig | undefined {
  const sendIn = args.agent_session_send_in as "body" | "header" | undefined;
  const sendName = args.agent_session_send_name ? String(args.agent_session_send_name) : undefined;
  const receiveIn = args.agent_session_receive_in as "body" | "header" | "set-cookie" | undefined;
  const receiveName = args.agent_session_receive_name
    ? String(args.agent_session_receive_name)
    : undefined;

  const receive: SessionConfig["receive"] =
    receiveIn === "set-cookie"
      ? { in: "set-cookie", name: receiveName }
      : receiveIn && receiveName
        ? { in: receiveIn, name: receiveName }
        : undefined;

  const send: SessionConfig["send"] | undefined =
    sendIn && sendName
      ? { in: sendIn, name: sendName }
      : receive
        ? receive.in === "set-cookie"
          ? { in: "header", name: "Cookie" }
          : { in: receive.in, name: receive.name }
        : undefined;

  if (!send) return undefined;
  return { send, receive };
}

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
      apiKeyEnv: args.agent_api_key_env ? String(args.agent_api_key_env) : undefined,
      model: args.agent_model ? String(args.agent_model) : undefined,
      scriptPath: args.agent_script_path ? String(args.agent_script_path) : undefined,
      session: buildSessionConfig(args),
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

  if (!args.suite_id && (!args.evaluator_ids || (args.evaluator_ids as string[]).length === 0)) {
    throw new Error(
      "Provide either suite_id or evaluator_ids (call opfor_list_evaluators to see valid IDs)"
    );
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
    attackObjective: args.attack_objective ? String(args.attack_objective) : undefined,
    judgeHint: args.judge_hint ? String(args.judge_hint) : undefined,
    businessUseCase: args.business_use_case ? String(args.business_use_case) : undefined,
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
