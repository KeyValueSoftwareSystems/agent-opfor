import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { loadBuiltinEvaluator } from "@astra/core/evaluators/parseEvaluator";
import { generateAttackPrompts } from "@astra/core/evaluators/generatePrompts";
import { createModel, PROVIDER_DEFAULTS, PROVIDER_ENV_VARS } from "@astra/core/providers/factory";
import {
  loadSkillCatalog,
  resolveSuiteEvaluatorIds,
  getEvaluatorIdSet,
} from "@astra/core/config/loadSkillCatalog";
import { resolveTelemetryEnv } from "@astra/core/config/resolveTelemetryEnv";
import { runSetupTraceCuration } from "@astra/core/telemetry/curation";
import type {
  AttackEntry,
  InlineSetupConfig,
  LlmConfig,
  PromptsFile,
  ProviderName,
  SetupConfigFile,
  TargetConfig,
  TelemetryConfig,
} from "@astra/core/config/types";

export interface SetupOptions {
  configPath: string;
  apiKey?: string;
  outputDir?: string;
}

export interface SetupResult {
  promptsFilePath: string;
  evaluatorCount: number;
  totalAttacks: number;
  provider: string;
  model: string;
  /** Whether trace curation ran during setup. */
  traceCurationRan: boolean;
  /** Set when curation was attempted but failed — explains why attacks may be less targeted. */
  traceCurationError?: string;
  /** Path to trace-summary.md when curation succeeded. */
  traceSummaryPath?: string;
}

export async function runSetup(opts: SetupOptions): Promise<SetupResult> {
  const { configPath, apiKey: apiKeyOverride, outputDir = "." } = opts;

  const raw = await readFile(path.resolve(configPath), "utf8");
  const ext = path.extname(configPath).toLowerCase();
  const cfg: SetupConfigFile = (ext === ".yml" || ext === ".yaml")
    ? parseYaml(raw) as SetupConfigFile
    : JSON.parse(raw) as SetupConfigFile;

  const catalog = await loadSkillCatalog();
  const { suites: SUITES } = catalog;
  const EVALUATOR_IDS = getEvaluatorIdSet(catalog);

  // Resolve evaluator IDs from suite or explicit list
  let selectedEvaluatorIds: string[];
  if (cfg.selection.mode === "suite") {
    selectedEvaluatorIds = resolveSuiteEvaluatorIds(cfg.selection.suite, SUITES);
  } else {
    const invalid = cfg.selection.evaluators.filter((id) => !EVALUATOR_IDS.has(id));
    if (invalid.length > 0) {
      throw new Error(`Unknown evaluator IDs in config: ${invalid.join(", ")}`);
    }
    selectedEvaluatorIds = cfg.selection.evaluators;
  }

  // Resolve API key: argument > config file > env var
  const provider: ProviderName = (cfg.llm?.provider as ProviderName) ?? "groq";
  const envVar = PROVIDER_ENV_VARS[provider];
  const apiKey = apiKeyOverride?.trim() || cfg.llm?.apiKey?.trim() || process.env[envVar] || "";
  if (!apiKey) {
    throw new Error(
      `No API key for provider "${provider}". ` +
      `Pass apiKey in the tool call, set llm.apiKey in the config, or set env var ${envVar}.`
    );
  }

  const llm: LlmConfig = {
    provider,
    model: cfg.llm?.model ?? PROVIDER_DEFAULTS[provider],
    apiKey,
    baseURL: cfg.llm?.baseURL,
  };

  const target = cfg.target as TargetConfig;
  const resolvedOutputDir = path.resolve(outputDir);
  await mkdir(resolvedOutputDir, { recursive: true });

  const telemetry = resolveTelemetryEnv(cfg.telemetry);
  const model = createModel(llm);

  return runSetupCore({
    llm,
    target,
    telemetry,
    model,
    selectedEvaluatorIds,
    resolvedOutputDir,
    turnMode: cfg.turnMode,
    turns: cfg.turns,
  });
}

// ---------------------------------------------------------------------------
// runSetupInline — no config file; called directly by the MCP astra_setup tool
// ---------------------------------------------------------------------------

