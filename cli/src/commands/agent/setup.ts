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
import { resolveTelemetryEnv } from "@astra/core/config/resolveTelemetryEnv";
import { runSetupTraceCuration } from "@astra/core/telemetry/curation";
import type {
  PromptsFile,
  AttackEntry,
  SetupConfigFile,
  TargetConfig,
  LlmConfig,
  ProviderName,
  TelemetryConfig,
} from "@astra/core/config/types";
import { PROVIDER_CHOICES } from "@astra/core/config/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CollectedAnswers {
  attackLlm: LlmConfig;
  judgeLlm?: LlmConfig;
  target: TargetConfig;
  selectedEvaluatorIds: string[];
  telemetry?: TelemetryConfig;
  turnMode?: "single" | "multi";
  turns?: number;
}

/** After `--config`: confirm telemetry block was read (never log secret values). */
function logTelemetryFromConfig(telemetry: TelemetryConfig | undefined): void {
  console.log(`\n--- Telemetry (from config) ---`);
  if (telemetry === undefined) {
    console.log(`  (no "telemetry" key in config)`);
    console.log(`---`);
    return;
  }
  console.log(`  provider: ${telemetry.provider}`);
  if (telemetry.provider !== "langfuse") {
    console.log(`---`);
    return;
  }
  const lf = telemetry.langfuse;
  const pubName = lf?.publicKeyEnv ?? "LANGFUSE_PUBLIC_KEY";
  const secName = lf?.secretKeyEnv ?? "LANGFUSE_SECRET_KEY";
  const baseUrlEnv = lf?.baseUrlEnv?.trim();
  const envFlag = (name: string) => (process.env[name]?.trim() ? "set" : "missing");

  console.log(`  Langfuse baseUrl (resolved): ${lf?.baseUrl?.trim() || "(none — adapter may use default)"}`);
  if (baseUrlEnv) console.log(`  baseUrlEnv: ${baseUrlEnv} → ${envFlag(baseUrlEnv)}`);
  console.log(`  ${pubName}: ${envFlag(pubName)}`);
  console.log(`  ${secName}: ${envFlag(secName)}`);
  const sel = lf?.traceSelection;
  if (sel === undefined) {
    console.log(`  traceSelection: (none — no Langfuse list filters)`);
  } else {
    console.log(`  traceSelection (Langfuse list / fetch filters):`);
    if (sel.setupTraceIds?.length) {
      console.log(`    setupTraceIds (${sel.setupTraceIds.length}): ${sel.setupTraceIds.join(", ")}`);
    } else {
      console.log(`    setupTraceIds: (none)`);
    }
    if (sel.lookbackHours != null) console.log(`    lookbackHours: ${sel.lookbackHours}`);
    if (sel.fromTimestamp) console.log(`    fromTimestamp: ${sel.fromTimestamp}`);
    if (sel.toTimestamp) console.log(`    toTimestamp: ${sel.toTimestamp}`);
    if (sel.tags?.length) {
      console.log(`    tags (Langfuse query): ${sel.tags.map((t) => JSON.stringify(t)).join(", ")}`);
    } else {
      console.log(`    tags: (none)`);
    }
    if (sel.environment != null) {
      const env = Array.isArray(sel.environment) ? sel.environment.join(", ") : sel.environment;
      console.log(`    environment: ${env}`);
    }
    if (sel.sessionId) console.log(`    sessionId: ${sel.sessionId}`);
    if (sel.listLimit != null) console.log(`    listLimit: ${sel.listLimit}`);
    if (sel.listMaxPages != null) console.log(`    listMaxPages: ${sel.listMaxPages}`);
    if (sel.fields) console.log(`    fields: ${sel.fields}`);
    if (sel.observationName) {
      console.log(`    observationName (pre-filter): ${sel.observationName}${sel.observationType ? ` [type=${sel.observationType}]` : ""}`);
    }
    if (sel.filter?.length) console.log(`    filter (advanced JSON): ${sel.filter.length} condition(s)`);
  }
  if (lf?.traceCurationListJsonMaxChars != null) {
    console.log(`  traceCurationListJsonMaxChars: ${lf.traceCurationListJsonMaxChars}`);
  }
  if (lf?.traceSummarySourceJsonMaxChars != null) {
    console.log(`  traceSummarySourceJsonMaxChars: ${lf.traceSummarySourceJsonMaxChars}`);
  }
  if (lf?.traceSummaryForAttackMaxChars != null) {
    console.log(`  traceSummaryForAttackMaxChars: ${lf.traceSummaryForAttackMaxChars}`);
  }
  console.log(`  enrichJudgeFromTrace: ${telemetry.enrichJudgeFromTrace ?? false}`);
  if (telemetry.enrichJudgeTraceJsonMaxChars != null) {
    console.log(`  enrichJudgeTraceJsonMaxChars: ${telemetry.enrichJudgeTraceJsonMaxChars}`);
  }
  const p = telemetry.propagation;
  if (p) {
    console.log(
      `  propagation: strategy=${p.traceIdStrategy ?? "(default)"}, prefix=${p.traceIdPrefix ?? "(none)"}`
    );
    if (p.headers && Object.keys(p.headers).length > 0) {
      console.log(`  propagation.headers: ${JSON.stringify(p.headers)}`);
    }
    if (p.traceIdBodyField) console.log(`  propagation.traceIdBodyField: ${p.traceIdBodyField}`);
  } else {
    console.log(`  propagation: (none)`);
  }
  console.log(`---`);
}

