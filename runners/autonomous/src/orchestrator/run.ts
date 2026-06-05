// Orchestrator: build the run context, wire the Claude Agent SDK query() with
// the commander system prompt + recon/attacker subagents + custom tools, drive
// the autonomous loop, and map the captured RunLog into a report.

import { randomUUID } from "node:crypto";
import { query, type Options, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { AutoOptions } from "../lib/types.js";
import { createTargetClient } from "../target/http.js";
import { loadKnowledge } from "../knowledge/load.js";
import { createRunLog } from "../state/runLog.js";
import { BudgetGuard } from "../lib/budget.js";
import type { RunContext } from "./context.js";
import { buildRedteamServer, REDTEAM_SERVER_NAME, toolId, TOOL_NAMES } from "../tools/server.js";
import { buildHooks, type ProgressReporter } from "../state/hooks.js";
import { buildCommanderPrompt } from "../prompts/commander.js";
import { buildAttackerPrompt } from "../prompts/attacker.js";
import { buildReconPrompt } from "../prompts/recon.js";
import { mapRunLogToReport } from "../report/mapRunLog.js";
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
 * (+ ANTHROPIC_BASE_URL) as provided by the operator.
 */
function buildChildEnv(): Record<string, string> {
  const stripPrefixes = ["CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK", "CLAUDE_EFFORT"];
  const stripExact = new Set([
    "ANTHROPIC_AUTH_TOKEN",
    "AI_AGENT",
    "CURSOR_SPAWNED_BY_EXTENSION_ID",
    "CURSOR_SPAWN_CHAIN",
    "CLAUDE_CODE_SSE_PORT",
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (stripExact.has(k)) continue;
    if (stripPrefixes.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
}

export interface RunHooks {
  progress?: ProgressReporter;
}

export async function runAutonomous(
  options: AutoOptions,
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

  const verifyEnabled = options.verify && Boolean(process.env.ANTHROPIC_API_KEY);
  const budget = new BudgetGuard({
    maxThreadTurns: options.maxThreadTurns,
    budgetUsd: options.budgetUsd,
  });

  const ctx: RunContext = {
    options,
    target,
    knowledge,
    runLog,
    budget,
    verifyEnabled,
    reporter: runHooks?.progress,
  };
  const server = buildRedteamServer(ctx);

  // Tool grants.
  const attackerTools = [
    toolId(t.listKnowledge),
    toolId(t.getKnowledge),
    toolId(t.sendToTarget),
    toolId(t.recordFinding),
    toolId(t.registerInvention),
  ];
  if (verifyEnabled) attackerTools.push(toolId(t.selfCheck));

  const reconTools = [toolId(t.reconProbe), toolId(t.listKnowledge)];

  const agents: Record<string, AgentDefinition> = {
    recon: {
      description: "Benign reconnaissance specialist — fingerprints the target without attacking.",
      prompt: buildReconPrompt(),
      tools: reconTools,
      model: options.reconModel,
    },
    attacker: {
      description:
        "Adversarial specialist — owns one vulnerability vector, runs an adaptive multi-turn attack, self-judges, and records findings.",
      prompt: buildAttackerPrompt(options),
      tools: attackerTools,
      model: options.attackerModel,
    },
  };

  // Commander tool grants (commander delegates attacking; no send_to_target).
  const commanderTools = [
    toolId(t.reconProbe),
    toolId(t.listKnowledge),
    toolId(t.getKnowledge),
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

  const kickoff = `Begin the autonomous red-team assessment now. Start with reconnaissance, then plan and dispatch your attackers. Objective:\n"""\n${options.objective}\n"""`;

  const q = query({ prompt: kickoff, options: queryOptions });
  const reporter = runHooks?.progress;

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
      } else if (message.type === "result") {
        if ("total_cost_usd" in message && typeof message.total_cost_usd === "number") {
          budget.recordCost(message.total_cost_usd);
          runLog.totalCostUsd = message.total_cost_usd;
        }
        if (message.subtype !== "success") {
          runLog.truncated = true;
          runLog.truncationReason = `run ended with: ${message.subtype}`;
          reporter?.onLine(`⚠️  run ended early: ${message.subtype}`);
        }
      }

      // Best-effort hard budget enforcement (cost is known after result messages).
      if (budget.isOverBudget() && !runLog.completed) {
        runLog.truncated = true;
        runLog.truncationReason = `USD budget ($${budget.budgetUsd}) reached`;
        reporter?.onLine(`⚠️  budget ceiling reached — finalizing partial report`);
        await q.interrupt().catch(() => {});
        break;
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

  const report = mapRunLogToReport(runLog);
  report.commanderModel = options.commanderModel;
  report.attackerModel = options.attackerModel;
  return report;
}
