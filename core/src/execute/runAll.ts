import { randomUUID } from "../lib/random.js";
import type { LanguageModel } from "ai";
import type { RunConfig, EvaluatorResult, UnifiedRunReport } from "./types.js";
import type { ToolInfo } from "../generate/generateAttacks.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import { createMcpTarget } from "../targets/mcpTarget.js";
import { loadBuiltinEvaluator } from "../evaluators/parseEvaluator.js";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import { loadSkillCatalog, resolveSuiteEvaluatorIds } from "../config/loadSkillCatalog.js";
import { loadCatalog } from "../catalog/loadCatalog.js";
import { runBaselineScans } from "./baselineScanner.js";
import { runEvaluatorAttacks } from "./evaluatorLoop.js";
import { buildUnifiedReport, modelLabel } from "./aggregate.js";
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
  | { type: "evaluator_done"; evaluatorId: string; passed: number; failed: number; errors: number }
  | { type: "run_stopped"; reason: string };

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
  // Single source of truth for the judge LLM: explicit judge model, else the
  // attacker model. Reused by the baseline scans and the MCP dispatch below so
  // the fallback can't drift between paths.
  const judgeLlmConfig = config.judgeLlm ?? config.attackerLlm;
  const judgeModel = resolveModel(judgeLlmConfig);

  const isMcp = config.target.kind === "mcp";
  const evaluators = await resolveEvaluators(
    config.selection,
    isMcp ? "mcp" : "agent",
    config.selection.dependsOn
  );

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
  const evaluatorResults: EvaluatorResult[] = [];
  let stopReason: string | undefined;

  try {
    // ── MCP pre-flight scans (always run for MCP targets) ──────────────
    if (isMcp && mcpTarget) {
      evaluatorResults.push(
        ...(await runBaselineScans({
          target: mcpTarget,
          tools,
          judgeModelConfig: judgeLlmConfig,
          config,
          outputDir: options?.outputDir,
          notify,
        }))
      );
    }

    // ── Evaluator attack loop (topo-sorted by dependencies) ───────────
    const loop = await runEvaluatorAttacks({
      ordered,
      config,
      attackModel,
      judgeModel,
      judgeLlmConfig,
      mcpTarget,
      tools,
      traceContext,
      agentTarget: options?.agentTarget,
      notify,
    });
    evaluatorResults.push(...loop.evaluatorResults);
    stopReason = loop.stopReason;
  } finally {
    if (mcpTarget) await mcpTarget.close().catch(() => {});
  }

  // Build report (partial or complete) with stop reason if applicable
  const report = buildReport(config, evaluatorResults);
  if (stopReason) {
    (report as UnifiedRunReport & { stopReason?: string }).stopReason = stopReason;
  }
  return report;
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
    specs = loaded.filter((s): s is EvaluatorSpec => s !== null);
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

function buildReport(config: RunConfig, evaluators: EvaluatorResult[]): UnifiedRunReport {
  const { attackModel, judgeModel } = modelLabel(config.attackerLlm, config.judgeLlm);
  return buildUnifiedReport(
    {
      reportId: randomUUID(),
      generatedAt: new Date().toISOString(),
      targetName: config.target.name,
      targetKind: config.target.kind,
      effort: config.effort,
      attackModel,
      judgeModel,
    },
    evaluators
  );
}
