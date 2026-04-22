import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { input, select, checkbox, password, confirm } from "@inquirer/prompts";
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
  PromptsFile,
  AttackEntry,
  SetupConfigFile,
  TargetConfig,
  LlmConfig,
  ProviderName,
} from "@astra/core/config/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CollectedAnswers {
  llm: LlmConfig;
  target: TargetConfig;
  selectedEvaluatorIds: string[];
}

async function collectLlmConfig(): Promise<LlmConfig> {
  const provider = await select<ProviderName>({
    message: "LLM provider for attack generation and judging:",
    choices: [
      { name: "OpenAI", value: "openai" },
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "Google (Gemini)", value: "google" },
      { name: "Groq", value: "groq" },
      { name: "Other (OpenAI-compatible)", value: "other" },
    ],
  });

  const defaultModel = PROVIDER_DEFAULTS[provider];
  const model = await input({
    message: "Model name:",
    default: defaultModel || undefined,
  });

  let baseURL: string | undefined;
  if (provider === "other") {
    baseURL = await input({
      message: "Base URL (e.g. https://my-ollama.local/v1):",
      validate: (v) => v.trim().startsWith("http") || "Must be a valid URL",
    });
  }

  // API key — offer to reuse from env var if already set
  const envVar = PROVIDER_ENV_VARS[provider];
  const existingKey = process.env[envVar];
  let apiKey: string;

  if (existingKey) {
    const useEnv = await confirm({
      message: `Found ${envVar} in environment. Use it?`,
      default: true,
    });
    apiKey = useEnv ? existingKey : await password({ message: "API key:", mask: "*" });
  } else {
    apiKey = await password({
      message: `API key (or set ${envVar} env var):`,
      mask: "*",
      validate: (v) => v.trim() !== "" || "API key is required",
    });
  }

  return { provider, model, apiKey, baseURL };
}

async function runInteractiveWizard(
  catalog: Awaited<ReturnType<typeof loadSkillCatalog>>
): Promise<CollectedAnswers> {
  console.log("\nAstra Setup Wizard\n");

  const { evaluators: EVALUATORS, suites: SUITES } = catalog;

  const llm = await collectLlmConfig();

  // --- Target type ---
  const targetType = await select<"http-endpoint" | "python-function">({
    message: "Target type:",
    choices: [
      { name: "HTTP Endpoint  (REST API, OpenAI-compatible, or custom JSON)", value: "http-endpoint" },
      { name: "Python Function  (describe function signature, LLM tailors prompts)", value: "python-function" },
    ],
  });

  const targetName = await input({ message: "Target name:", validate: (v) => v.trim() !== "" || "Required" });
  const targetDescription = await input({
    message: "Target description (what it does, sensitive data, forbidden topics):",
    validate: (v) => v.trim() !== "" || "Required",
  });

  let target: TargetConfig = { name: targetName, description: targetDescription, type: targetType };

  if (targetType === "http-endpoint") {
    const endpoint = await input({
      message: "Endpoint URL (e.g. http://localhost:4000/chat):",
      validate: (v) => v.trim().startsWith("http") || "Must be a valid URL",
    });
    const requestFormat = await select<"openai" | "json">({
      message: "Request format:",
      choices: [
        { name: "openai  — POST {model, messages:[{role,content}]}, response at choices[0].message.content", value: "openai" },
        { name: "json    — POST {prompt: \"...\"}, response at .response field", value: "json" },
      ],
    });
    const targetModel = await input({
      message: "Model name to send in request body (for OpenAI-compat endpoints):",
      default: "gpt-4o-mini",
    });
    const targetApiKey = await password({
      message: "Target API key / Bearer token (leave blank if not needed):",
      mask: "*",
    });
    target = {
      ...target,
      endpoint,
      requestFormat,
      targetModel,
      targetApiKey: targetApiKey.trim() || undefined,
    };
  } else {
    const functionSignature = await input({
      message: "Describe the function signature (inputs, outputs, what it does):",
      validate: (v) => v.trim() !== "" || "Required",
    });
    target = { ...target, functionSignature };
  }

  // --- Evaluator selection ---
  const selectionMode = await select<"suite" | "evaluators">({
    message: "How would you like to select tests?",
    choices: [
      { name: "Suite  (pre-set group of evaluators)", value: "suite" },
      { name: "Individual evaluators  (pick from the full list)", value: "evaluators" },
    ],
  });

  let selectedEvaluatorIds: string[] = [];

  if (selectionMode === "suite") {
    const suiteId = await select<string>({
      message: "Select a suite:",
      choices: SUITES.map((s) => ({
        name: `${s.name}  — ${s.description}`,
        value: s.id,
      })),
    });
    selectedEvaluatorIds = resolveSuiteEvaluatorIds(suiteId, SUITES);
    console.log(
      `\n   Selected ${selectedEvaluatorIds.length} evaluators from "${SUITES.find((s) => s.id === suiteId)?.name}"`
    );
  } else {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...EVALUATORS].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
    selectedEvaluatorIds = await checkbox<string>({
      message: "Select evaluators (space to toggle, enter to confirm):",
      choices: sorted.map((e) => ({
        name: `[${e.severity.toUpperCase().padEnd(8)}] ${e.owasp.padEnd(6)} ${e.name}`,
        value: e.id,
      })),
      validate: (v) => v.length > 0 || "Select at least one evaluator",
    });
  }

  return { llm, target, selectedEvaluatorIds };
}

