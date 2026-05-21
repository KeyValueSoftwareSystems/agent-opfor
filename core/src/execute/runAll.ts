import { randomUUID } from "../lib/random.js";
import type { LanguageModel } from "ai";
import type {
  RunConfig,
  AttackSpec,
  AttackResult,
  EvaluatorResult,
  UnifiedRunReport,
  AgentTurnRecord,
  McpTurnRecord,
} from "./types.js";
import { generateAttacks, type ToolInfo } from "../generate/generateAttacks.js";
import { generateNextAgentTurn, generateNextMcpTurn } from "../generate/generateNextTurn.js";
import { createAgentTarget, isTargetError } from "../targets/agentTarget.js";
import { createMcpTarget } from "../targets/mcpTarget.js";
import { loadBuiltinEvaluator } from "../evaluators/parseEvaluator.js";
import { loadSkillCatalog, resolveSuiteEvaluatorIds } from "../config/loadSkillCatalog.js";
import { judgeResponse, errorJudge } from "../evaluators/judge.js";
import type { JudgeObservabilityContext } from "../evaluators/judge.js";
import {
  judgeToolResponse,
  sanitizeJudgeResult,
  errorJudge as mcpErrorJudge,
} from "../run/judge.js";
import { createModel } from "../providers/factory.js";
import type { LlmConfig } from "../config/types.js";
import { getAdapter } from "../telemetry/adapter.js";
import { runSetupTraceCuration } from "../telemetry/curation.js";
import { newOtelTraceId } from "../lib/tracePropagation.js";
import { log } from "../lib/logger.js";

export interface RunAllOptions {
  onProgress?: (event: ProgressEvent) => void;
  outputDir?: string;
}

export type ProgressEvent =
  | { type: "evaluator_start"; evaluatorId: string; evaluatorName: string }
  | { type: "attack_start"; attackId: string; patternName: string }
  | { type: "attack_done"; attackId: string; verdict: "PASS" | "FAIL" | "ERROR" }
  | { type: "evaluator_done"; evaluatorId: string; passed: number; failed: number; errors: number };

/**
 * Core execute loop: resolves evaluators, generates attacks per effort level,
 * runs each attack against the target, judges responses, and returns a unified report.
 * No intermediate files are written.
 */
