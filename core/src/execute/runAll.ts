import { randomUUID } from "../lib/random.js";
import type { LanguageModel } from "ai";
import type {
  RunConfig,
  AttackSpec,
  AttackResult,
  EvaluatorResult,
  UnifiedRunReport,
  McpTurnRecord,
  SessionContext,
} from "./types.js";
import { generateAttacks, type ToolInfo } from "../generate/generateAttacks.js";
import { generateNextMcpTurn } from "../generate/generateNextTurn.js";
import { createAgentTarget } from "../targets/agentTarget.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import { createMcpTarget } from "../targets/mcpTarget.js";
import { loadBuiltinEvaluator } from "../evaluators/parseEvaluator.js";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import { loadSkillCatalog, resolveSuiteEvaluatorIds } from "../config/loadSkillCatalog.js";
import { loadCatalog } from "../catalog/loadCatalog.js";
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

  const attackModel = resolveModel(config.attackerLlm);
  const judgeModel = resolveModel(config.judgeLlm ?? config.attackerLlm);

  const isMcp = config.target.kind === "mcp";
  const evaluators = await resolveEvaluators(config.selection, isMcp ? "mcp" : "agent", config.selection.dependsOn);

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

  const ordered = topoSortEvaluators(evaluators);
  const sessionMap = new Map<string, SessionContext>();
  const evaluatorResults: EvaluatorResult[] = [];

  try {
    for (const evaluator of ordered) {
      notify({ type: "evaluator_start", evaluatorId: evaluator.id, evaluatorName: evaluator.name });

      const deps = evaluator.dependsOn ?? [];
      const missing = deps.filter((d) => !sessionMap.has(d));
      if (missing.length > 0) {
        log.warn(`\n⚠ ${evaluator.name}: skipping — missing dependency sessions: ${missing.join(", ")}`);
        continue;
      }

      const upstreamSessions = deps.length > 0
        ? deps.map((d) => sessionMap.get(d)!).filter(Boolean)
        : undefined;

      if (upstreamSessions?.length) {
        const depNames = upstreamSessions.map((s) => s.evaluatorName).join(", ");
        log.info(`\n▶ ${evaluator.name} (${evaluator.id}) [depends on: ${depNames}]`);
      } else {
        log.info(`\n▶ ${evaluator.name} (${evaluator.id})`);
      }

      const turnMode: "single" | "multi" =
        config.turnMode ?? (config.turns > 1 ? "multi" : "single");
      const effectiveTurns = turnMode === "single" ? 1 : config.turns;

      const attacks = await generateAttacks({
        evaluator,
        target: config.target,
        effort: config.effort,
        model: attackModel,
        turns: effectiveTurns,
        turnMode,
        options: { tools, traceContext, upstreamSessions },
      });

      log.info(`  ${attacks.length} attack(s) generated [effort: ${config.effort}]`);

      const attackResults: AttackResult[] = [];

      for (const attack of attacks) {
        if (upstreamSessions?.length) {
          attack.upstreamSessions = upstreamSessions;
        }

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
        standards: evaluator.standards,
        severity: evaluator.severity,
        total,
        passed,
        failed,
        errors,
        passRate: total > 0 ? passed / total : 0,
        attacks: attackResults,
      });

      sessionMap.set(evaluator.id, captureSessionContext(evaluator, attackResults));
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
  const attackModel = resolveModel(config.attackerLlm);
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
        model: resolveModelConfig(config.judgeLlm ?? config.attackerLlm),
        evaluator: {
          id: attack.evaluatorId,
          name: attack.evaluatorName,
          standards: attack.standards,
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
// Dependency resolution
// ---------------------------------------------------------------------------

/**
 * Topological sort of evaluators based on `dependsOn` edges.
 * Evaluators with no dependencies come first; dependents come after all
 * their dependencies. Throws on cycles.
 */
function topoSortEvaluators(evaluators: EvaluatorSpec[]): EvaluatorSpec[] {
  const idSet = new Set(evaluators.map((e) => e.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const byId = new Map<string, EvaluatorSpec>();

  for (const e of evaluators) {
    byId.set(e.id, e);
    inDegree.set(e.id, 0);
    adj.set(e.id, []);
  }

  for (const e of evaluators) {
    for (const dep of e.dependsOn ?? []) {
      if (!idSet.has(dep)) continue;
      adj.get(dep)!.push(e.id);
      inDegree.set(e.id, (inDegree.get(e.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: EvaluatorSpec[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(byId.get(id)!);
    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (sorted.length < evaluators.length) {
    const stuck = evaluators.filter((e) => !sorted.includes(e)).map((e) => e.id);
    throw new Error(`Circular depends_on detected among evaluators: ${stuck.join(", ")}`);
  }

  return sorted;
}

/**
 * Capture session context from a completed evaluator run so downstream
 * evaluators can reference what happened in this session.
 */
function captureSessionContext(
  evaluator: EvaluatorSpec,
  attackResults: AttackResult[]
): SessionContext {
  const allTurns = attackResults.flatMap((r) => r.turns ?? []);
  const history: SessionContext["history"] = [];

  for (const r of attackResults) {
    if (r.turns?.length) {
      for (const t of r.turns) {
        if (t.kind === "agent") {
          history.push({ role: "user", content: t.prompt });
          history.push({ role: "assistant", content: t.response });
        } else {
          history.push({ role: "user", content: `[tool:${t.toolName}] ${JSON.stringify(t.toolArguments)}` });
          history.push({ role: "assistant", content: t.response });
        }
      }
    } else if (r.prompt && r.response) {
      history.push({ role: "user", content: r.prompt });
      history.push({ role: "assistant", content: r.response });
    } else if (r.toolName && r.toolResponse) {
      history.push({ role: "user", content: `[tool:${r.toolName}] ${JSON.stringify(r.toolArguments)}` });
      history.push({ role: "assistant", content: r.toolResponse });
    }
  }

  return {
    evaluatorId: evaluator.id,
    evaluatorName: evaluator.name,
    turns: allTurns,
    results: attackResults.map((r) => ({
      attackId: r.attackId,
      patternName: r.patternName,
      verdict: r.judge.verdict,
    })),
    history,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveEvaluators(
  selection: RunConfig["selection"],
  targetKind: "agent" | "mcp",
  configDependsOn?: Record<string, string[]>
): Promise<import("../evaluators/parseEvaluator.js").EvaluatorSpec[]> {
  let specs: EvaluatorSpec[];

  if (selection.mode === "preloaded") {
    specs = selection.evaluators;
  } else {
    let ids: string[];
    if (selection.mode === "evaluators") {
      ids = selection.evaluators;
    } else {
      try {
        const catalog = targetKind === "mcp" ? await loadCatalog() : await loadSkillCatalog();
        ids = resolveSuiteEvaluatorIds(selection.suite, catalog.suites);
      } catch {
        log.warn(`Suite "${selection.suite}" not found — falling back to empty list`);
        return [];
      }
    }

    const loaded = await Promise.all(
      ids.map((id) => loadBuiltinEvaluator(id, targetKind).catch(() => null))
    );
    specs = loaded.filter(
      (s): s is EvaluatorSpec => s !== null
    );
    const skipped = ids.length - specs.length;
    if (skipped > 0) log.warn(`${skipped} evaluator(s) not found — skipped`);
  }

  if (configDependsOn) {
    specs = applyConfigDependsOn(specs, configDependsOn);
  }

  return specs;
}

/**
 * Merge config-level `dependsOn` into evaluator specs. Config-level deps
 * are additive — they extend (not replace) any deps declared in the
 * evaluator's YAML frontmatter.
 */
function applyConfigDependsOn(
  specs: EvaluatorSpec[],
  configDeps: Record<string, string[]>
): EvaluatorSpec[] {
  return specs.map((spec) => {
    const extra = configDeps[spec.id];
    if (!extra?.length) return spec;

    const existing = new Set(spec.dependsOn ?? []);
    for (const dep of extra) existing.add(dep);

    return { ...spec, dependsOn: [...existing] };
  });
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

  const attackModel = `${config.attackerLlm.provider}/${config.attackerLlm.model}`;
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
