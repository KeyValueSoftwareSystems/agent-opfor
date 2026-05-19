#!/usr/bin/env node

// Load .env from the project the MCP server is running against.
// This lets users store GROQ_API_KEY (etc.) in their project's .env
// without having to add it to the MCP config manually.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadSkillCatalog, getEvaluatorIdSet } from "../../core/dist/config/loadSkillCatalog.js";
import { runSetup, runSetupInline } from "./core/setup.js";
import { runScan } from "./core/run.js";
import { runMcpSetup } from "./core/mcpSetup.js";
import { runMcpExecute } from "./core/mcpExecute.js";
import { PROVIDERS, type ProviderName } from "../../core/dist/config/types.js";

const server = new McpServer({
  name: "opfor",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: opfor_list_evaluators
// Lists all available evaluators and suites so the agent can pick them by id.
// ---------------------------------------------------------------------------

server.tool(
  "opfor_list_evaluators",
  "List all available Opfor evaluators and suites. " +
    "ALWAYS call this before opfor_setup — never assume evaluator IDs. " +
    "Present the results to the user and ask them to choose a suite or specific evaluators before proceeding. " +
    "Returns each evaluator's id, name, severity, and OWASP tag, plus predefined suites (owasp-llm-top10, owasp-agentic-ai).",
  {},
  async () => {
    try {
      const catalog = await loadSkillCatalog();
      const evalIds = getEvaluatorIdSet(catalog);

      const suiteLines = catalog.suites.map(
        (s) =>
          `  Suite: ${s.id}\n` +
          `    Name:    ${s.name}\n` +
          `    Evaluators (${s.evaluatorIds.length}): ${s.evaluatorIds.join(", ")}`
      );

      const evalLines = catalog.evaluators.map(
        (e) => `  ${e.id}  [${e.severity.toUpperCase()}]  ${e.name}\n` + `    Ref: ${e.ref ?? "—"}`
      );

      return {
        content: [
          {
            type: "text",
            text: [
              `📋 Available Suites (${catalog.suites.length}):`,
              ...suiteLines,
              ``,
              `🔍 Available Evaluators (${evalIds.size}):`,
              ...evalLines,
              ``,
              `Pass evaluator ids or a suite id to opfor_setup.`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Failed to load evaluators: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: opfor_setup
//
// Unified setup for both agent/chatbot and MCP server red-teaming.
// Auto-detects mode:
//   - config_path with "mcp" section  -> MCP server red-teaming
//   - config_path without "mcp"       -> agent red-teaming (config file)
//   - inline target_* params          -> agent red-teaming (inline)
// ---------------------------------------------------------------------------

const opforSetupSchemaShape: Record<string, z.ZodTypeAny> = {
  // ── Inline target parameters ────────────────────────────────────────────
  target_name: z
    .string()
    .optional()
    .describe("Human-readable name of the AI app (e.g. 'Kera Travel Agent')."),

  target_description: z
    .string()
    .optional()
    .describe(
      "What the target does, who uses it, sensitive data it handles, dangerous operations. " +
        "Optional when use_langfuse=true — opfor infers this from traces."
    ),

  target_endpoint: z
    .string()
    .optional()
    .describe(
      "HTTP endpoint to attack (e.g. 'http://localhost:4000/chat'). Required when target_type='http-endpoint'."
    ),

  target_type: z
    .enum(["http-endpoint", "local-script"])
    .optional()
    .default("http-endpoint")
    .describe("How opfor sends attacks. 'http-endpoint' for HTTP, 'local-script' for subprocess."),

  target_request_format: z
    .enum(["auto", "openai", "json"])
    .optional()
    .default("auto")
    .describe(
      "Request shape sent to the endpoint. " +
        "'openai' → {model,messages}. 'json' → {prompt}. 'auto' → sniff from endpoint."
    ),

  target_api_key: z
    .string()
    .optional()
    .describe("API key for the target endpoint itself (not for the LLM used by opfor)."),

  target_script_path: z
    .string()
    .optional()
    .describe("Path to the local script when target_type='local-script'."),

  // ── Evaluator / suite selection ─────────────────────────────────────────
  suite: z
    .string()
    .optional()
    .describe(
      "Run a predefined suite (e.g. 'owasp-llm-top10', 'owasp-agentic-ai'). " +
        "Mutually exclusive with evaluator_ids. Call opfor_list_evaluators to see options."
    ),

  evaluator_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Specific evaluator ids to run (e.g. ['prompt-injection','excessive-agency']). " +
        "Mutually exclusive with suite. Call opfor_list_evaluators to see all ids."
    ),

  // ── LLM for attack generation ───────────────────────────────────────────
  llm_provider: z
    .enum([
      PROVIDERS.GROQ,
      PROVIDERS.OPENAI,
      PROVIDERS.ANTHROPIC,
      PROVIDERS.GOOGLE,
      PROVIDERS.DEEPSEEK,
      PROVIDERS.AZURE,
      PROVIDERS.OPENAI_COMPATIBLE,
    ] as [ProviderName, ...ProviderName[]])
    .optional()
    .describe(
      "LLM provider opfor uses to generate attack prompts and judge responses. " +
        "Defaults to 'groq'. The corresponding API key env var must be set (or pass llm_api_key_env to specify the var name)."
    ),

  llm_model: z
    .string()
    .optional()
    .describe(
      "Model name for the LLM (e.g. 'llama-3.3-70b-versatile'). Uses provider default if omitted."
    ),

  llm_api_key_env: z
    .string()
    .optional()
    .describe(
      "Name of the environment variable holding the API key for the attack/judge LLM " +
        "(e.g. 'GROQ_API_KEY'). Defaults to the standard env var for the chosen provider."
    ),

  // ── Langfuse / traces ───────────────────────────────────────────────────
  use_langfuse: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, opfor reads production traces from Langfuse to: " +
        "(1) select realistic evaluators based on what the app actually does, " +
        "(2) ground attack prompts in real user language and behaviour, " +
        "(3) enrich the judge with the target's internal trace after each attack. " +
        "Requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the environment."
    ),

  langfuse_lookback_hours: z
    .number()
    .optional()
    .describe("When use_langfuse=true, how many hours back to fetch traces. Default: 24."),

  langfuse_trace_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Explicit list of Langfuse trace IDs to use instead of the automatic lookback window."
    ),

  // ── Multi-turn ──────────────────────────────────────────────────────────
  turn_mode: z
    .enum(["single", "multi"])
    .optional()
    .default("single")
    .describe(
      "'single' (default) — one prompt per attack. " +
        "'multi' — runs a short adversarial conversation per attack: after each response, an attacker LLM " +
        "generates a more escalating follow-up until the target fails or the turn limit is reached. " +
        "Requires the target to maintain conversation history across requests using a session ID."
    ),

  turns: z
    .number()
    .optional()
    .default(3)
    .describe("Maximum number of turns per attack when turn_mode='multi'. Defaults to 3."),

  session_id_field: z
    .string()
    .optional()
    .describe(
      "JSON body field name to inject a session ID into every HTTP request for multi-turn attacks " +
        "(e.g. 'session_id'). The target uses this field to look up and reconstruct conversation history. " +
        "Required when turn_mode='multi' and target_type='http-endpoint'."
    ),

  // ── Config file (backward-compatible) ──────────────────────────────────
  config_path: z
    .string()
    .optional()
    .describe(
      "Path to an opfor config file (JSON or YAML). " +
        "For MCP server red-teaming, the config must have an 'mcp' section with server connection details — mode is auto-detected. " +
        "For agent/chatbot red-teaming, use a config with target/selection or pass inline target_* params instead. " +
        "Inline parameters take precedence if both are supplied."
    ),

  output_dir: z
    .string()
    .optional()
    .default(".")
    .describe(
      "Directory where opfor-prompts-*.json will be written. Defaults to current directory."
    ),
};

server.tool(
  "opfor_setup",
  "Generate targeted red-team attacks for an AI agent/chatbot OR an MCP server. " +
    "Mode is auto-detected: if config_path points to a file with an 'mcp' section, runs MCP server red-teaming; " +
    "otherwise runs agent/chatbot red-teaming (config file or inline target_* params). " +
    "IMPORTANT: Before calling, confirm with the user: " +
    "(1) Are we red-teaming an agent/chatbot or an MCP server? " +
    "(2) Which evaluators or suite to run — call opfor_list_evaluators first. " +
    "(3) For agents: single-turn or multi-turn attacks, whether to use Langfuse, and target description. " +
    "(4) For MCP servers: provide a config_path to an opfor.config.json with an 'mcp' section.",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opforSetupSchemaShape as Record<string, any>,
  (async (args: {
    target_name?: string;
    target_description?: string;
    target_endpoint?: string;
    target_type?: "http-endpoint" | "local-script";
    target_request_format?: "auto" | "openai" | "json";
    target_api_key?: string;
    target_script_path?: string;
    suite?: string;
    evaluator_ids?: string[];
    llm_provider?: ProviderName;
    llm_model?: string;
    llm_api_key_env?: string;
    use_langfuse?: boolean;
    langfuse_lookback_hours?: number;
    langfuse_trace_ids?: string[];
    turn_mode?: "single" | "multi";
    turns?: number;
    session_id_field?: string;
    config_path?: string;
    output_dir?: string;
  }) => {
    const {
      target_name,
      target_description,
      target_endpoint,
      target_type = "http-endpoint",
      target_request_format = "auto",
      target_api_key,
      target_script_path,
      suite,
      evaluator_ids,
      llm_provider,
      llm_model,
      llm_api_key_env,
      use_langfuse = false,
      langfuse_lookback_hours,
      langfuse_trace_ids,
      turn_mode = "single",
      turns = 3,
      session_id_field,
      config_path,
      output_dir = ".",
    } = args;

    try {
      const usingInline = !!target_name;

      if (!usingInline && !config_path) {
        return {
          content: [
            {
              type: "text",
              text:
                "❌ Provide either:\n" +
                "  • config_path — for MCP server red-teaming (config with 'mcp' section) or agent red-teaming (config with target/selection)\n" +
                "  • inline target_* parameters — for agent/chatbot red-teaming\n\n" +
                "If unsure, ask the user: are we red-teaming an agent/chatbot or an MCP server?",
            },
          ],
          isError: true,
        };
      }

      // Auto-detect MCP mode from config file
      if (!usingInline && config_path) {
        const raw = await readFile(path.resolve(config_path), "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        if (parsed.mcp && typeof parsed.mcp === "object") {
          // MCP server red-teaming
          const mcpResult = await runMcpSetup({
            configPath: config_path,
            suite: suite,
            evaluators: evaluator_ids,
          });

          return {
            content: [
              {
                type: "text",
                text: [
                  `✅ MCP setup complete!`,
                  ``,
                  `Mode:       MCP server red-teaming (auto-detected from config)`,
                  `Server:     ${mcpResult.serverSummary}`,
                  `Suite:      ${mcpResult.suiteId}`,
                  `Tools:      ${mcpResult.toolCount}`,
                  `Resources:  ${mcpResult.resourceCount}`,
                  `Evaluators: ${mcpResult.evaluatorCount}`,
                  `Attacks:    ${mcpResult.attackCount}`,
                  `Plan file:  ${mcpResult.planPath}`,
                  ``,
                  `Next step: call opfor_execute with input_path="${mcpResult.planPath}"`,
                ].join("\n"),
              },
            ],
          };
        }

        // Agent red-teaming via config file
      }

      // Validate evaluator selection when using inline mode
      if (usingInline && !suite && (!evaluator_ids || evaluator_ids.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text:
                "❌ Provide either suite (e.g. 'owasp-llm-top10') or evaluator_ids. " +
                "Call opfor_list_evaluators to see available options.",
            },
          ],
          isError: true,
        };
      }

      let agentResult;

      if (usingInline) {
        const selection = suite
          ? { mode: "suite" as const, suite }
          : { mode: "evaluators" as const, evaluators: evaluator_ids! };

        let telemetryOverride = undefined;
        if (langfuse_trace_ids && langfuse_trace_ids.length > 0) {
          telemetryOverride = {
            provider: "langfuse" as const,
            langfuse: {
              publicKeyEnv: "LANGFUSE_PUBLIC_KEY",
              secretKeyEnv: "LANGFUSE_SECRET_KEY",
              baseUrlEnv: "LANGFUSE_BASE_URL",
              traceSelection: { setupTraceIds: langfuse_trace_ids },
            },
            enrichJudgeFromTrace: true,
            propagation: { headers: { "X-Langfuse-Trace-Id": "{traceId}" } },
          };
        } else if (use_langfuse && langfuse_lookback_hours !== undefined) {
          telemetryOverride = {
            provider: "langfuse" as const,
            langfuse: {
              publicKeyEnv: "LANGFUSE_PUBLIC_KEY",
              secretKeyEnv: "LANGFUSE_SECRET_KEY",
              baseUrlEnv: "LANGFUSE_BASE_URL",
              traceSelection: { lookbackHours: langfuse_lookback_hours },
            },
            enrichJudgeFromTrace: true,
            propagation: { headers: { "X-Langfuse-Trace-Id": "{traceId}" } },
          };
        }

        agentResult = await runSetupInline(
          {
            target: {
              name: target_name,
              description: target_description,
              type: target_type,
              endpoint: target_endpoint,
              requestFormat: target_request_format,
              targetApiKey: target_api_key,
              scriptPath: target_script_path,
              ...(session_id_field ? { sessionIdField: session_id_field } : {}),
            },
            selection,
            attackLlm:
              llm_provider || llm_model || llm_api_key_env
                ? {
                    ...(llm_provider ? { provider: llm_provider } : {}),
                    ...(llm_model ? { model: llm_model } : {}),
                    ...(llm_api_key_env ? { apiKeyEnv: llm_api_key_env } : {}),
                  }
                : undefined,
            useLangfuse: use_langfuse,
            telemetry: telemetryOverride,
            turnMode: turn_mode === "multi" ? "multi" : undefined,
            turns: turn_mode === "multi" ? turns : undefined,
          },
          output_dir
        );
      } else {
        agentResult = await runSetup({
          configPath: config_path!,
          outputDir: output_dir,
        });
      }

      const traceLines: string[] = [];
      if (agentResult.traceCurationRan) {
        if (agentResult.curationError) {
          traceLines.push(`⚠️  Trace curation failed: ${agentResult.curationError}`);
          traceLines.push(`   Attacks were generated without trace grounding.`);
        } else {
          traceLines.push(`✅ Traces analysed — attacks grounded in real usage.`);
          if (agentResult.traceSummaryPath) {
            traceLines.push(`   Trace summary: ${agentResult.traceSummaryPath}`);
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Agent setup complete!`,
              ``,
              `Mode:       Agent/chatbot red-teaming`,
              `Provider:       ${agentResult.provider} / ${agentResult.model}`,
              `Evaluators:     ${agentResult.evaluatorCount}`,
              `Attack prompts: ${agentResult.totalAttacks}`,
              `Prompts file:   ${agentResult.promptsFilePath}`,
              ...(traceLines.length > 0 ? [``, ...traceLines] : []),
              ``,
              `Next step: call opfor_execute with input_path="${agentResult.promptsFilePath}"`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Setup failed: ${msg}` }],
        isError: true,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
);

// ---------------------------------------------------------------------------
// Tool: opfor_execute
//
// Unified execution for both agent/chatbot and MCP server red-teaming.
// Auto-detects mode from the plan file:
//   - Has "server" + "toolsDigest" -> MCP server execution
//   - Has "target" + "attacks"     -> agent/chatbot execution
// ---------------------------------------------------------------------------

const opforExecuteSchemaShape: Record<string, z.ZodTypeAny> = {
  input_path: z.string().describe("Path to the plan/prompts file produced by opfor_setup."),
  output_dir: z
    .string()
    .optional()
    .default(".opfor/reports")
    .describe("Directory where HTML and JSON reports will be written. Defaults to .opfor/reports."),
};

server.tool(
  "opfor_execute",
  "Execute a red team scan using the plan file generated by opfor_setup. " +
    "Auto-detects whether the plan targets an agent/chatbot or an MCP server. " +
    "For agents: fires attack prompts at the target endpoint and judges responses. " +
    "For MCP servers: connects to the server, fires attacks via tools/call, scans resources, " +
    "and checks for rug-pull tool description mutations. " +
    "Produces HTML + JSON reports with a safety score.",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opforExecuteSchemaShape as Record<string, any>,
  (async ({ input_path, output_dir }: { input_path: string; output_dir: string }) => {
    try {
      const raw = await readFile(path.resolve(input_path), "utf8");
      const plan = JSON.parse(raw) as Record<string, unknown>;

      const isMcpPlan = "server" in plan && "toolsDigest" in plan;

      if (isMcpPlan) {
        const result = await runMcpExecute({
          inputPath: input_path,
          outputDir: output_dir,
        });

        const failLines =
          result.failedAttacks.length > 0
            ? result.failedAttacks
                .slice(0, 5)
                .map(
                  (
                    f: {
                      evaluatorId: string;
                      toolName: string;
                      score: number;
                      reasoning: string;
                    },
                    i: number
                  ) =>
                    `  ${i + 1}. [${f.evaluatorId}] ${f.toolName} — Score ${f.score}/10 — ${f.reasoning}`
                )
                .join("\n")
            : "  None";

        return {
          content: [
            {
              type: "text",
              text: [
                `✅ MCP red team scan complete!`,
                ``,
                `Mode:         MCP server red-teaming (auto-detected from plan)`,
                `Safety score: ${result.safetyScore}%`,
                `Tests:        ${result.total} (${result.passed} passed, ${result.failed} failed, ${result.errors} errors)`,
                ``,
                `Vulnerabilities found${result.failedAttacks.length > 5 ? ` (top 5 of ${result.failedAttacks.length})` : ""}:`,
                failLines,
                ...(result.rugPullCount > 0
                  ? [
                      ``,
                      `Rug-pull mutations detected: ${result.rugPullCount} tool(s) changed descriptions at runtime`,
                    ]
                  : []),
                ``,
                `Reports:`,
                `  HTML: ${result.htmlReport}`,
                `  JSON: ${result.jsonReport}`,
              ].join("\n"),
            },
          ],
        };
      }

      // Agent/chatbot execution
      const agentResult = await runScan({
        inputPath: input_path,
        outputDir: output_dir,
      });

      const findingLines =
        agentResult.criticalFindings.length > 0
          ? agentResult.criticalFindings
              .slice(0, 5)
              .map(
                (f: { evaluator: string; score: number; description: string }, i: number) =>
                  `  ${i + 1}. ${f.evaluator} — Score ${f.score}/10 — ${f.description}`
              )
              .join("\n")
          : "  None";

      const evalLines = agentResult.evaluatorResults
        .map(
          (e: { ref: string; name: string; passed: number; failed: number; passRate: number }) =>
            `  [${e.ref}] ${e.name}: ${e.passed}✓ ${e.failed}✗ (${e.passRate}% pass)`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Agent red team scan complete!`,
              ``,
              `Mode:         Agent/chatbot red-teaming`,
              `Target:       ${agentResult.target}`,
              `Endpoint:     ${agentResult.endpoint}`,
              `Tests run:    ${agentResult.totalAttacks}`,
              `Passed:       ${agentResult.passed}`,
              `Failed:       ${agentResult.failed}`,
              `Safety score: ${agentResult.safetyScore}%`,
              ``,
              `Evaluator Results:`,
              evalLines,
              ``,
              `Critical Findings${agentResult.criticalFindings.length > 5 ? ` (top 5 of ${agentResult.criticalFindings.length})` : ""}:`,
              findingLines,
              ``,
              `Reports:`,
              `  HTML: ${agentResult.htmlReport}`,
              `  JSON: ${agentResult.jsonReport}`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Execute failed: ${msg}` }],
        isError: true,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
);

// ---------------------------------------------------------------------------
// Start server on stdio
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