export async function runAll(
  config: RunConfig,
  options?: RunAllOptions
): Promise<UnifiedRunReport> {
  const notify = options?.onProgress ?? (() => {});

  const attackModel = resolveModel(config.attackLlm);
  const judgeModel = resolveModel(config.judgeLlm ?? config.attackLlm);

  const evaluatorIds = await resolveEvaluatorIds(config.selection);
  const isMcp = config.target.kind === "mcp";

  // For MCP targets, connect once and discover tools
  let mcpTarget: Awaited<ReturnType<typeof createMcpTarget>> | null = null;
  let tools: ToolInfo[] = [];

  if (isMcp) {
    mcpTarget = await createMcpTarget(config.target as import("./types.js").McpTargetConfig);
    tools = await mcpTarget.listTools();
    log.info(`MCP target connected — ${tools.length} tool(s) available`);
  }

  // Optional: pull real production traces and summarise them so attack
  // generation can be grounded in actual usage patterns.
  const traceContext = await curateTracesIfConfigured(config, attackModel, options?.outputDir);

  const evaluatorResults: EvaluatorResult[] = [];

  try {
    for (const evaluatorId of evaluatorIds) {
      const evaluator = await loadBuiltinEvaluator(evaluatorId).catch(() => null);
      if (!evaluator) {
        log.warn(`Evaluator "${evaluatorId}" not found — skipping`);
        continue;
      }

      notify({ type: "evaluator_start", evaluatorId, evaluatorName: evaluator.name });
      log.info(`\n▶ ${evaluator.name} (${evaluatorId})`);

      const attacks = await generateAttacks({
        evaluator,
        target: config.target,
        effort: config.effort,
        model: attackModel,
        turns: config.turns,
        options: { tools, traceContext },
      });

      log.info(`  ${attacks.length} attack(s) generated [effort: ${config.effort}]`);

      const attackResults: AttackResult[] = [];

      for (const attack of attacks) {
        notify({ type: "attack_start", attackId: attack.id, patternName: attack.patternName });
        log.info(`  → ${attack.patternName}`);

        const result = isMcp
          ? await runMcpAttack(attack, mcpTarget!, judgeModel, config)
          : await runAgentAttack(attack, config, attackModel, judgeModel, attack.id);

        attackResults.push(result);
        notify({ type: "attack_done", attackId: attack.id, verdict: result.judge.verdict });

        const icon =
          result.judge.verdict === "PASS" ? "✓" : result.judge.verdict === "FAIL" ? "✗" : "⚠";
        log.info(`     ${icon} ${result.judge.verdict} (score ${result.judge.score}/10)`);
      }

      const total = attackResults.length;
      const passed = attackResults.filter((r) => r.judge.verdict === "PASS").length;
      const failed = attackResults.filter((r) => r.judge.verdict === "FAIL").length;
      const errors = attackResults.filter((r) => r.judge.verdict === "ERROR").length;

      notify({ type: "evaluator_done", evaluatorId, passed, failed, errors });

      evaluatorResults.push({
        evaluatorId,
        evaluatorName: evaluator.name,
        ref: evaluator.ref,
        severity: evaluator.severity,
        total,
        passed,
        failed,
        errors,
        passRate: total > 0 ? passed / total : 0,
        attacks: attackResults,
      });
    }
  } finally {
    if (mcpTarget) await mcpTarget.close().catch(() => {});
  }

  return buildReport(config, evaluatorResults);
}

// ---------------------------------------------------------------------------
// Agent attack runner
// ---------------------------------------------------------------------------

async function runAgentAttack(
  attack: AttackSpec,
  config: RunConfig,
  attackModel: LanguageModel,
  judgeModel: LanguageModel,
  attackIndex: string
): Promise<AttackResult> {
  const target = createAgentTarget(config.target as import("./types.js").AgentTargetConfig);
  const turns: AgentTurnRecord[] = [];
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let finalPrompt = attack.prompt ?? "";
  let finalResponse = "";

  const propagation = config.telemetry?.propagation;
  const hasPropagation =
    Boolean(propagation?.headers && Object.keys(propagation.headers).length > 0) ||
    Boolean(propagation?.traceIdBodyField?.trim());
  // Share one trace id across every turn of this attack so observability
  // backends group them into a single trace.
  const attackTraceId =
    hasPropagation && (propagation?.traceIdStrategy ?? "per-attack") === "per-attack"
      ? newOtelTraceId()
      : undefined;

  for (let t = 1; t <= attack.turns; t++) {
    const prompt =
      t === 1
        ? finalPrompt
        : await generateNextAgentTurn(history, attack.prompt ?? "", attackModel);

    const response = await target.send(prompt, {
      propagation,
      attackTraceId,
      attackIndex: Number.isFinite(Number(attackIndex)) ? Number(attackIndex) : undefined,
    });

    history.push({ role: "user", content: prompt });
    history.push({ role: "assistant", content: response });

    if (t === attack.turns || isTargetError(response)) {
      finalPrompt = prompt;
      finalResponse = response;
    }

    const isFinalTurn = t === attack.turns || isTargetError(response);
    const judgeObs = isFinalTurn
      ? await buildJudgeObservability(config, attackTraceId, response)
      : undefined;

    const judge = await (async () => {
      if (isTargetError(response)) {
        return errorJudge(response);
      }
      return judgeResponse(
        {
          id: attack.evaluatorId,
          name: attack.evaluatorName,
          severity: attack.severity,
          ref: attack.ref,
          description: attack.description ?? "",
          passCriteria: attack.passCriteria,
          failCriteria: attack.failCriteria,
          patterns: [],
        },
        prompt,
        response,
        judgeModel,
        judgeObs,
        history.length > 2 ? history : undefined,
        { patternName: attack.patternName, judgeHint: attack.judgeHint }
      );
    })();

    turns.push({ kind: "agent", turnIndex: t, prompt, response, judge });

    if (isTargetError(response)) break;
  }

  await target.close();

  const lastTurn = turns[turns.length - 1];
  return {
    attackId: attack.id,
    evaluatorId: attack.evaluatorId,
    patternName: attack.patternName,
    prompt: finalPrompt,
    response: finalResponse,
    judge: lastTurn?.judge ?? errorJudge("no turns completed"),
    turns: turns.length > 1 ? turns : undefined,
  };
}