async function loadConfigFile(
  configPath: string,
  catalog: Awaited<ReturnType<typeof loadSkillCatalog>>,
  apiKeyOverride?: string
): Promise<CollectedAnswers> {
  const { suites: SUITES } = catalog;
  const EVALUATOR_IDS = getEvaluatorIdSet(catalog);
  const raw = await readFile(path.resolve(configPath), "utf8");

  // Support both JSON and YAML
  const ext = path.extname(configPath).toLowerCase();
  const cfg: SetupConfigFile = (ext === ".yml" || ext === ".yaml")
    ? parseYaml(raw) as SetupConfigFile
    : JSON.parse(raw) as SetupConfigFile;

  // Resolve evaluator selection
  let selectedEvaluatorIds: string[];
  if (cfg.selection.mode === "suite") {
    selectedEvaluatorIds = resolveSuiteEvaluatorIds(cfg.selection.suite, SUITES);
  } else {
    const invalid = cfg.selection.evaluators.filter((id) => !EVALUATOR_IDS.has(id));
    if (invalid.length > 0) throw new Error(`Unknown evaluator IDs in config: ${invalid.join(", ")}`);
    selectedEvaluatorIds = cfg.selection.evaluators;
  }

  // Resolve LLM — --api-key flag > config file > env var
  const provider: ProviderName = (cfg.llm?.provider as ProviderName) ?? "groq";
  const envVar = PROVIDER_ENV_VARS[provider];
  const apiKey = apiKeyOverride?.trim() || cfg.llm?.apiKey?.trim() || process.env[envVar] || "";
  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${provider}". ` +
      `Pass --api-key, set llm.apiKey in the config file, or export ${envVar}.`
    );
  }

  const llm: LlmConfig = {
    provider,
    model: cfg.llm?.model ?? PROVIDER_DEFAULTS[provider],
    apiKey,
    baseURL: cfg.llm?.baseURL,
  };

  return { llm, target: cfg.target as TargetConfig, selectedEvaluatorIds };
}

// ---------------------------------------------------------------------------
// setup command
// ---------------------------------------------------------------------------

export function registerSetupCommand(program: Command) {
  program
    .command("setup")
    .description(
      "Configure an Astra scan and generate attack prompts JSON.\n" +
      "  Run interactively: astra setup\n" +
      "  From config file:  astra setup --config astra.config.yml"
    )
    .option("--config <path>", "Path to a JSON or YAML setup config file (skips interactive prompts)")
    .option("--output-dir <path>", "Directory to write the prompts JSON file", ".")
    .option("--api-key <key>", "LLM API key (overrides config file and environment variable)")
    .action(async (opts) => {
      let answers: CollectedAnswers;
      try {
        const catalog = await loadSkillCatalog();
        if (opts.config) {
          console.log(`\nLoading config from: ${opts.config}`);
          answers = await loadConfigFile(opts.config, catalog, opts.apiKey);
        } else {
          answers = await runInteractiveWizard(catalog);
          if (opts.apiKey) answers.llm.apiKey = opts.apiKey;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("User force closed") || msg.includes("ExitPromptError")) {
          console.log("\nSetup cancelled.");
          process.exitCode = 0;
          return;
        }
        console.error(`\nError during setup: ${msg}`);
        process.exitCode = 1;
        return;
      }

      const { llm, target, selectedEvaluatorIds } = answers;
      const model = createModel(llm);

      console.log(`\nGenerating attack prompts for ${selectedEvaluatorIds.length} evaluator(s)...\n`);

      const allAttacks: AttackEntry[] = [];

      for (const evaluatorId of selectedEvaluatorIds) {
        process.stdout.write(`  [${evaluatorId}] Loading...`);
        let evaluator;
        try {
          evaluator = await loadBuiltinEvaluator(evaluatorId);
        } catch {
          console.log(` skipped (evaluator file not found)`);
          continue;
        }

        const targetDescription = target.type === "python-function"
          ? `${target.description}\nFunction signature: ${target.functionSignature ?? ""}`
          : target.description;

        process.stdout.write(` generating ${evaluator.patterns.length} prompt(s)...`);
        const attacks = await generateAttackPrompts(evaluator, targetDescription, model);
        console.log(` done (${attacks.length} prompts)`);

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
      const outputDir = path.resolve(opts.outputDir);
      const outputPath = path.join(outputDir, filename);

      const promptsFile: PromptsFile = {
        generatedAt: new Date().toISOString(),
        llm,
        target,
        attacks: allAttacks,
      };

      await writeFile(outputPath, JSON.stringify(promptsFile, null, 2), "utf8");

      console.log(`\nSetup complete!`);
      console.log(`  Provider:  ${llm.provider} / ${llm.model}`);
      console.log(`  Evaluators: ${selectedEvaluatorIds.length}`);
      console.log(`  Total attack prompts: ${allAttacks.length}`);
      console.log(`  Prompts file: ${outputPath}`);
      console.log(`\n  ⚠  The prompts file contains your API key — add it to .gitignore`);
      console.log(`\nNext step:`);
      console.log(`  astra run --input ${outputPath}\n`);
    });
}
