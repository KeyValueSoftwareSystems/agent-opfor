#!/usr/bin/env node

// Load .env from the project the MCP server is running against.
// This lets users store GROQ_API_KEY (etc.) in their project's .env
// without having to add it to the MCP config manually.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadSkillCatalog, resolveSuiteEvaluatorIds, getEvaluatorIdSet } from "@astra/core/config/loadSkillCatalog";
import { runSetup, runSetupInline } from "./core/setup.js";
import { runScan } from "./core/run.js";

const server = new McpServer({
  name: "astra",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: astra_list_evaluators
// Lists all available evaluators and suites so the agent can pick them by id.
// ---------------------------------------------------------------------------

server.tool(
  "astra_list_evaluators",
  "List all available Astra evaluators and suites. " +
  "Call this first to discover evaluator IDs before calling astra_setup. " +
  "Returns each evaluator's id, name, severity, OWASP tag, and description, " +
  "plus the list of predefined suites (owasp-llm-top10, owasp-agentic-ai).",
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
        (e) =>
          `  ${e.id}  [${e.severity.toUpperCase()}]  ${e.name}\n` +
          `    OWASP: ${e.owasp ?? "—"}`
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
              `Pass evaluator ids or a suite id to astra_setup.`,
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
// Tool: astra_setup
//
// Accepts EITHER:
//   A) config_path — path to an astra config file (backward-compatible)
//   B) Inline parameters — target_*, selection_*, llm_* — no file needed
//
// When both are supplied, inline parameters take precedence.
// ---------------------------------------------------------------------------

server.tool(
  "astra_setup",
  "Generate targeted red-team attack prompts for an AI application. " +
  "You can provide all configuration inline (preferred) or point to a config file. " +
  "Call astra_list_evaluators first if you are unsure which evaluator ids to pass. " +
  "When use_langfuse=true and LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are set in the " +
  "environment, astra fetches production traces and uses them to make attack prompts " +
  "more realistic and targeted. Returns the path to the prompts file — pass it to astra_run.",
  {
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
        "Optional when use_langfuse=true — astra infers this from traces."
      ),

    target_endpoint: z
      .string()
      .optional()
      .describe("HTTP endpoint to attack (e.g. 'http://localhost:4000/chat'). Required when target_type='http-endpoint'."),

    target_type: z
      .enum(["http-endpoint", "local-script"])
      .optional()
      .default("http-endpoint")
      .describe("How astra sends attacks. 'http-endpoint' for HTTP, 'local-script' for subprocess."),

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
      .describe("API key for the target endpoint itself (not for the LLM used by astra)."),

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
        "Mutually exclusive with evaluator_ids. Call astra_list_evaluators to see options."
      ),

    evaluator_ids: z
      .array(z.string())
      .optional()
      .describe(
        "Specific evaluator ids to run (e.g. ['prompt-injection','excessive-agency']). " +
        "Mutually exclusive with suite. Call astra_list_evaluators to see all ids."
      ),

    // ── LLM for attack generation ───────────────────────────────────────────
    llm_provider: z
      .enum(["groq", "openai", "anthropic", "google", "other"])
      .optional()
      .describe(
        "LLM provider astra uses to generate attack prompts and judge responses. " +
        "Defaults to 'groq'. The corresponding API key env var must be set, or pass llm_api_key."
      ),

    llm_model: z
      .string()
      .optional()
      .describe("Model name for the LLM (e.g. 'llama-3.3-70b-versatile'). Uses provider default if omitted."),

    llm_api_key: z
      .string()
      .optional()
      .describe(
        "API key for the attack/judge LLM. Overrides env vars " +
        "(GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY)."
      ),

    // ── Langfuse / traces ───────────────────────────────────────────────────
    use_langfuse: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, astra reads production traces from Langfuse to: " +
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
      .describe("Explicit list of Langfuse trace IDs to use instead of the automatic lookback window."),

    // ── Config file (backward-compatible) ──────────────────────────────────
    config_path: z
      .string()
      .optional()
      .describe(
        "Path to an astra config file (JSON or YAML). " +
        "Used when inline parameters are not provided. " +
        "Inline parameters take precedence if both are supplied."
      ),

    output_dir: z
      .string()
      .optional()
      .default(".")
      .describe("Directory where astra-prompts-*.json will be written. Defaults to current directory."),
  },
  async (args) => {
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
      llm_api_key,
      use_langfuse = false,
      langfuse_lookback_hours,
      langfuse_trace_ids,
      config_path,
      output_dir = ".",
    } = args;

    try {
      const usingInline = !!target_name;

      if (!usingInline && !config_path) {
        return {
          content: [{
            type: "text",
            text:
              "❌ Provide either inline parameters (target_name, evaluator_ids or suite, etc.) " +
              "or a config_path pointing to an astra config file.",
          }],
          isError: true,
        };
      }

      // Validate evaluator selection when using inline mode
      if (usingInline && !suite && (!evaluator_ids || evaluator_ids.length === 0)) {
        return {
          content: [{
            type: "text",
            text:
              "❌ Provide either suite (e.g. 'owasp-llm-top10') or evaluator_ids. " +
              "Call astra_list_evaluators to see available options.",
          }],
          isError: true,
        };
      }

      let result;

      if (usingInline) {
        const selection = suite
          ? { mode: "suite" as const, suite }
          : { mode: "evaluators" as const, evaluators: evaluator_ids! };

        // Build optional telemetry override when Langfuse details are provided
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

        result = await runSetupInline(
          {
            target: {
              name: target_name,
              description: target_description,
              type: target_type,
              endpoint: target_endpoint,
              requestFormat: target_request_format,
              targetApiKey: target_api_key,
              scriptPath: target_script_path,
            },
            selection,
            llm: llm_provider || llm_model || llm_api_key
              ? {
                  ...(llm_provider ? { provider: llm_provider } : {}),
                  ...(llm_model ? { model: llm_model } : {}),
                  ...(llm_api_key ? { apiKey: llm_api_key } : {}),
                }
              : undefined,
            useLangfuse: use_langfuse,
            telemetry: telemetryOverride,
          },
          output_dir
        );
      } else {
        result = await runSetup({
          configPath: config_path!,
          apiKey: llm_api_key,
          outputDir: output_dir,
        });
      }

      // Build human-readable status lines for trace curation
      const traceLines: string[] = [];
      if (result.traceCurationRan) {
        if (result.traceCurationError) {
          traceLines.push(`⚠️  Trace curation failed: ${result.traceCurationError}`);
          traceLines.push(`   Attacks were generated without trace grounding.`);
        } else {
          traceLines.push(`✅ Traces analysed — attacks grounded in real usage.`);
          if (result.traceSummaryPath) {
            traceLines.push(`   Trace summary: ${result.traceSummaryPath}`);
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Setup complete!`,
              ``,
              `Provider:       ${result.provider} / ${result.model}`,
              `Evaluators:     ${result.evaluatorCount}`,
              `Attack prompts: ${result.totalAttacks}`,
              `Prompts file:   ${result.promptsFilePath}`,
              ...(traceLines.length > 0 ? [``, ...traceLines] : []),
              ``,
              `Next step: call astra_run with input_path="${result.promptsFilePath}"`,
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
  }
);

// ---------------------------------------------------------------------------
// Tool: astra_run
// ---------------------------------------------------------------------------

server.tool(
  "astra_run",
  "Execute a red team scan using a prompts file generated by astra_setup. " +
  "Fires each attack prompt at the target endpoint, judges every response with an LLM (PASS/FAIL), " +
  "and generates HTML + JSON reports. Returns a full summary of findings.",
  {
    input_path: z
      .string()
      .describe("Path to the astra-prompts-*.json file produced by astra_setup."),
    api_key: z
      .string()
      .optional()
      .describe(
        "LLM API key for judging responses (overrides the key stored in the prompts file). " +
        "Useful when running in CI without committing keys."
      ),
    output_dir: z
      .string()
      .optional()
      .default(".astra/reports")
      .describe("Directory where HTML and JSON reports will be written. Defaults to .astra/reports."),
  },
  async ({ input_path, api_key, output_dir }) => {
    try {
      const result = await runScan({
        inputPath: input_path,
        apiKey: api_key,
        outputDir: output_dir,
      });

      const findingLines = result.criticalFindings.length > 0
        ? result.criticalFindings
            .slice(0, 5)
            .map((f, i) => `  ${i + 1}. ${f.evaluator} — Score ${f.score}/10 — ${f.description}`)
            .join("\n")
        : "  None";

      const evalLines = result.evaluatorResults
        .map(e => `  [${e.owasp}] ${e.name}: ${e.passed}✓ ${e.failed}✗ (${e.passRate}% pass)`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Red team scan complete!`,
              ``,
              `Target:       ${result.target}`,
              `Endpoint:     ${result.endpoint}`,
              `Tests run:    ${result.totalAttacks}`,
              `Passed:       ${result.passed}`,
              `Failed:       ${result.failed}`,
              `Safety score: ${result.safetyScore}%`,
              ``,
              `Evaluator Results:`,
              evalLines,
              ``,
              `🔴 Critical Findings${result.criticalFindings.length > 5 ? ` (top 5 of ${result.criticalFindings.length})` : ""}:`,
              findingLines,
              ``,
              `Reports:`,
              `  HTML: ${result.htmlReport}`,
              `  JSON: ${result.jsonReport}`,
            ].join("\n"),
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Run failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start server on stdio
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