// ---------------------------------------------------------------------------
// MCP attack runner
// ---------------------------------------------------------------------------

async function runMcpAttack(
  attack: AttackSpec,
  target: Awaited<ReturnType<typeof createMcpTarget>>,
  judgeModel: LanguageModel,
  config: RunConfig
): Promise<AttackResult> {
  const attackModel = resolveModel(config.attackLlm);
  const toolName = attack.toolName ?? "";
  const turns: McpTurnRecord[] = [];
  const mcpHistory: import("../generate/generateNextTurn.js").McpToolTurn[] = [];

  if (!toolName) {
    return {
      attackId: attack.id,
      evaluatorId: attack.evaluatorId,
      patternName: attack.patternName,
      toolName: "",
      toolArguments: {},
      toolResponse: "",
      toolError: "no toolName in attack spec",
      judge: mcpErrorJudge("no toolName in attack spec"),
    };
  }

  for (let t = 1; t <= attack.turns; t++) {
    let toolArguments: Record<string, unknown>;
    let judgeHint = attack.judgeHint;

    if (t === 1) {
      toolArguments = attack.toolArguments ?? {};
    } else {
      const next = await generateNextMcpTurn(
        mcpHistory,
        `${attack.patternName} — ${attack.evaluatorName}`,
        toolName,
        attack.toolArguments ?? {},
        attackModel
      );
      toolArguments = next.args;
      if (next.judgeHint) judgeHint = next.judgeHint;
    }

    const { response, toolError } = await target.callTool(toolName, toolArguments);

    const judge = await judgeToolResponse({
      model: resolveModelConfig(config.judgeLlm ?? config.attackLlm),
      evaluator: {
        id: attack.evaluatorId,
        name: attack.evaluatorName,
        ref: attack.ref,
        severity: attack.severity,
        passCriteria: attack.passCriteria,
        failCriteria: attack.failCriteria,
      },
      attackSummary: attack.patternName,
      toolName,
      toolArguments,
      toolResponse: response,
      toolError,
      judgeHint,
      priorTurns: mcpHistory.length > 0 ? mcpHistory : undefined,
    }).then((r) =>
      sanitizeJudgeResult(r, {
        attackSummary: attack.patternName,
        toolArguments,
        toolResponse: response,
        toolError,
      })
    );

    mcpHistory.push({
      toolName,
      toolArguments,
      response,
      toolError,
      judgeVerdict: judge.verdict,
      judgeReasoning: judge.reasoning,
    });

    turns.push({ kind: "mcp", turnIndex: t, toolName, toolArguments, response, toolError, judge });
  }

  const lastTurn = turns[turns.length - 1];
  return {
    attackId: attack.id,
    evaluatorId: attack.evaluatorId,
    patternName: attack.patternName,
    toolName,
    toolArguments: lastTurn?.toolArguments ?? attack.toolArguments,
    toolResponse: lastTurn?.response,
    toolError: lastTurn?.toolError,
    judge: lastTurn?.judge ?? mcpErrorJudge("no turns completed"),
    turns: turns.length > 1 ? turns : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveEvaluatorIds(selection: RunConfig["selection"]): Promise<string[]> {
  if (selection.mode === "evaluators") return selection.evaluators;
  try {
    const catalog = await loadSkillCatalog();
    return resolveSuiteEvaluatorIds(selection.suite, catalog.suites);
  } catch {
    log.warn(`Suite "${selection.suite}" not found — falling back to empty list`);
    return [];
  }
}

function resolveModel(cfg: LlmConfig): LanguageModel {
  return createModel(cfg);
}

async function curateTracesIfConfigured(
  config: RunConfig,
  model: LanguageModel,
  outputDir: string | undefined
): Promise<string | undefined> {
  const tel = config.telemetry;
  if (!tel || !getAdapter(tel.provider)) return undefined;
  log.info(`Fetching ${tel.provider} traces...`);
  try {
    const ctx = await runSetupTraceCuration({
      telemetry: tel,
      model,
      targetName: config.target.name,
      targetDescription: (config.target as { description?: string }).description ?? "",
      outputDir: outputDir ?? process.cwd(),
    });
    if (ctx?.trim()) log.info(`✓ Traces analysed — attacks grounded in real usage`);
    return ctx;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Trace curation failed (continuing without grounding): ${msg}`);
    return undefined;
  }
}

async function buildJudgeObservability(
  config: RunConfig,
  attackTraceId: string | undefined,
  finalResponse: string
): Promise<JudgeObservabilityContext | undefined> {
  const tel = config.telemetry;
  if (!tel || !attackTraceId) return undefined;
  const obs: JudgeObservabilityContext = { propagatedTraceId: attackTraceId };
  const adapter = getAdapter(tel.provider);
  if (adapter && tel.enrichJudgeFromTrace && !isTargetError(finalResponse)) {
    log.info(`  → fetching ${tel.provider} trace for judge...`);
    const traceJson =
      (await adapter.fetchTraceForJudge(tel, attackTraceId, {
        initialDelayMs: tel.traceFetchInitialDelayMs ?? 500,
        maxAttempts: tel.traceFetchMaxAttempts ?? 5,
        retryDelayMs: tel.traceFetchRetryDelayMs ?? 400,
        maxChars: tel.enrichJudgeTraceJsonMaxChars ?? 40_000,
      })) ?? undefined;
    if (traceJson) obs.traceJson = traceJson;
    const ok = traceJson && !traceJson.startsWith("[");
    log.info(`  → trace ${ok ? "fetched ✓" : "not found ✗"}`);
  }
  return obs;
}

function resolveModelConfig(cfg: LlmConfig): import("../config/schema.js").ModelConfig {
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKeyEnv: cfg.apiKeyEnv,
    baseURL: cfg.baseURL,
  };
}

function buildReport(config: RunConfig, evaluators: EvaluatorResult[]): UnifiedRunReport {
  const allAttacks = evaluators.flatMap((e) => e.attacks);
  const total = allAttacks.length;
  const passed = allAttacks.filter((a) => a.judge.verdict === "PASS").length;
  const failed = allAttacks.filter((a) => a.judge.verdict === "FAIL").length;
  const errors = allAttacks.filter((a) => a.judge.verdict === "ERROR").length;
  const safetyScore = total > 0 ? Math.round((passed / total) * 100) : 100;
  const attackSuccessRate = total > 0 ? Math.round((failed / total) * 100) : 0;

  const attackModel = `${config.attackLlm.provider}/${config.attackLlm.model}`;
  const judgeModel = config.judgeLlm
    ? `${config.judgeLlm.provider}/${config.judgeLlm.model}`
    : attackModel;

  return {
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),
    targetName: config.target.name,
    targetKind: config.target.kind,
    effort: config.effort,
    attackModel,
    judgeModel,
    summary: { total, passed, failed, errors, safetyScore, attackSuccessRate },
    evaluators,
  };
}
