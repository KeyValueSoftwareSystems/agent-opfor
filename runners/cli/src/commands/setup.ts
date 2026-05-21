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
  type TelemetryConfig,
  type NetraTelemetryConfig,
  type LangfuseTelemetryConfig,
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
import { ensureOpforDirs, newConfigPath } from "../lib/artifacts.js";

export const DEFAULT_CONFIG_PATH = "opfor.config.json";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description(
      "Interactive wizard — configure target, evaluators, and effort level; writes opfor.config.json\n" +
        "  Use --agent/--mcp to skip the mode prompt, or --empty to write a minimal sample config."
    )
    .option("--config <path>", "Path to write config (default: .opfor/configs/<timestamped>.json)")
    .option("--env <path>", "Path to .env file to load")
    .option("--agent", "Target is an AI agent / HTTP endpoint (skips mode prompt)")
    .option("--mcp", "Target is an MCP server (skips mode prompt)")
    .option("--empty", "Write a minimal sample config without running the full wizard")
    .action(
      async (opts: {
        config?: string;
        env?: string;
        agent?: boolean;
        mcp?: boolean;
        empty?: boolean;
      }) => {
        if (opts.env) {
          const { config: loadDotenv } = await import("dotenv");
          loadDotenv({ path: path.resolve(opts.env) });
        }

        log.info("\nOpfor Setup — configure your red team run");
        log.info("─".repeat(50));

        const hint: "agent" | "mcp" | undefined = opts.agent
          ? "agent"
          : opts.mcp
            ? "mcp"
            : undefined;

        const config = opts.empty ? await buildEmptyConfig(hint) : await runSetupWizard(hint);

        // Write to .opfor/configs/<timestamped>.json unless an explicit path was given
        await ensureOpforDirs();
        const outPath = path.resolve(opts.config ?? newConfigPath());
        await writeFile(outPath, JSON.stringify(config, null, 2), "utf8");

        log.success(`\nConfig written → ${outPath}`);
        log.info(`Next: opfor execute --config ${outPath}`);
      }
    );
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

