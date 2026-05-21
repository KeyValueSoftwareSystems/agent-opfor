import type { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { input, select, checkbox, password, confirm } from "@inquirer/prompts";
import { log } from "@opfor/core/lib/logger.js";
import { loadSkillCatalog } from "@opfor/core/config/loadSkillCatalog.js";
import {
  PROVIDERS,
  PROVIDER_CHOICES,
  type LlmConfig,
  type ProviderName,
} from "@opfor/core/config/types.js";
import { PROVIDER_DEFAULTS, PROVIDER_ENV_VARS } from "@opfor/core/providers/factory.js";
import type {
  RunConfig,
  UnifiedTargetConfig,
  AgentTargetConfig,
  McpTargetConfig,
  EvaluatorSelection,
  Effort,
} from "@opfor/core/execute/types.js";

export const DEFAULT_CONFIG_PATH = "opfor.config.json";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description(
      "Interactive wizard — configure target, evaluators, and effort level; writes opfor.config.json"
    )
    .option("--config <path>", "Path to write config", DEFAULT_CONFIG_PATH)
    .option("--env <path>", "Path to .env file to load")
    .action(async (opts: { config: string; env?: string }) => {
      if (opts.env) {
        const { config: loadDotenv } = await import("dotenv");
        loadDotenv({ path: path.resolve(opts.env) });
      }

      log.info("\nOpfor Setup — configure your red team run");
      log.info("─".repeat(50));

      const config = await runSetupWizard();
      const outPath = path.resolve(opts.config);
      await writeFile(outPath, JSON.stringify(config, null, 2), "utf8");

      log.success(`\nConfig written → ${outPath}`);
      log.info(`Next: opfor execute --config ${outPath}`);
    });
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

async function runSetupWizard(): Promise<RunConfig> {
  const attackLlm = await collectLlmConfig("Attack LLM (generates attacks)");

  const separateJudge = await confirm({
    message: "Use a separate LLM for judging? (default: reuse attack LLM)",
    default: false,
  });
  const judgeLlm = separateJudge
    ? await collectLlmConfig("Judge LLM (scores responses)")
    : undefined;

  const targetKind = await select<"agent" | "mcp">({
    message: "\nTarget type",
    choices: [
      { name: "AI agent / chatbot  (HTTP endpoint or local script)", value: "agent" },
      { name: "MCP server  (stdio or HTTP/SSE transport)", value: "mcp" },
    ],
  });

  const target: UnifiedTargetConfig =
    targetKind === "agent" ? await collectAgentTarget() : await collectMcpTarget();

  const selection = await collectEvaluatorSelection();

  const effort = await select<Effort>({
    message: "\nEffort level",
    choices: [
      {
        name: "Adaptive      — one sustained chat per evaluator, attacker picks tactics on the fly",
        value: "adaptive",
      },
      {
        name: "Comprehensive — one fresh multi-turn attack per named pattern in each evaluator",
        value: "comprehensive",
      },
    ],
  });

  const multiTurn = await confirm({
    message: "Enable multi-turn? (each attack gets follow-up escalation turns)",
    default: false,
  });
  let turns = 1;
  if (multiTurn) {
    const raw = await input({
      message: "Turns per attack (2–10)",
      default: "3",
      validate: (v) => {
        const n = parseInt(v, 10);
        return n >= 2 && n <= 10 ? true : "Enter a number between 2 and 10";
      },
    });
    turns = parseInt(raw, 10);
  }

  return { target, selection, attackLlm, judgeLlm, effort, turns };
}

// ---------------------------------------------------------------------------
// LLM config
// ---------------------------------------------------------------------------

async function collectLlmConfig(label: string): Promise<LlmConfig> {
  log.info(`\n${label}`);

  const provider = await select<ProviderName>({
    message: "Provider",
    choices: PROVIDER_CHOICES,
  });

  const defaultModel = PROVIDER_DEFAULTS[provider];
  const model = await input({
    message: "Model",
    default: defaultModel || undefined,
    validate: (v) => (v.trim() ? true : "Model name is required"),
  });

  const defaultEnvVar = PROVIDER_ENV_VARS[provider];
  const apiKeyEnv = await input({
    message: "API key env var name",
    default: defaultEnvVar,
    validate: (v) => (v.trim() ? true : "Env var name is required"),
  });

  let baseURL: string | undefined;
  if (provider === PROVIDERS.AZURE || provider === PROVIDERS.OPENAI_COMPATIBLE) {
    baseURL = await input({
      message: "Base URL (required for this provider)",
      validate: (v) => (v.trim() ? true : "Base URL is required"),
    });
  }

  return { provider, model: model.trim(), apiKeyEnv: apiKeyEnv.trim(), baseURL };
}

// ---------------------------------------------------------------------------
// Agent target
// ---------------------------------------------------------------------------

async function collectAgentTarget(): Promise<AgentTargetConfig> {
  log.info("\nAgent target");

  const name = await input({
    message: "Target name",
    validate: (v) => (v.trim() ? true : "Required"),
  });
  const description = await input({
    message: "Target description (what does this AI system do?)",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  const type = await select<"http-endpoint" | "local-script">({
    message: "Target type",
    choices: [
      { name: "HTTP endpoint", value: "http-endpoint" },
      { name: "Local script (Node.js or Python — stdin/stdout JSON)", value: "local-script" },
    ],
  });

  if (type === "local-script") {
    const scriptPath = await input({
      message: "Script path (.js, .mjs, or .py)",
      validate: (v) => (v.trim() ? true : "Required"),
    });
    return {
      kind: "agent",
      name: name.trim(),
      description: description.trim(),
      type,
      scriptPath: scriptPath.trim(),
    };
  }

  const endpoint = await input({
    message: "Endpoint URL",
    validate: (v) => {
      try {
        new URL(v.trim());
        return true;
      } catch {
        return "Enter a valid URL";
      }
    },
  });

  const requestFormat = await select<"auto" | "openai" | "json">({
    message: "Request format",
    choices: [
      { name: "Auto (try OpenAI chat completions, fall back to { prompt })", value: "auto" },
      { name: "OpenAI chat completions", value: "openai" },
      { name: 'Generic JSON  { "prompt": "..." }', value: "json" },
    ],
  });

  const hasApiKey = await confirm({
    message: "Does the target require an API key?",
    default: false,
  });
  const targetApiKey = hasApiKey ? await password({ message: "API key value" }) : undefined;

  const hasSession = await confirm({
    message: "Inject a session ID per attack for multi-turn state tracking?",
    default: false,
  });
  const sessionIdField = hasSession
    ? await input({ message: "Session ID field name in request body", default: "session_id" })
    : undefined;

  return {
    kind: "agent",
    name: name.trim(),
    description: description.trim(),
    type,
    endpoint: endpoint.trim(),
    requestFormat,
    targetApiKey,
    sessionIdField,
  };
}

// ---------------------------------------------------------------------------
// MCP target
// ---------------------------------------------------------------------------

async function collectMcpTarget(): Promise<McpTargetConfig> {
  log.info("\nMCP target");

  const name = await input({
    message: "Target name",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  const transport = await select<"stdio" | "url">({
    message: "Transport",
    choices: [
      { name: "stdio — start a local process", value: "stdio" },
      { name: "url  — connect to a running HTTP/SSE server", value: "url" },
    ],
  });

  if (transport === "url") {
    const url = await input({
      message: "Server URL",
      validate: (v) => {
        try {
          new URL(v.trim());
          return true;
        } catch {
          return "Enter a valid URL";
        }
      },
    });
    return { kind: "mcp", name: name.trim(), transport, url: url.trim() };
  }

  const command = await input({
    message: "Command (e.g. node dist/server.js  or  python server.py)",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  const argsRaw = await input({
    message: "Additional args (space-separated, blank = none)",
    default: "",
  });
  const args = argsRaw.trim() ? argsRaw.trim().split(/\s+/) : [];

  const hasEnv = await confirm({
    message: "Set env vars for the MCP server process?",
    default: false,
  });
  let env: Record<string, string> | undefined;
  if (hasEnv) {
    const envRaw = await input({
      message: "KEY=VALUE pairs, comma-separated (e.g. PORT=3000,DEBUG=true)",
    });
    env = Object.fromEntries(
      envRaw
        .split(",")
        .filter((s) => s.includes("="))
        .map((pair) => {
          const eq = pair.indexOf("=");
          return [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
        })
    );
  }

  return { kind: "mcp", name: name.trim(), transport, command: command.trim(), args, env };
}

// ---------------------------------------------------------------------------
// Evaluator selection
// ---------------------------------------------------------------------------

async function collectEvaluatorSelection(): Promise<EvaluatorSelection> {
  log.info("\nEvaluator selection");

  const { suites, evaluators } = await loadSkillCatalog();

  const mode = await select<"suite" | "evaluators">({
    message: "Select by",
    choices: [
      { name: `Suite  (${suites.length} suites available)`, value: "suite" },
      { name: "Individual evaluators", value: "evaluators" },
    ],
  });

  if (mode === "suite") {
    const suite = await select<string>({
      message: "Suite",
      choices: suites.map((s) => ({
        name: `${s.name}  —  ${s.description}  (${s.evaluatorIds.length} evaluators)`,
        value: s.id,
      })),
    });
    return { mode: "suite", suite };
  }

  const ids = await checkbox<string>({
    message: "Evaluators (space = toggle, enter = confirm)",
    choices: evaluators.map((e) => ({
      name: `[${e.severity.toUpperCase().padEnd(8)}] ${e.name}`,
      value: e.id,
    })),
    validate: (v) => (v.length > 0 ? true : "Select at least one evaluator"),
  });

  return { mode: "evaluators", evaluators: ids };
}