async function collectLlmConfig(label: string): Promise<LlmConfig> {
  const provider = await select<ProviderName>({
    message: `LLM provider for ${label}:`,
    choices: PROVIDER_CHOICES,
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

  const defaultEnvVar = PROVIDER_ENV_VARS[provider];
  const apiKeyEnv = await input({
    message: "Env var name for API key:",
    default: defaultEnvVar,
    validate: (v) => v.trim() !== "" || "Env var name is required",
  });

  return { provider, model, apiKeyEnv: apiKeyEnv.trim(), baseURL };
}

async function runInteractiveWizard(
  catalog: Awaited<ReturnType<typeof loadSkillCatalog>>
): Promise<CollectedAnswers> {
  console.log("\nAstra Setup Wizard\n");

  const { evaluators: EVALUATORS, suites: SUITES } = catalog;

  const attackLlm = await collectLlmConfig("attack generation");

  const wantSeparateJudge = await confirm({
    message: "Use a different model for judging? (defaults to same as attack generation)",
    default: false,
  });
  const judgeLlm = wantSeparateJudge ? await collectLlmConfig("judging") : undefined;

  // --- Target type ---
  const targetType = await select<"http-endpoint" | "local-script">({
    message: "Target type:",
    choices: [
      { name: "HTTP endpoint (REST / OpenAI-compatible / custom JSON)", value: "http-endpoint" },
      {
        name: "Local script (.js or .py — JSON on stdin, JSON with response on stdout)",
        value: "local-script",
      },
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

    let promptPath: string | undefined;
    let responsePath: string | undefined;
    if (requestFormat === "json") {
      const customPromptPath = await input({
        message: "JSON body field for the prompt (leave blank for default: prompt):",
        default: "",
      });
      promptPath = customPromptPath.trim() || undefined;

      const customResponsePath = await input({
        message: "Dot-path to extract response from JSON reply (leave blank for default: response):",
        default: "",
      });
      responsePath = customResponsePath.trim() || undefined;
    }

    const sessionIdFieldInput = await input({
      message: "Session ID body field for multi-turn attacks (leave blank to skip, e.g. session_id):",
      default: "",
    });

    target = {
      ...target,
      endpoint,
      requestFormat,
      targetModel,
      targetApiKey: targetApiKey.trim() || undefined,
      ...(promptPath ? { promptPath } : {}),
      ...(responsePath ? { responsePath } : {}),
      ...(sessionIdFieldInput.trim() ? { sessionIdField: sessionIdFieldInput.trim() } : {}),
    };
  } else {
    const scriptPath = await input({
      message:
        "Path to script (e.g. ./astra-local-target.js or .py — node vs python3 is chosen from the extension):",
      validate: (v) => v.trim() !== "" || "Required",
    });
    target = { ...target, scriptPath: scriptPath.trim() };
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

  // --- Attack mode ---
  const turnMode = await select<"single" | "multi">({
    message: "Attack mode:",
    choices: [
      { name: "Single-turn  (one prompt → one response, classic red team)", value: "single" },
      { name: "Multi-turn   (conversation with escalating follow-ups)", value: "multi" },
    ],
  });

  let turns: number | undefined;
  if (turnMode === "multi") {
    const turnsStr = await input({
      message: "Number of turns per attack (default 3):",
      default: "3",
      validate: (v) => {
        const n = parseInt(v, 10);
        return (Number.isInteger(n) && n >= 2 && n <= 10) || "Enter a number between 2 and 10";
      },
    });
    turns = parseInt(turnsStr, 10);
  }

  return { attackLlm, judgeLlm, target, selectedEvaluatorIds, turnMode, turns };
}

/** Resolve `"agent"` section from unified `astra.config.json` (schemaVersion 3). */
function extractAgentSetupPayload(parsed: unknown): SetupConfigFile {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Invalid config file");
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.configId !== "string" || o.configId.trim() === "") {
    throw new Error('Not a valid astra config file (missing configId). Run `astra setup`.');
  }
  if (!o.agent || typeof o.agent !== "object") {
    throw new Error('Missing "agent" section in astra.config.json.');
  }
  return o.agent as SetupConfigFile;
}

async function loadConfigFile(
  configPath: string,
  catalog: Awaited<ReturnType<typeof loadSkillCatalog>>
): Promise<CollectedAnswers> {
  const { suites: SUITES } = catalog;
  const EVALUATOR_IDS = getEvaluatorIdSet(catalog);
  const raw = await readFile(path.resolve(configPath), "utf8");

  // Support both JSON and YAML
  const ext = path.extname(configPath).toLowerCase();
  const parsed: unknown =
    ext === ".yml" || ext === ".yaml" ? parseYaml(raw) : JSON.parse(raw);
  const cfg = extractAgentSetupPayload(parsed);

  // Resolve evaluator selection
  let selectedEvaluatorIds: string[];
  if (cfg.selection.mode === "suite") {
    selectedEvaluatorIds = resolveSuiteEvaluatorIds(cfg.selection.suite, SUITES);
  } else {
    const invalid = cfg.selection.evaluators.filter((id) => !EVALUATOR_IDS.has(id));
    if (invalid.length > 0) throw new Error(`Unknown evaluator IDs in config: ${invalid.join(", ")}`);
    selectedEvaluatorIds = cfg.selection.evaluators;
  }

  const provider: ProviderName = (cfg.attackLlm?.provider as ProviderName) ?? "groq";
  const attackLlm: LlmConfig = {
    provider,
    model: cfg.attackLlm?.model ?? PROVIDER_DEFAULTS[provider],
    apiKeyEnv: cfg.attackLlm?.apiKeyEnv ?? PROVIDER_ENV_VARS[provider],
    baseURL: cfg.attackLlm?.baseURL,
  };

  let judgeLlm: LlmConfig | undefined;
  if (cfg.judgeLlm) {
    const judgeProvider: ProviderName = (cfg.judgeLlm.provider as ProviderName) ?? provider;
    judgeLlm = {
      provider: judgeProvider,
      model: cfg.judgeLlm.model ?? PROVIDER_DEFAULTS[judgeProvider],
      apiKeyEnv: cfg.judgeLlm.apiKeyEnv ?? PROVIDER_ENV_VARS[judgeProvider],
      baseURL: cfg.judgeLlm.baseURL,
    };
  }

  return {
    attackLlm,
    judgeLlm,
    target: cfg.target as TargetConfig,
    selectedEvaluatorIds,
    telemetry: resolveTelemetryEnv(cfg.telemetry),
    turnMode: cfg.turnMode,
    turns: cfg.turns,
  };
}

// ---------------------------------------------------------------------------
// setup command
// ---------------------------------------------------------------------------

export function registerSetupCommand(program: Command) {
  program
    .command("setup")
    .description(
      "Configure an Astra scan and generate attack prompts JSON.\n" +
      "  Run interactively: astra setup --agent\n" +
      "  From config file:  astra generate --config <config.json>"
    )
    .option("--config <path>", "Path to a JSON or YAML setup config file (skips interactive prompts)")
    .option("--output-dir <path>", "Directory to write the prompts JSON file", ".")
    .action(async (opts) => {
      let answers: CollectedAnswers;
      try {
        const catalog = await loadSkillCatalog();
        if (opts.config) {
          const resolvedPath = path.resolve(opts.config);
          console.log(`\nLoading config from: ${resolvedPath}`);
          answers = await loadConfigFile(opts.config, catalog);
          logTelemetryFromConfig(answers.telemetry);
          console.log(`Starting setup (attack prompt generation)…`);
        } else {
          answers = await runInteractiveWizard(catalog);
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

      const { attackLlm, judgeLlm, target, selectedEvaluatorIds, telemetry, turnMode, turns } = answers;
      const model = createModel(attackLlm);
      const outputDir = path.resolve(opts.outputDir);

      let langfuseTraceContext: string | undefined;
      if (telemetry && telemetry.provider !== "none") {
        try {
          langfuseTraceContext = await runSetupTraceCuration({
            telemetry,
            model,
            targetName: target.name,
            targetDescription: target.description,
            outputDir,
          });
          if (langfuseTraceContext) {
            console.log(`  Trace summary (markdown) for attack generation: ${langfuseTraceContext.length} chars`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`\n[${telemetry.provider}] Trace curation failed (continuing setup): ${msg}\n`);
        }
      }

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

        const targetDescription =
          target.type === "local-script"
            ? `${target.description}\nTarget runs as a subprocess: stdin is JSON {"prompt","context"}. ` +
              `Stdout must be JSON with a string field "response". Script: ${target.scriptPath ?? ""}. ` +
              `Interpreter is chosen from the file extension (.py → python3, .js/.mjs/.cjs → node).`
            : target.type === "python-function"
              ? `${target.description}\nFunction signature: ${target.functionSignature ?? ""}`
              : target.description;

        process.stdout.write(` generating ${evaluator.patterns.length} prompt(s)...`);
        const attacks = await generateAttackPrompts(evaluator, targetDescription, model, {
          traceContext: langfuseTraceContext,
        });
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
            ...(turnMode === "multi" ? { turnMode: "multi" as const, turns: turns ?? 3 } : {}),
          });
        }
      }

      const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      const uuid = randomUUID().slice(0, 6);
      const filename = `astra-prompts-${timestamp}-${uuid}.json`;
      const outputPath = path.join(outputDir, filename);

      const promptsFile: PromptsFile = {
        generatedAt: new Date().toISOString(),
        attackLlm,
        ...(judgeLlm ? { judgeLlm } : {}),
        target,
        attacks: allAttacks,
        telemetry,
        ...(langfuseTraceContext?.trim() ? { traceSummaryFilename: "trace-summary.md" } : {}),
      };

      await writeFile(outputPath, JSON.stringify(promptsFile, null, 2), "utf8");

      console.log(`\nSetup complete!`);
      console.log(`  Generator: ${attackLlm.provider} / ${attackLlm.model}`);
      if (judgeLlm) {
        console.log(`  Judge:     ${judgeLlm.provider} / ${judgeLlm.model}`);
      }
      console.log(`  Evaluators: ${selectedEvaluatorIds.length}`);
      console.log(`  Total attack prompts: ${allAttacks.length}`);
      if (turnMode === "multi") {
        console.log(`  Attack mode: multi-turn (${turns ?? 3} turns per attack)`);
      }
      if (telemetry !== undefined) {
        const strat = telemetry.propagation?.traceIdStrategy ?? "(not set — defaults apply when run is implemented)";
        const hdrs = telemetry.propagation?.headers;
        const hdrSummary =
          hdrs && Object.keys(hdrs).length > 0
            ? Object.keys(hdrs).join(", ")
            : "none";
        const setupIds = telemetry.langfuse?.traceSelection?.setupTraceIds?.length ?? 0;
        console.log(`  Telemetry: ${telemetry.provider}` + (setupIds ? ` (${setupIds} setup trace id(s))` : ""));
        if (telemetry.provider === "langfuse") {
          const lf = telemetry.langfuse;
          const base =
            lf?.baseUrl?.trim() ||
            (lf?.baseUrlEnv
              ? `(env ${lf.baseUrlEnv.trim()} unset — using default host until set)`
              : "(default host)");
          const pub = telemetry.langfuse?.publicKeyEnv ?? "LANGFUSE_PUBLIC_KEY";
          const sec = telemetry.langfuse?.secretKeyEnv ?? "LANGFUSE_SECRET_KEY";
          console.log(`    Langfuse: ${base}`);
          console.log(
            `    Keys:      set ${pub} and ${sec} in the environment (do not commit keys to this file).`
          );
        }
        if (telemetry.provider === "netra") {
          const nt = telemetry.netra;
          const base =
            nt?.baseUrl?.trim() ||
            (nt?.baseUrlEnv
              ? `(env ${nt.baseUrlEnv.trim()} unset — set before running)`
              : "(baseUrl not set)");
          const keyEnv = nt?.apiKeyEnv ?? "NETRA_API_KEY";
          console.log(`    Netra: ${base}`);
          console.log(`    Key:   set ${keyEnv} in the environment (do not commit keys to this file).`);
        }
        console.log(`    Propagation: strategy=${strat}, headers=${hdrSummary}`);
      }
      console.log(`  Prompts file: ${outputPath}`);
      if (telemetry && (telemetry.provider === "langfuse" || telemetry.provider === "netra")) {
        console.log(`  Trace data:    ${path.join(outputDir, "tracedata.json")}`);
        if (langfuseTraceContext?.trim()) {
          console.log(`  Trace summary: ${path.join(outputDir, "trace-summary.md")} (also embedded in attack LLM context)`);
        }
      }
      console.log(`\n  ⚠  The prompts file contains your API key — add it to .gitignore`);
      console.log(`\nNext step:`);
      console.log(`  astra run --attacks ${outputPath}\n`);
    });
}

export async function generateAgentAttacksFromConfig(opts: {
  configPath: string;
  outputPath: string;
  configId?: string;
}): Promise<string> {
  const catalog = await loadSkillCatalog();
  const answers = await loadConfigFile(opts.configPath, catalog);

  const { attackLlm, judgeLlm, target, selectedEvaluatorIds, telemetry, turnMode, turns } = answers;
  const model = createModel(attackLlm);

  let langfuseTraceContext: string | undefined;
  if (telemetry && telemetry.provider !== "none") {
    try {
      langfuseTraceContext = await runSetupTraceCuration({
        telemetry,
        model,
        targetName: target.name,
        targetDescription: target.description,
        outputDir: path.dirname(path.resolve(opts.outputPath)),
      });
    } catch {
      // ignore; generation can proceed without trace context
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
        ? `${target.description}\nTarget runs as a subprocess: stdin is JSON {"prompt","context"}. ` +
          `Stdout must be JSON with a string field "response". Script: ${target.scriptPath ?? ""}. ` +
          `Interpreter is chosen from the file extension (.py → python3, .js/.mjs/.cjs → node).`
        : target.type === "python-function"
          ? `${target.description}\nFunction signature: ${target.functionSignature ?? ""}`
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

  const promptsFile: PromptsFile = {
    generatedAt: new Date().toISOString(),
    attackLlm,
    ...(judgeLlm ? { judgeLlm } : {}),
    target,
    attacks: allAttacks,
    telemetry,
    ...(langfuseTraceContext?.trim() ? { traceSummaryFilename: "trace-summary.md" } : {}),
  };

  // Attach unified-cli metadata (safe to ignore by older readers)
  (promptsFile as unknown as Record<string, unknown>).mode = "agent";
  if (opts.configId) (promptsFile as unknown as Record<string, unknown>).configId = opts.configId;
  (promptsFile as unknown as Record<string, unknown>).configPath = path.resolve(opts.configPath);

  const resolved = path.resolve(opts.outputPath);
  await writeFile(resolved, JSON.stringify(promptsFile, null, 2), "utf8");
  return resolved;
}
