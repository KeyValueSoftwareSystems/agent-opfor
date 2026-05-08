import { input, select, confirm } from "@inquirer/prompts";
import type {
  SetupConfigFile,
  ProviderName,
  TargetConfig,
} from "../../../../core/dist/config/types.js";
import { PROVIDER_CHOICES } from "../../../../core/dist/config/types.js";
import { PROVIDER_DEFAULTS, PROVIDER_ENV_VARS } from "../../../../core/dist/providers/factory.js";
import { loadSkillCatalog } from "../../../../core/dist/config/loadSkillCatalog.js";

export function buildEmptyAgentSetupConfig(): SetupConfigFile {
  return {
    attackLlm: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKeyEnv: "OPENAI_API_KEY",
    },
    target: {
      name: "My AI Agent",
      description:
        "Describe your application here. Include: what it does, types of users, sensitive data it handles, dangerous actions it can perform, topics it should never discuss.",
      type: "http-endpoint",
      endpoint: "http://localhost:4000/chat",
      requestFormat: "openai",
      targetModel: "gpt-4o-mini",
    } as TargetConfig,
    selection: {
      mode: "suite",
      suite: "owasp-llm-top10",
    },
    turnMode: "single",
    telemetry: {
      provider: "none",
    },
  };
}

export async function collectAgentSetupConfigInteractive(): Promise<SetupConfigFile> {
  const catalog = await loadSkillCatalog();

  const provider = await select<ProviderName>({
    message: "LLM provider for attack generation:",
    choices: PROVIDER_CHOICES,
  });

  const model = await input({
    message: "Model name:",
    default: PROVIDER_DEFAULTS[provider] || undefined,
    validate: (v) => (v.trim() ? true : "Model is required"),
  });

  const targetType = await select<"http-endpoint" | "local-script">({
    message: "Target type:",
    choices: [
      { name: "HTTP endpoint", value: "http-endpoint" },
      { name: "Local script (stdin JSON → stdout JSON)", value: "local-script" },
    ],
  });

  const name = await input({
    message: "Target name:",
    validate: (v) => (v.trim() ? true : "Required"),
  });
  const description = await input({
    message: "Target description (what it does, sensitive data, forbidden topics):",
    validate: (v) => (v.trim() ? true : "Required"),
  });

  let target: TargetConfig = { name, description, type: targetType };

  if (targetType === "http-endpoint") {
    const endpoint = await input({
      message: "Endpoint URL:",
      default: "http://localhost:4000/chat",
      validate: (v) => (v.trim().startsWith("http") ? true : "Must be a valid URL"),
    });
    const requestFormat = await select<"openai" | "json">({
      message: "Request format:",
      choices: [
        { name: "openai (POST {model, messages})", value: "openai" },
        { name: "json (POST {prompt})", value: "json" },
      ],
    });
    const targetModel = await input({
      message: "Model name to send in request body (OpenAI-compat endpoints):",
      default: "gpt-4o-mini",
    });
    target = {
      ...target,
      endpoint,
      requestFormat,
      targetModel,
      // Intentionally leave targetApiKey empty in config; use --env/.env at runtime.
    };
  } else {
    const scriptPath = await input({
      message: "Path to local script (.js or .py):",
      default: "./astra-local-target.js",
      validate: (v) => (v.trim() ? true : "Required"),
    });
    target = { ...target, scriptPath: scriptPath.trim() };
  }

  // Selection: suite only (fast). We can add individual evaluator pick later.
  const suites = catalog.suites;
  const suiteId = await select<string>({
    message: "Select a suite:",
    choices: suites.map((s) => ({ name: `${s.name} — ${s.description}`, value: s.id })),
  });

  const turnMode = await select<"single" | "multi">({
    message: "Attack mode:",
    choices: [
      { name: "Single-turn", value: "single" },
      { name: "Multi-turn", value: "multi" },
    ],
  });
  let turns: number | undefined;
  if (turnMode === "multi") {
    const turnsStr = await input({
      message: "Number of turns per attack (2–10):",
      default: "3",
      validate: (v) => {
        const n = parseInt(v, 10);
        return Number.isInteger(n) && n >= 2 && n <= 10 ? true : "Enter a number between 2 and 10";
      },
    });
    turns = parseInt(turnsStr, 10);
  }

  const useSeperateJudge = await confirm({
    message: "Use a different model for judging responses? (default: same as attack model)",
    default: false,
  });

  let judgeLlm: { provider: ProviderName; model: string; apiKeyEnv: string } | undefined;
  if (useSeperateJudge) {
    const judgeProvider = await select<ProviderName>({
      message: "LLM provider for judging:",
      choices: PROVIDER_CHOICES,
    });
    const judgeModel = await input({
      message: "Judge model name:",
      default: PROVIDER_DEFAULTS[judgeProvider] || undefined,
      validate: (v) => (v.trim() ? true : "Model is required"),
    });
    judgeLlm = {
      provider: judgeProvider,
      model: judgeModel.trim(),
      apiKeyEnv: PROVIDER_ENV_VARS[judgeProvider],
    };
  }

  const addTelemetry = await confirm({
    message: "Enable telemetry integration (Langfuse / Netra)?",
    default: false,
  });

  return {
    attackLlm: { provider, model: model.trim(), apiKeyEnv: PROVIDER_ENV_VARS[provider] },
    ...(judgeLlm ? { judgeLlm } : {}),
    target,
    selection: { mode: "suite", suite: suiteId },
    turnMode,
    ...(turns ? { turns } : {}),
    telemetry: addTelemetry ? { provider: "langfuse" } : { provider: "none" },
  };
}
