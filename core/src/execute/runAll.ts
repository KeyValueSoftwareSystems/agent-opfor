import { randomUUID } from "../lib/random.js";
import type { LanguageModel } from "ai";
import type {
  RunConfig,
  AttackSpec,
  AttackResult,
  EvaluatorResult,
  UnifiedRunReport,
  McpTurnRecord,
} from "./types.js";
import { generateAttacks, type ToolInfo } from "../generate/generateAttacks.js";
import { generateNextMcpTurn } from "../generate/generateNextTurn.js";
import { createAgentTarget } from "../targets/agentTarget.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import { createMcpTarget } from "../targets/mcpTarget.js";
import { loadBuiltinEvaluator } from "../evaluators/parseEvaluator.js";
import { loadSkillCatalog, resolveSuiteEvaluatorIds } from "../config/loadSkillCatalog.js";
import { runAgentAttack } from "./runAgentLoop.js";
import {
  judgeToolResponse,
  sanitizeJudgeResult,
  errorJudge as mcpErrorJudge,
} from "../run/judge.js";
import { createModel } from "../providers/factory.js";
import type { LlmConfig } from "../config/types.js";
import { getAdapter } from "../telemetry/adapter.js";
import { runSetupTraceCuration } from "../telemetry/curation.js";
import { log } from "../lib/logger.js";

export interface RunAllOptions {
  onProgress?: (event: ProgressEvent) => void;
  outputDir?: string;
  /** Pre-built agent target. When omitted, createAgentTarget is called using config.target. */
  agentTarget?: AgentTarget;
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

  const evaluators = await resolveEvaluators(config.selection);
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
    for (const evaluator of evaluators) {
      notify({ type: "evaluator_start", evaluatorId: evaluator.id, evaluatorName: evaluator.name });
      log.info(`\n▶ ${evaluator.name} (${evaluator.id})`);

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
          : await runAgentAttack(
              attack,
              attackModel,
              judgeModel,
              attack.id,
              evaluator.patterns,
              options?.agentTarget ??
                createAgentTarget(config.target as import("./types.js").AgentTargetConfig),
              { targetConfig: config.target, telemetry: config.telemetry }
            );

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

      notify({ type: "evaluator_done", evaluatorId: evaluator.id, passed, failed, errors });

      evaluatorResults.push({
        evaluatorId: evaluator.id,
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

  let judgeHint = attack.judgeHint;

  for (let t = 1; t <= attack.turns; t++) {
    let toolArguments: Record<string, unknown>;

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

    mcpHistory.push({ toolName, toolArguments, response, toolError });
    turns.push({ kind: "mcp", turnIndex: t, toolName, toolArguments, response, toolError });
  }

  // Judge the full tool-call sequence once after all turns (matches the
  // post-loop behaviour established by master c355551 #38).
  const lastTurn = turns[turns.length - 1];
  const finalJudge = !lastTurn
    ? mcpErrorJudge("no turns completed")
    : await judgeToolResponse({
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
        toolName: lastTurn.toolName,
        toolArguments: lastTurn.toolArguments,
        toolResponse: lastTurn.response,
        toolError: lastTurn.toolError,
        judgeHint,
        priorTurns: mcpHistory.length > 1 ? mcpHistory.slice(0, -1) : undefined,
      }).then((r) =>
        sanitizeJudgeResult(r, {
          attackSummary: attack.patternName,
          toolArguments: lastTurn.toolArguments,
          toolResponse: lastTurn.response,
          toolError: lastTurn.toolError,
        })
      );

  return {
    attackId: attack.id,
    evaluatorId: attack.evaluatorId,
    patternName: attack.patternName,
    toolName,
    toolArguments: lastTurn?.toolArguments ?? attack.toolArguments,
    toolResponse: lastTurn?.response,
    toolError: lastTurn?.toolError,
    judge: finalJudge,
    turns: turns.length > 1 ? turns : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveEvaluators(
  selection: RunConfig["selection"]
): Promise<import("../evaluators/parseEvaluator.js").EvaluatorSpec[]> {
  if (selection.mode === "preloaded") return selection.evaluators;

  let ids: string[];
  if (selection.mode === "evaluators") {
    ids = selection.evaluators;
  } else {
    try {
      const catalog = await loadSkillCatalog();
      ids = resolveSuiteEvaluatorIds(selection.suite, catalog.suites);
    } catch {
      log.warn(`Suite "${selection.suite}" not found — falling back to empty list`);
      return [];
    }
  }

  const specs = await Promise.all(ids.map((id) => loadBuiltinEvaluator(id).catch(() => null)));
  const valid = specs.filter(
    (s): s is import("../evaluators/parseEvaluator.js").EvaluatorSpec => s !== null
  );
  const skipped = ids.length - valid.length;
  if (skipped > 0) log.warn(`${skipped} evaluator(s) not found — skipped`);
  return valid;
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
