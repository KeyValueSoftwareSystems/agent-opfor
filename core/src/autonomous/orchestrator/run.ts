// Orchestrator: build the run context, construct the commander/operator/scout agents over the
// shared red-team toolset, drive the autonomous loop, and map the captured RunLog into a report.

import { randomUUID } from "node:crypto";
import type { ToolSet, StepResult, LanguageModel } from "ai";
import type { HuntOptions } from "../lib/types.js";
import { createTargetClient } from "../target/http.js";
import { loadKnowledge } from "../knowledge/load.js";
import { createRunLog } from "../state/runLog.js";
import { BudgetGuard } from "../lib/budget.js";
import { SessionGate } from "../../lib/sessionGate.js";
import type { RunContext } from "./context.js";
import { buildRedteamTools, toolId, TOOL_NAMES } from "../tools/server.js";
import {
  dispatchOperatorTool,
  dispatchScoutTool,
  type SubAgentLauncher,
} from "../tools/dispatch.js";
import { buildAgent, brainModel, runAgent, toAiTools, type AgentRole } from "./agentLoop.js";
import { recordStep, type ProgressReporter } from "../state/hooks.js";
import { threadTreeText, countsLine } from "../state/observe.js";
import { buildCommanderPrompt } from "../prompts/commander.js";
import {
  curateHuntTracesIfConfigured,
  telemetryCapabilities,
  probeTraceRoundTrip,
  type TraceRoundTrip,
} from "../lib/telemetry.js";
import { buildOperatorPrompt } from "../prompts/operator.js";
import { buildScoutPrompt } from "../prompts/scout.js";
import { mapRunLogToReport } from "../report/mapRunLog.js";
import { generateForcedSynthesis } from "../report/forceSynthesis.js";
import type { AutonomousReport } from "../report/types.js";

const t = TOOL_NAMES;

/**
 * Per-agent step ceilings. A "step" is one model turn, which may carry several tool calls, so
 * these are generous relative to the turn budgets they serve — they exist as runaway backstops,
 * not operating limits (the agents stop on judgment; see the adaptive decision policy prompts).
 */
const STEPS_PER_THREAD_TURN = 3;
const SCOUT_STEP_SLACK = 4;

export interface RunHooks {
  progress?: ProgressReporter;
  /** Called once the in-memory RunLog is created — used by the live UI for snapshots. */
  onRunLog?: (runLog: import("../state/runLog.js").RunLog) => void;
  /** Abort to stop the run early and finalize a partial (truncated) report instead of throwing. */
  signal?: AbortSignal;
}

/** Truncation reason recorded when a run is stopped by the user rather than a ceiling/error. */
const USER_INTERRUPT_REASON = "interrupted by user (Ctrl+C)";