async function buildEmptyConfig(hint?: "agent" | "mcp"): Promise<RunConfig> {
  const kind =
    hint ??
    (await select<"agent" | "mcp">({
      message: "What do you want to test?",
      choices: [
        { name: "AI agent / chatbot  (HTTP endpoint or local script)", value: "agent" },
        { name: "MCP server  (stdio or HTTP/SSE transport)", value: "mcp" },
      ],
    }));

  const target: UnifiedTargetConfig =
    kind === "agent"
      ? {
          kind: "agent",
          name: "My AI Agent",
          description:
            "Describe your AI system here — what it does, who uses it, sensitive data it handles, actions it can perform.",
          type: "http-endpoint",
          endpoint: "http://localhost:4000/chat",
          requestFormat: "openai",
        }
      : {
          kind: "mcp",
          name: "My MCP Server",
          transport: "stdio",
          command: "node",
          args: ["dist/index.js"],
        };

  return {
    target,
    selection: { mode: "suite", suite: "owasp-llm-top10" },
    attackLlm: { provider: "openai", model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY" },
    effort: "adaptive",
    turnMode: kind === "agent" ? "multi" : "single",
    turns: kind === "agent" ? 3 : 1,
  };
}

async function runSetupWizard(targetKindHint?: "agent" | "mcp"): Promise<RunConfig> {
  const attackLlm = await collectLlmConfig("Attack LLM (generates attacks)");

  const separateJudge = await confirm({
    message: "Use a separate LLM for judging? (default: reuse attack LLM)",
    default: false,
  });
  const judgeLlm = separateJudge
    ? await collectLlmConfig("Judge LLM (scores responses)")
    : undefined;

  const targetKind =
    targetKindHint ??
    (await select<"agent" | "mcp">({
      message: "\nTarget type",
      choices: [
        { name: "AI agent / chatbot  (HTTP endpoint or local script)", value: "agent" },
        { name: "MCP server  (stdio or HTTP/SSE transport)", value: "mcp" },
      ],
    }));

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

  const turnMode = await select<"single" | "multi">({
    message: "\nAttack turn mode",
    choices: [
      { name: "single — one prompt, one response per attack", value: "single" },
      { name: "multi  — each attack gets follow-up escalation turns", value: "multi" },
    ],
  });

  let turns = 1;
  if (turnMode === "multi") {
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

  const telemetry = await collectTelemetryConfig();

  return { target, selection, attackLlm, judgeLlm, effort, turnMode, turns, telemetry };
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

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

async function collectTelemetryConfig(): Promise<TelemetryConfig | undefined> {
  const enable = await confirm({
    message: "\nEnable telemetry / observability? (Netra or Langfuse)",
    default: false,
  });
  if (!enable) return undefined;

  const provider = await select<"netra" | "langfuse">({
    message: "Telemetry provider",
    choices: [
      { name: "Netra", value: "netra" },
      { name: "Langfuse", value: "langfuse" },
    ],
  });

  const providerConfig =
    provider === "netra" ? await collectNetraTelemetry() : await collectLangfuseTelemetry();

  const enrichJudgeFromTrace = await confirm({
    message: "Enrich judge with trace data after each attack?",
    default: true,
  });

  const traceIdStrategy = await select<"per-attack" | "per-run">({
    message: "Trace ID strategy",
    choices: [
      { name: "per-attack — fresh trace ID for every attack", value: "per-attack" },
      { name: "per-run    — single trace ID across the whole run", value: "per-run" },
    ],
  });

  const propagateHeader = await confirm({
    message: "Propagate trace ID via HTTP header to the target?",
    default: true,
  });

  const propagation: TelemetryConfig["propagation"] = { traceIdStrategy };
  if (propagateHeader) {
    const headerName = await input({
      message: "Header name",
      default: "X-Trace-Id",
      validate: (v) => (v.trim() ? true : "Required"),
    });
    const headerValue = await input({
      message: "Header value template (placeholders: {{traceId}}, {{runId}}, {{attackIndex}})",
      default: "{{traceId}}",
      validate: (v) => (v.trim() ? true : "Required"),
    });
    propagation.headers = { [headerName.trim()]: headerValue.trim() };
  }

  return {
    provider,
    ...(provider === "netra"
      ? { netra: providerConfig as NetraTelemetryConfig }
      : { langfuse: providerConfig as LangfuseTelemetryConfig }),
    enrichJudgeFromTrace,
    propagation,
  };
}

async function collectNetraTelemetry(): Promise<NetraTelemetryConfig> {
  log.info("\nNetra telemetry");

  const baseUrl = await input({
    message: "Base URL",
    default: "http://localhost:3000",
    validate: (v) => {
      try {
        new URL(v.trim());
        return true;
      } catch {
        return "Enter a valid URL";
      }
    },
  });

  const apiKeyEnv = await input({
    message: "API key env var name",
    default: "NETRA_API_KEY",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  const lookbackRaw = await input({
    message: "Lookback hours for trace context",
    default: "24",
    validate: (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? true : "Enter a positive integer";
    },
  });

  const environment = await input({
    message: "Environment filter (blank to skip)",
    default: "",
  });

  return {
    baseUrl: baseUrl.trim(),
    apiKeyEnv: apiKeyEnv.trim(),
    traceSelection: {
      lookbackHours: parseInt(lookbackRaw, 10),
      ...(environment.trim() ? { environment: environment.trim() } : {}),
    },
  };
}

async function collectLangfuseTelemetry(): Promise<LangfuseTelemetryConfig> {
  log.info("\nLangfuse telemetry");

  const baseUrl = await input({
    message: "Base URL (blank to use SDK default https://cloud.langfuse.com)",
    default: "",
  });

  const publicKeyEnv = await input({
    message: "Public key env var name",
    default: "LANGFUSE_PUBLIC_KEY",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  const secretKeyEnv = await input({
    message: "Secret key env var name",
    default: "LANGFUSE_SECRET_KEY",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  const lookbackRaw = await input({
    message: "Lookback hours for trace context",
    default: "24",
    validate: (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? true : "Enter a positive integer";
    },
  });

  const environment = await input({
    message: "Environment filter (blank to skip)",
    default: "",
  });

  const cfg: LangfuseTelemetryConfig = {
    publicKeyEnv: publicKeyEnv.trim(),
    secretKeyEnv: secretKeyEnv.trim(),
    traceSelection: {
      lookbackHours: parseInt(lookbackRaw, 10),
      ...(environment.trim() ? { environment: environment.trim() } : {}),
    },
  };
  if (baseUrl.trim()) cfg.baseUrl = baseUrl.trim();
  return cfg;
}
