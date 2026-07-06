/**
 * Maps SDK RunOptions to core RunConfig. Internal — not part of the public API.
 */

import type {
  RunConfig,
  AgentTargetConfig,
  McpTargetConfig as CoreMcpTargetConfig,
  EvaluatorSelection,
} from "@keyvaluesystems/agent-opfor-core";
import type { LlmConfig, ProviderName } from "@keyvaluesystems/agent-opfor-core/config/types.js";
import {
  PROVIDER_ENV_VARS,
  PROVIDER_DEFAULTS,
} from "@keyvaluesystems/agent-opfor-core/providers/factory.js";
import type {
  RunOptions,
  TargetConfig,
  ModelSpec,
  HttpTargetConfig,
  McpTargetConfig,
} from "../types.js";

const DEFAULT_PROVIDER: ProviderName = "anthropic";
const DEFAULT_MODEL = PROVIDER_DEFAULTS[DEFAULT_PROVIDER];

export function buildRunConfig(options: RunOptions): {
  runConfig: RunConfig;
  env: Record<string, string>;
} {
  const target = buildTargetConfig(options.target);
  const selection = buildSelection(options);
  const attacker = buildLlmConfig(options.attackerModel, options.apiKey);
  const judge = options.judgeModel ? buildLlmConfig(options.judgeModel, options.apiKey) : undefined;

  const effort = options.strategy?.effort ?? "adaptive";
  const turns = options.strategy?.turns ?? 3;
  const turnMode = options.strategy?.turnMode ?? (turns > 1 ? "multi" : "single");

  const env = mergeEnvMaps(attacker.env, judge?.env);

  return {
    runConfig: {
      target,
      selection,
      attackerLlm: attacker.llm,
      judgeLlm: judge?.llm,
      effort,
      turns,
      turnMode,
      telemetry: options.telemetry,
    },
    env,
  };
}

function buildTargetConfig(target: TargetConfig): AgentTargetConfig | CoreMcpTargetConfig {
  if ("kind" in target && target.kind === "mcp") {
    return target as McpTargetConfig;
  }

  if ("type" in target && target.type === "local-script") {
    return {
      kind: "agent",
      name: target.name,
      description: target.description ?? "",
      type: "local-script",
      scriptPath: target.scriptPath,
    };
  }

  const httpTarget = target as HttpTargetConfig;
  const headers: Record<string, string> = { ...(httpTarget.headers ?? {}) };
  if (httpTarget.apiKey) headers["Authorization"] = `Bearer ${httpTarget.apiKey}`;

  return {
    kind: "agent",
    name: httpTarget.name ?? new URL(httpTarget.url).hostname,
    description: httpTarget.description ?? "",
    type: "http-endpoint",
    endpoint: httpTarget.url,
    model: httpTarget.model,
    headers,
    requestFormat: httpTarget.requestFormat ?? "auto",
    promptPath: httpTarget.promptPath,
    responsePath: httpTarget.responsePath,
    stateful: httpTarget.stateful,
    sessionIdField: httpTarget.sessionField,
  };
}

function buildSelection(options: RunOptions): EvaluatorSelection {
  if (options.evaluators?.length) {
    return { mode: "evaluators", evaluators: options.evaluators };
  }

  return { mode: "suite", suite: options.suite ?? "owasp-llm-top10" };
}

function buildLlmConfig(
  model: ModelSpec | undefined,
  defaultApiKey?: string
): { llm: LlmConfig; env: Record<string, string> } {
  if (!model) {
    const envName = PROVIDER_ENV_VARS[DEFAULT_PROVIDER];
    return {
      llm: { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, apiKeyEnv: envName },
      env: defaultApiKey ? { [envName]: defaultApiKey } : {},
    };
  }

  if (typeof model === "string") {
    const provider = inferProvider(model);
    const envName = PROVIDER_ENV_VARS[provider];
    return {
      llm: { provider, model, apiKeyEnv: envName },
      env: defaultApiKey ? { [envName]: defaultApiKey } : {},
    };
  }

  const envName = PROVIDER_ENV_VARS[model.provider];
  const apiKey = model.apiKey ?? defaultApiKey;
  return {
    llm: {
      provider: model.provider,
      model: model.model,
      apiKeyEnv: envName,
      baseURL: model.baseUrl,
    },
    env: apiKey ? { [envName]: apiKey } : {},
  };
}

function inferProvider(model: string): ProviderName {
  const lower = model.toLowerCase();

  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic";
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) return "openai";
  if (lower.includes("gemini")) return "google";
  if (lower.includes("llama") || lower.includes("mixtral")) return "groq";
  if (lower.includes("deepseek")) return "deepseek";

  return "anthropic";
}

function mergeEnvMaps(
  a: Record<string, string>,
  b?: Record<string, string>
): Record<string, string> {
  if (!b) return { ...a };
  const out: Record<string, string> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    if (prev !== undefined && prev !== v) {
      throw new Error(
        `Conflicting API keys for ${k}. Provide a single shared key, or use the same value for attacker and judge.`
      );
    }
    out[k] = v;
  }
  return out;
}
