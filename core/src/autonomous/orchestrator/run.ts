// Orchestrator: build the run context, wire the Claude Agent SDK query() with
// the commander system prompt + scout/operator subagents + custom tools, drive
// the autonomous loop, and map the captured RunLog into a report.

import { randomUUID } from "node:crypto";
import { query, type Options, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { HuntOptions } from "../lib/types.js";
import { createTargetClient } from "../target/http.js";
import { loadKnowledge } from "../knowledge/load.js";
import { createRunLog } from "../state/runLog.js";
import { BudgetGuard } from "../lib/budget.js";
import { SessionGate } from "../../lib/sessionGate.js";
import type { RunContext } from "./context.js";
import { buildRedteamServer, REDTEAM_SERVER_NAME, toolId, TOOL_NAMES } from "../tools/server.js";
import { buildHooks, type ProgressReporter } from "../state/hooks.js";
import { threadTreeText, countsLine } from "../state/observe.js";
import { buildCommanderPrompt } from "../prompts/commander.js";
import { buildOperatorPrompt } from "../prompts/operator.js";
import { buildScoutPrompt } from "../prompts/scout.js";
import { mapRunLogToReport } from "../report/mapRunLog.js";
import { generateForcedSynthesis } from "../report/forceSynthesis.js";
import type { AutonomousReport } from "../report/types.js";

const t = TOOL_NAMES;

/** Subagent-dispatch tool names (the SDK exposes the Agent/Task tool). */
const DISPATCH_TOOLS = ["Agent", "Task"];

/**
 * Build the environment for the spawned Claude Agent SDK process.
 *
 * Critical when running INSIDE another Claude Code/Cursor session: the child
 * would otherwise inherit the parent's session markers (CLAUDECODE, session id)
 * and use the PARENT's stored credentials instead of the configured gateway key.
 * We strip those markers so the child authenticates cleanly with ANTHROPIC_API_KEY
 * (+ ANTHROPIC_BASE_URL) as provided by the user.
 */
function buildChildEnv(): Record<string, string> {
  const stripPrefixes = ["CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK", "CLAUDE_EFFORT"];
  // CLAUDE_CODE_OAUTH_TOKEN is a user-supplied subscription token (`claude setup-token`),
  // not an inherited session marker — preserve it so the SDK can authenticate with it.
  const preserveExact = new Set(["CLAUDE_CODE_OAUTH_TOKEN"]);
  const stripExact = new Set([
    "AI_AGENT",
    "CURSOR_SPAWNED_BY_EXTENSION_ID",
    "CURSOR_SPAWN_CHAIN",
    "CLAUDE_CODE_SSE_PORT",
  ]);
  // Strip inherited OAuth tokens unless routing through an explicit gateway (LiteLLM, …).
  if (!process.env.ANTHROPIC_BASE_URL?.trim()) {
    stripExact.add("ANTHROPIC_AUTH_TOKEN");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (stripExact.has(k)) continue;
    if (!preserveExact.has(k) && stripPrefixes.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
}

export interface RunHooks {
  progress?: ProgressReporter;
  /** Called once the in-memory RunLog is created — used by the live UI for snapshots. */
  onRunLog?: (runLog: import("../state/runLog.js").RunLog) => void;
}

export async function runAutonomous(
  options: HuntOptions,
  runHooks?: RunHooks
): Promise<AutonomousReport> {
  const target = createTargetClient(options.target);
  const knowledge = await loadKnowledge(options.seedDir);

  if (knowledge.vulnClasses.length === 0) {
    throw new Error(
      "No vulnerability-class seeds were loaded. Check the data/ directory or --seed-dir."
    );
  }

  const runLog = createRunLog({
    runId: randomUUID(),
    objective: options.objective,
    targetName: options.target.name,
    targetEndpoint: options.target.endpoint,
  });
  runHooks?.onRunLog?.(runLog);

  const verifyEnabled = options.verify && Boolean(process.env.ANTHROPIC_API_KEY);
  const budget = new BudgetGuard({
    maxThreadTurns: options.maxThreadTurns,
    budgetUsd: options.budgetUsd,
    maxTotalThreads: options.maxTotalThreads,
    maxForksPerThread: options.maxForksPerThread,
    maxDepth: options.maxDepth,
    maxTotalSends: options.maxTotalSends,
  });

  const ctx: RunContext = {
    options,
    target,
    knowledge,
    runLog,
    budget,
    sessionGate: new SessionGate(),
    verifyEnabled,
    reporter: runHooks?.progress,
  };
  const server = buildRedteamServer(ctx);

  // Tool grants.
  const operatorTools = [
    toolId(t.listKnowledge),
    toolId(t.getKnowledge),
    toolId(t.sendToTarget),
    toolId(t.forkThread),
    toolId(t.getThread),
    toolId(t.flagLead),
    toolId(t.recordFinding),
    toolId(t.registerInvention),
  ];
  if (verifyEnabled) operatorTools.push(toolId(t.selfCheck));

  const scoutTools = [toolId(t.reconProbe), toolId(t.listKnowledge)];

  const agents: Record<string, AgentDefinition> = {
    scout: {
      description: "Benign reconnaissance specialist — fingerprints the target without attacking.",
      prompt: buildScoutPrompt(),
      tools: scoutTools,
      model: options.scoutModel,
    },
    operator: {
      description:
        "Adversarial specialist — owns one vulnerability vector, runs an adaptive multi-turn attack, self-judges, and records findings.",
      prompt: buildOperatorPrompt(options),
      tools: operatorTools,
      model: options.operatorModel,
    },
  };

  // Commander tool grants (commander delegates attacking; no send_to_target).
  const commanderTools = [
    toolId(t.reconProbe),
    toolId(t.listKnowledge),
    toolId(t.getKnowledge),
    toolId(t.getThread),
    toolId(t.listLeads),
    toolId(t.recordFinding),
    toolId(t.registerInvention),
    toolId(t.submitReport),
    ...DISPATCH_TOOLS,
  ];
  if (verifyEnabled) commanderTools.push(toolId(t.selfCheck));

  const queryOptions: Options = {
    systemPrompt: buildCommanderPrompt({ options, knowledge }),
    model: options.commanderModel,
    agents,
    mcpServers: { [REDTEAM_SERVER_NAME]: server },
    allowedTools: commanderTools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: options.maxTurns,
    env: buildChildEnv(),
    hooks: buildHooks(runLog, runHooks?.progress),
    // We never want the agent touching the local filesystem/shell.
    disallowedTools: ["Bash", "Read", "Write", "Edit", "WebFetch", "WebSearch", "Glob", "Grep"],
  };

  const kickoff = `Begin the autonomous red-team assessment now. Start with reconnaissance, then plan and dispatch your operators. Objective:\n"""\n${options.objective}\n"""`;

  const q = query({ prompt: kickoff, options: queryOptions });
  const reporter = runHooks?.progress;

  reporter?.onLine("Autonomous assessment started — commander initializing…");

  // Tracks last reported cost threshold so we only emit a cost line every $0.10.
  let lastReportedCostUsd = 0;

  try {
    for await (const message of q) {
      if (message.type === "assistant") {
        const text = message.message.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .filter(Boolean)
          .join("\n")
          .trim();
        if (text && reporter) {
          const who = message.subagent_type ? `[${message.subagent_type}]` : "[commander]";
          reporter.onLine(`${who} 💭 ${text.length > 400 ? text.slice(0, 400) + "…" : text}`);
        }

        // Accumulate token cost in real time so isOverBudget() fires mid-stream.
        const usage = message.message.usage;
        if (usage) {
          const modelHint =
            message.subagent_type === "operator"
              ? options.operatorModel
              : message.subagent_type === "scout"
                ? options.scoutModel
                : options.commanderModel;
          budget.recordTokenUsage(
            {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
              cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
            },
            modelHint
          );
        }

        // Emit a cost progress line at most once per $0.10 increment.
        if (budget.budgetUsd && reporter) {
          const spent = budget.spentUsd;
          if (spent - lastReportedCostUsd >= 0.1) {
            reporter.onLine(`💰 ~$${spent.toFixed(2)} / $${budget.budgetUsd} budget used`);
            lastReportedCostUsd = spent;
          }
        }

        // Mid-stream budget check — fires as soon as token accumulation crosses the ceiling.
        if (budget.isOverBudget() && !runLog.completed) {
          runLog.truncated = true;
          runLog.truncationReason = `USD budget ($${budget.budgetUsd}) reached`;
          reporter?.onLine(`⚠️  budget ceiling reached — finalizing partial report`);
          await q.interrupt().catch(() => {});
          break;
        }
      } else if (message.type === "result") {
        if ("total_cost_usd" in message && typeof message.total_cost_usd === "number") {
          // Authoritative server cost — corrects any token-estimate drift.
          budget.recordCost(message.total_cost_usd);
          runLog.totalCostUsd = message.total_cost_usd;
        }
        if (message.subtype !== "success") {
          runLog.truncated = true;
          runLog.truncationReason = `run ended with: ${message.subtype}`;
          reporter?.onLine(`⚠️  run ended early: ${message.subtype}`);
        }

        // Post-result budget check (catches cases where the result itself pushes us over).
        if (budget.isOverBudget() && !runLog.completed) {
          runLog.truncated = true;
          runLog.truncationReason = `USD budget ($${budget.budgetUsd}) reached`;
          reporter?.onLine(`⚠️  budget ceiling reached — finalizing partial report`);
          await q.interrupt().catch(() => {});
          break;
        }
      }
    }
  } catch (err) {
    // A mid-run failure (e.g. provider usage-policy block, network error) must
    // NOT lose the findings already captured in the RunLog. Mark the run
    // truncated and fall through to build a partial report.
    const message = err instanceof Error ? err.message : String(err);
    runLog.truncated = true;
    runLog.truncationReason = `run interrupted: ${message.slice(0, 300)}`;
    reporter?.onLine(
      `⚠️  run interrupted — finalizing partial report from ${runLog.findings.length} finding(s)`
    );
    reporter?.onLine(`    reason: ${message.slice(0, 200)}`);
  } finally {
    q.close();
  }

  if (!runLog.completed && !runLog.truncated) {
    // Stream ended without a submit_report (e.g. agent stopped early).
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
  // early agent stops — any case where runLog.synthesis is still undefined.
  if (runLog.truncated && !runLog.completed && !runLog.synthesis) {
    const remainingBudgetUsd =
      budget.budgetUsd !== undefined ? budget.budgetUsd - budget.spentUsd : undefined;
    reporter?.onLine("⏳ Generating synthesis from partial run data…");
    const synthesis = await generateForcedSynthesis(runLog, options, remainingBudgetUsd);
    if (synthesis) {
      runLog.synthesis = synthesis;
      reporter?.onLine("✓ Partial synthesis complete");
    }
  }

  const report = mapRunLogToReport(runLog);
  report.commanderModel = options.commanderModel;
  report.operatorModel = options.operatorModel;
  return report;
}