export async function runAutonomous(
  options: HuntOptions,
  runHooks?: RunHooks
): Promise<AutonomousReport> {
  const reporter = runHooks?.progress;
  const signal = runHooks?.signal;
  const target = createTargetClient(options.target);
  const knowledge = await loadKnowledge(options.seedDir);

  if (knowledge.vulnClasses.length === 0) {
    throw new Error(
      "No vulnerability-class seeds were loaded. Check the data/ directory or --seed-dir."
    );
  }

  // Created only after the checks above — a bad config should fail with zero artifacts, not an
  // empty report folder. Handed off via `onRunLog` before any progress event can fire.
  const runLog = createRunLog({
    runId: randomUUID(),
    objective: options.objective,
    targetName: options.target.name,
    targetEndpoint: options.target.endpoint,
  });
  runHooks?.onRunLog?.(runLog);

  const verifyEnabled = options.verify;
  const budget = new BudgetGuard({
    maxThreadTurns: options.maxThreadTurns,
    budgetUsd: options.budgetUsd,
    maxTotalThreads: options.maxTotalThreads,
    maxForksPerThread: options.maxForksPerThread,
    maxDepth: options.maxDepth,
    maxTotalSends: options.maxTotalSends,
  });

  // Shared tail: map whatever the run captured (complete or partial) into a report. Defined
  // early so an abort caught during telemetry preflight — before the agents even exist — can
  // finalize the same way a mid-run interrupt does, instead of duplicating the logic.
  async function finalize(): Promise<AutonomousReport> {
    if (!runLog.completed && !runLog.truncated) {
      // Loop ended without a submit_report (e.g. agent stopped early).
      runLog.truncated = runLog.findings.length === 0 && runLog.threads.size === 0;
      if (runLog.truncated) runLog.truncationReason = "agent ended without producing activity";
    }

    // Final exploration shape — the branching tree + tallies, for the live log.
    if (reporter) {
      reporter.onLine(countsLine(runLog));
      reporter.onLine("Attack tree:\n" + threadTreeText(runLog));
    }

    // Generate a real synthesis narrative when the run was interrupted before the
    // commander could call submit_report. Fires for budget exhaustion, errors, and
    // early agent stops — any case where runLog.synthesis is still undefined. Skipped when
    // nothing was captured at all (e.g. cancelled before the agents even started) — an LLM
    // call has nothing to synthesize there, and it would defeat the point of honoring
    // cancellation promptly; mapRunLogToReport's deterministic fallback covers this case.
    const hasActivity =
      runLog.threads.size > 0 || runLog.findings.length > 0 || runLog.recon.length > 0;
    if (runLog.truncated && !runLog.completed && !runLog.synthesis && hasActivity) {
      const remainingBudgetUsd =
        budget.budgetUsd !== undefined ? budget.budgetUsd - budget.spentUsd : undefined;
      reporter?.onLine("⏳ Generating synthesis from partial run data…");
      const synthesis = await generateForcedSynthesis(runLog, options, remainingBudgetUsd, budget);
      if (synthesis) {
        runLog.synthesis = synthesis;
        reporter?.onLine("✓ Partial synthesis complete");
      }
    }

    // Read the total only after synthesis, so its own cost is included.
    runLog.totalCostUsd = budget.spentUsd;

    const report = mapRunLogToReport(runLog);
    report.commanderModel = options.commanderModel;
    report.operatorModel = options.operatorModel;
    report.scoutModel = options.scoutModel;
    // Left unset when verification never ran, so the report doesn't advertise a verifier that
    // was never granted the self_check tool. The renderer falls back to "—".
    report.verifierModel = verifyEnabled
      ? (options.verifierModel ?? options.commanderModel)
      : undefined;
    return report;
  }

  // Honor cancellation before any telemetry preflight work — curation makes an LLM call and
  // the round-trip probe sends a live request to the target, so a Ctrl+C at the very start of
  // the run must not let either fire.
  if (signal?.aborted) {
    runLog.truncated = true;
    runLog.truncationReason = USER_INTERRUPT_REASON;
    return finalize();
  }

  // Optional trace-aware grounding: curate historic production traces into a summary the
  // commander uses to target its attacks. No-op (undefined) unless telemetry is configured.
  const traceSummary = await curateHuntTracesIfConfigured(options, options.outputDir);
  if (traceSummary) {
    reporter?.onLine("Grounded attack planning on curated production traces.");
  }

  if (signal?.aborted) {
    runLog.truncated = true;
    runLog.truncationReason = USER_INTERRUPT_REASON;
    return finalize();
  }

  // Trace-aware capabilities are gated independently — grounding works on any instrumented
  // backend, but propagation + enrichment additionally need the target to echo our injected
  // trace id back into its telemetry. Verify that assumption once, up front, with one benign probe.
  const caps = telemetryCapabilities(options.telemetry);
  let traceRoundTrip: TraceRoundTrip | undefined;
  if (caps.propagation) {
    traceRoundTrip = await probeTraceRoundTrip(options.telemetry, target, runLog.runId);
    reporter?.onLine(
      traceRoundTrip === "ok"
        ? "Trace round-trip confirmed — the target echoes propagated trace ids to the backend."
        : "⚠️  Trace round-trip NOT detected — get_trace may return nothing. An empty trace is NOT " +
            "proof the target is clean; grounded planning is unaffected."
    );
  }
  if (caps.grounding) {
    runLog.telemetry = { grounded: Boolean(traceSummary), traceRoundTrip };
  }

  if (signal?.aborted) {
    runLog.truncated = true;
    runLog.truncationReason = USER_INTERRUPT_REASON;
    return finalize();
  }

  const ctx: RunContext = {
    options,
    target,
    knowledge,
    runLog,
    budget,
    sessionGate: new SessionGate(),
    verifyEnabled,
    telemetryCaps: caps,
    traceRoundTrip,
    traceCache: new Map(),
    reporter,
  };
  const registry = buildRedteamTools(ctx);

  // Tool grants. Each agent is CONSTRUCTED with only these — an ungranted tool doesn't exist
  // in its toolset, rather than being merely disallowed.
  const operatorToolNames = [
    toolId(t.listKnowledge),
    toolId(t.getKnowledge),
    toolId(t.sendToTarget),
    toolId(t.forkThread),
    toolId(t.getThread),
    toolId(t.flagLead),
    toolId(t.recordFinding),
    toolId(t.registerInvention),
  ];
  if (verifyEnabled) operatorToolNames.push(toolId(t.selfCheck));
  // get_trace only works when propagation is configured (a trace id was actually sent to the
  // target) — not merely when a provider is set. A grounding-only config must NOT offer it.
  if (caps.propagation) operatorToolNames.push(toolId(t.getTrace));

  const scoutToolNames = [toolId(t.reconProbe), toolId(t.listKnowledge)];

  // Commander delegates attacking; no send_to_target.
  const commanderToolNames = [
    toolId(t.reconProbe),
    toolId(t.listKnowledge),
    toolId(t.getKnowledge),
    toolId(t.getThread),
    toolId(t.listLeads),
    toolId(t.recordFinding),
    toolId(t.registerInvention),
    toolId(t.submitReport),
    toolId(t.dispatchOperator),
    toolId(t.dispatchScout),
  ];
  if (verifyEnabled) commanderToolNames.push(toolId(t.selfCheck));
  if (caps.propagation) commanderToolNames.push(toolId(t.getTrace));

  // One controller drives every agent: the user's Ctrl+C and the budget ceiling both abort here,
  // which stops in-flight subagents too rather than letting a wave run on after the stop.
  const runController = new AbortController();
  const onAbort = (): void => {
    reporter?.onLine("⏹  interrupt received — stopping agents, finalizing a partial report…");
    runController.abort();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  // Tracks last reported cost threshold so we only emit a cost line every $0.10.
  let lastReportedCostUsd = 0;

  /** Per-step bookkeeping shared by all three roles: audit trail, live text, usage, budget. */
  function observeStep(role: AgentRole, model: LanguageModel) {
    return (step: StepResult<ToolSet>): void => {
      recordStep(runLog, step, role);

      const text = step.text?.trim();
      if (text && reporter) {
        reporter.onLine(`[${role}] 💭 ${text.length > 400 ? text.slice(0, 400) + "…" : text}`);
      }

      budget.recordUsage(step.usage, model, role);

      if (budget.budgetUsd && reporter) {
        const spent = budget.spentUsd;
        if (spent - lastReportedCostUsd >= 0.1) {
          reporter.onLine(`💰 ~$${spent.toFixed(2)} / $${budget.budgetUsd} budget used`);
          lastReportedCostUsd = spent;
        }
      }

      // Mid-run budget check — aborts every agent as soon as the estimate crosses the ceiling.
      if (budget.isOverBudget() && !runLog.completed && !runController.signal.aborted) {
        runLog.truncated = true;
        runLog.truncationReason = `USD budget ($${budget.budgetUsd}) reached`;
        reporter?.onLine(`⚠️  budget ceiling reached — finalizing partial report`);
        runController.abort();
      }
    };
  }

  const operatorModel = brainModel(options, options.operatorModel);
  const scoutModel = brainModel(options, options.scoutModel);
  const commanderModel = brainModel(options, options.commanderModel);

  const operatorAgent = buildAgent({
    role: "operator",
    instructions: buildOperatorPrompt(options, { caps, traceRoundTrip }),
    model: operatorModel,
    tools: toAiTools(registry, operatorToolNames),
    maxSteps: options.maxThreadTurns * STEPS_PER_THREAD_TURN,
  });

  const scoutAgent = buildAgent({
    role: "scout",
    instructions: buildScoutPrompt(),
    model: scoutModel,
    tools: toAiTools(registry, scoutToolNames),
    maxSteps: options.maxReconProbes + SCOUT_STEP_SLACK,
  });

  const launcher: SubAgentLauncher = {
    runOperator: (briefing) =>
      runAgent(operatorAgent, briefing, {
        signal: runController.signal,
        onStep: observeStep("operator", operatorModel),
      }),
    runScout: (briefing) =>
      runAgent(scoutAgent, briefing, {
        signal: runController.signal,
        onStep: observeStep("scout", scoutModel),
      }),
  };

  const commanderRegistry = {
    ...registry,
    [t.dispatchOperator]: dispatchOperatorTool(ctx, launcher),
    [t.dispatchScout]: dispatchScoutTool(ctx, launcher),
  };

  const commanderAgent = buildAgent({
    role: "commander",
    instructions: buildCommanderPrompt({ options, knowledge, traceSummary, caps }),
    model: commanderModel,
    tools: toAiTools(commanderRegistry, commanderToolNames),
    maxSteps: options.maxTurns,
  });

  const kickoff = `Begin the autonomous red-team assessment now. Start with reconnaissance, then plan and dispatch your operators. Objective:\n"""\n${options.objective}\n"""`;

  reporter?.onLine("Autonomous assessment started — commander initializing…");

  try {
    // Last cancellation checkpoint before any model call.
    if (runController.signal.aborted) {
      runLog.truncated = true;
      if (!runLog.truncationReason) runLog.truncationReason = USER_INTERRUPT_REASON;
    } else {
      await commanderAgent.generate({
        prompt: kickoff,
        abortSignal: runController.signal,
        onStepFinish: observeStep("commander", commanderModel),
      });
    }
  } catch (err) {
    // A mid-run failure or the abort itself must not lose captured findings — mark truncated
    // and fall through to a partial report.
    const message = err instanceof Error ? err.message : String(err);
    runLog.truncated = true;
    if (signal?.aborted) {
      runLog.truncationReason = USER_INTERRUPT_REASON;
      reporter?.onLine(
        `⏹  run interrupted — finalizing partial report from ${runLog.findings.length} finding(s)`
      );
    } else if (runController.signal.aborted && runLog.truncationReason) {
      // Budget abort — reason already set by observeStep; don't overwrite it with the
      // AbortError that surfaced as a consequence.
      reporter?.onLine(
        `⚠️  run stopped — finalizing partial report from ${runLog.findings.length} finding(s)`
      );
    } else {
      runLog.truncationReason = `run interrupted: ${message.slice(0, 300)}`;
      reporter?.onLine(
        `⚠️  run interrupted — finalizing partial report from ${runLog.findings.length} finding(s)`
      );
      reporter?.onLine(`    reason: ${message.slice(0, 200)}`);
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  // Safety net: if the caller aborted but neither the loop nor the catch labelled it (e.g. the
  // agent returned cleanly right as the interrupt landed), still mark it a user interrupt.
  if (signal?.aborted && !runLog.completed && !runLog.truncated) {
    runLog.truncated = true;
    runLog.truncationReason = USER_INTERRUPT_REASON;
  }

  return finalize();
}