export async function runSetupInline(
  inline: InlineSetupConfig,
  outputDir = "."
): Promise<SetupResult> {
  const catalog = await loadSkillCatalog();
  const { suites: SUITES } = catalog;
  const EVALUATOR_IDS = getEvaluatorIdSet(catalog);

  let selectedEvaluatorIds: string[];
  if (inline.selection.mode === "suite") {
    selectedEvaluatorIds = resolveSuiteEvaluatorIds(inline.selection.suite, SUITES);
  } else {
    const invalid = inline.selection.evaluators.filter((id) => !EVALUATOR_IDS.has(id));
    if (invalid.length > 0) {
      throw new Error(`Unknown evaluator IDs: ${invalid.join(", ")}`);
    }
    selectedEvaluatorIds = inline.selection.evaluators;
  }

  const provider: ProviderName = (inline.llm?.provider as ProviderName) ?? "groq";
  const envVar = PROVIDER_ENV_VARS[provider];
  const apiKey = inline.llm?.apiKey?.trim() || process.env[envVar] || "";
  if (!apiKey) {
    throw new Error(
      `No API key for provider "${provider}". ` +
      `Pass llm.apiKey in the tool call or set env var ${envVar}.`
    );
  }

  const llm: LlmConfig = {
    provider,
    model: inline.llm?.model ?? PROVIDER_DEFAULTS[provider],
    apiKey,
    baseURL: inline.llm?.baseURL,
  };

  // Build telemetry: explicit block wins; fall back to useLangfuse shortcut
  let telemetry: TelemetryConfig | undefined = inline.telemetry;
  if (!telemetry && inline.useLangfuse) {
    // Keys are read from the env vars at runtime by the Langfuse client —
    // we only store the env var names here to avoid embedding secrets in objects.
    if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
      telemetry = {
        provider: "langfuse",
        langfuse: {
          publicKeyEnv: "LANGFUSE_PUBLIC_KEY",
          secretKeyEnv: "LANGFUSE_SECRET_KEY",
          baseUrlEnv: "LANGFUSE_BASE_URL",
          traceSelection: { lookbackHours: 24 },
        },
        enrichJudgeFromTrace: true,
        propagation: {
          headers: { "X-Langfuse-Trace-Id": "{traceId}" },
        },
      };
    }
  }
  const resolvedTelemetry = resolveTelemetryEnv(telemetry);
  const model = createModel(llm);

  return runSetupCore({
    llm,
    target: inline.target as TargetConfig,
    telemetry: resolvedTelemetry,
    model,
    selectedEvaluatorIds,
    resolvedOutputDir: path.resolve(outputDir),
  });
}

// ---------------------------------------------------------------------------
// Shared core — builds attacks and writes the prompts file
// ---------------------------------------------------------------------------

interface CoreSetupParams {
  llm: LlmConfig;
  target: TargetConfig;
  telemetry: TelemetryConfig | undefined;
  model: ReturnType<typeof createModel>;
  selectedEvaluatorIds: string[];
  resolvedOutputDir: string;
  turnMode?: "single" | "multi";
  turns?: number;
}

async function runSetupCore({
  llm,
  target,
  telemetry,
  model,
  selectedEvaluatorIds,
  resolvedOutputDir,
  turnMode,
  turns,
}: CoreSetupParams): Promise<SetupResult> {
  await mkdir(resolvedOutputDir, { recursive: true });

  let langfuseTraceContext: string | undefined;
  let traceCurationRan = false;
  let traceCurationError: string | undefined;
  let traceSummaryPath: string | undefined;

  if (telemetry && telemetry.provider !== "none") {
    traceCurationRan = true;
    try {
      langfuseTraceContext = await runSetupTraceCuration({
        telemetry,
        model,
        targetName: target.name,
        targetDescription: target.description,
        outputDir: resolvedOutputDir,
      });
      if (langfuseTraceContext?.trim()) {
        traceSummaryPath = path.join(resolvedOutputDir, "trace-summary.md");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      traceCurationError = msg;
      console.warn(`[${telemetry.provider}] Trace curation failed (continuing setup): ${msg}`);
    }
  }

  const allAttacks: AttackEntry[] = [];

  for (const evaluatorId of selectedEvaluatorIds) {
    let evaluator;
    try {
      evaluator = await loadBuiltinEvaluator(evaluatorId);
    } catch {
      continue;
    }

    const targetDescription =
      target.type === "local-script"
        ? `${target.description ?? ""}\nTarget runs as a subprocess: stdin is JSON {"prompt","context"}. ` +
          `Stdout must be JSON with a string field "response". Script: ${target.scriptPath ?? ""}. ` +
          `Interpreter is chosen from the file extension (.py → python3, .js/.mjs/.cjs → node).`
        : target.description;

    const attacks = await generateAttackPrompts(evaluator, targetDescription, model, {
      traceContext: langfuseTraceContext,
    });

    for (const attack of attacks) {
      allAttacks.push({
        evaluatorId: evaluator.id,
        evaluatorName: evaluator.name,
        severity: evaluator.severity,
        owasp: evaluator.owasp,
        patternName: attack.patternName,
        prompt: attack.prompt,
        passCriteria: evaluator.passCriteria,
        failCriteria: evaluator.failCriteria,
        ...(turnMode === "multi" ? { turnMode: "multi" as const, turns: turns ?? 3 } : {}),
      });
    }
  }

  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const uuid = randomUUID().slice(0, 6);
  const filename = `astra-prompts-${timestamp}-${uuid}.json`;
  const outputPath = path.join(resolvedOutputDir, filename);

  const promptsFile: PromptsFile = {
    generatedAt: new Date().toISOString(),
    llm,
    target,
    attacks: allAttacks,
    telemetry,
    ...(langfuseTraceContext?.trim() ? { traceSummaryFilename: "trace-summary.md" } : {}),
  };

  await writeFile(outputPath, JSON.stringify(promptsFile, null, 2), "utf8");

  return {
    promptsFilePath: outputPath,
    evaluatorCount: selectedEvaluatorIds.length,
    totalAttacks: allAttacks.length,
    provider: llm.provider,
    model: llm.model,
    traceCurationRan,
    traceCurationError,
    traceSummaryPath,
  };
}
