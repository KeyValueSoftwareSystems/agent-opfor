import { readFile, writeFile } from "node:fs/promises";
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
import type {
  AttackEntry,
  LlmConfig,
  PromptsFile,
  ProviderName,
  SetupConfigFile,
  TargetConfig,
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
  const model = createModel(llm);
  const allAttacks: AttackEntry[] = [];

  for (const evaluatorId of selectedEvaluatorIds) {
    let evaluator;
    try {
      evaluator = await loadBuiltinEvaluator(evaluatorId);
    } catch {
      continue; // skip if evaluator file not found
    }

    const targetDescription = target.type === "python-function"
      ? `${target.description}\nFunction signature: ${target.functionSignature ?? ""}`
      : target.description;

    const attacks = await generateAttackPrompts(evaluator, targetDescription, model);

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
      });
    }
  }

  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const uuid = randomUUID().slice(0, 6);
  const filename = `astra-prompts-${timestamp}-${uuid}.json`;
  const resolvedOutputDir = path.resolve(outputDir);
  const outputPath = path.join(resolvedOutputDir, filename);

  const promptsFile: PromptsFile = {
    generatedAt: new Date().toISOString(),
    llm,
    target,
    attacks: allAttacks,
  };

  await writeFile(outputPath, JSON.stringify(promptsFile, null, 2), "utf8");

  return {
    promptsFilePath: outputPath,
    evaluatorCount: selectedEvaluatorIds.length,
    totalAttacks: allAttacks.length,
    provider: llm.provider,
    model: llm.model,
  };
}
