import { runAll } from "@opfor/core";
import type {
  RunConfig,
  AgentTargetConfig,
  McpTargetConfig,
  EvaluatorSelection,
} from "@opfor/core";
import type { LlmConfig, ProviderName } from "@opfor/core/config/types.js";
import type {
  ExecuteOptions,
  ExecuteResults,
  TargetConfig,
  ModelSpec,
  Finding,
  AttackResult,
  EvaluatorResult,
} from "./types.js";

const DEFAULT_PROVIDER: ProviderName = "anthropic";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Execute adversarial tests against a target.
 *
 * This is the functional API - pass all configuration in options.
 */
export async function execute(options: ExecuteOptions): Promise<ExecuteResults> {
  const runConfig = buildRunConfig(options);

  const coreReport = await runAll(runConfig, {
    onProgress: options.onProgress,
  });

  return transformReport(coreReport);
}

/**
 * Build a RunConfig from SDK ExecuteOptions
 */
export function buildRunConfig(options: ExecuteOptions): RunConfig {
  const target = buildTargetConfig(options.target);
  const selection = buildSelection(options);
  const attackerLlm = buildLlmConfig(options.attackerModel, options.apiKey);
  const judgeLlm = options.judgeModel
    ? buildLlmConfig(options.judgeModel, options.apiKey)
    : undefined;

  const effort = options.strategy?.effort ?? "adaptive";
  const turns = options.strategy?.turns ?? 3;
  const turnMode = options.strategy?.turnMode ?? (turns > 1 ? "multi" : "single");

  return {
    target,
    selection,
    attackerLlm,
    judgeLlm,
    effort,
    turns,
    turnMode,
    telemetry: options.telemetry,
  };
}

function buildTargetConfig(target: TargetConfig): AgentTargetConfig | McpTargetConfig {
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

  const httpTarget = target as import("./types.js").HttpTargetConfig;

  return {
    kind: "agent",
    name: httpTarget.name ?? new URL(httpTarget.url).hostname,
    description: httpTarget.description ?? "",
    type: "http-endpoint",
    endpoint: httpTarget.url,
    apiKeyEnv: httpTarget.apiKeyEnv,
    model: httpTarget.model,
    headers: httpTarget.headers,
    requestFormat: httpTarget.requestFormat ?? "auto",
    promptPath: httpTarget.promptPath,
    responsePath: httpTarget.responsePath,
    stateful: httpTarget.stateful,
    sessionIdField: httpTarget.sessionField,
  };
}

function buildSelection(options: ExecuteOptions): EvaluatorSelection {
  if (options.evaluators?.length) {
    return { mode: "evaluators", evaluators: options.evaluators };
  }

  return { mode: "suite", suite: options.suite ?? "owasp-llm-top10" };
}

function buildLlmConfig(model: ModelSpec | undefined, defaultApiKey?: string): LlmConfig {
  if (!model) {
    return {
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      apiKeyEnv: defaultApiKey ? "" : "ANTHROPIC_API_KEY",
    };
  }

  if (typeof model === "string") {
    const provider = inferProvider(model);
    return {
      provider,
      model,
      apiKeyEnv: defaultApiKey ? "" : getDefaultApiKeyEnv(provider),
    };
  }

  return {
    provider: model.provider,
    model: model.model,
    apiKeyEnv: model.apiKeyEnv ?? (defaultApiKey ? "" : getDefaultApiKeyEnv(model.provider)),
    baseURL: model.baseUrl,
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

function getDefaultApiKeyEnv(provider: ProviderName): string {
  const envVars: Record<ProviderName, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    azure: "AZURE_API_KEY",
    "openai-compatible": "LLM_API_KEY",
  };
  return envVars[provider] ?? "ANTHROPIC_API_KEY";
}

function transformReport(coreReport: import("@opfor/core").UnifiedRunReport): ExecuteResults {
  const findings = extractFindings(coreReport);
  const evaluators = coreReport.evaluators.map(transformEvaluatorResult);

  return {
    id: coreReport.reportId,
    timestamp: coreReport.generatedAt,
    targetName: coreReport.targetName,
    targetKind: coreReport.targetKind,
    effort: coreReport.effort,
    attackerModel: coreReport.attackModel,
    judgeModel: coreReport.judgeModel,
    score: coreReport.summary.safetyScore,
    summary: coreReport.summary,
    findings,
    evaluators,
  };
}

function extractFindings(report: import("@opfor/core").UnifiedRunReport): Finding[] {
  const findings: Finding[] = [];

  for (const evaluator of report.evaluators) {
    for (const attack of evaluator.attacks) {
      if (attack.judge.verdict === "FAIL") {
        findings.push({
          id: attack.attackId,
          evaluatorId: evaluator.evaluatorId,
          patternName: attack.patternName,
          severity: evaluator.severity as Finding["severity"],
          title: `${evaluator.evaluatorName}: ${attack.patternName}`,
          description: attack.judge.reasoning ?? "",
          evidence: attack.judge.evidence,
          standards: evaluator.standards,
        });
      }
    }
  }

  return findings;
}

function transformEvaluatorResult(core: import("@opfor/core").EvaluatorResult): EvaluatorResult {
  return {
    evaluatorId: core.evaluatorId,
    evaluatorName: core.evaluatorName,
    severity: core.severity,
    standards: core.standards,
    total: core.total,
    passed: core.passed,
    failed: core.failed,
    errors: core.errors,
    passRate: core.passRate,
    attacks: core.attacks.map(transformAttackResult),
  };
}

function transformAttackResult(core: import("@opfor/core").AttackResult): AttackResult {
  return {
    attackId: core.attackId,
    evaluatorId: core.evaluatorId,
    patternName: core.patternName,
    prompt: core.prompt ?? core.toolName ?? "",
    response: core.response ?? core.toolResponse ?? "",
    verdict: core.judge.verdict,
    evidence: core.judge.evidence,
    turns: core.turns?.map((t) => {
      if (t.kind === "agent") {
        return {
          turnIndex: t.turnIndex,
          prompt: t.prompt,
          response: t.response,
        };
      }
      return {
        turnIndex: t.turnIndex,
        prompt: `[tool:${t.toolName}] ${JSON.stringify(t.toolArguments)}`,
        response: t.response,
      };
    }),
  };
}
