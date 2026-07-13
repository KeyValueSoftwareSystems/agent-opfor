// The execute phase: run each (topo-sorted) evaluator's attacks against the
// target, judge them, capture session context for dependents, and stop early on
// a non-retryable error. Extracted from runAll.ts so the orchestrator stays thin
// and the loop no longer needs a labeled break.

import type { LanguageModel } from "ai";
import { generateAttacks, type ToolInfo } from "../generate/generateAttacks.js";
import { createAgentTarget, TargetStopError } from "../targets/agentTarget.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import type { McpTarget } from "../targets/mcpTarget.js";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import { runAgentAttack } from "./runAgentLoop.js";
import { runMcpAttack } from "./mcpAttackDriver.js";
import { summarizeVerdicts, toEvaluatorResult } from "./aggregate.js";
import { errorJudge } from "../lib/judgeTypes.js";
import { verdictIcon } from "../lib/verdictIcon.js";
import { TurnPlan } from "./turnPlan.js";
import { isStopError, getStopReason } from "../lib/llmRetry.js";
import { log } from "../lib/logger.js";
import type {
  RunConfig,
  AttackSpec,
  AttackResult,
  EvaluatorResult,
  SessionContext,
  AgentTargetConfig,
} from "./types.js";
import type { LlmConfig } from "../config/types.js";
import type { ProgressEvent } from "./runAll.js";

export interface EvaluatorLoopContext {
  /** Evaluators already topologically sorted by their `dependsOn` edges. */
  ordered: EvaluatorSpec[];
  config: RunConfig;
  attackModel: LanguageModel;
  judgeModel: LanguageModel;
  judgeLlmConfig: LlmConfig;
  mcpTarget: McpTarget | null;
  tools: ToolInfo[];
  traceContext: string | undefined;
  /** Pre-built agent target; when omitted a fresh one is created per attack. */
  agentTarget?: AgentTarget;
  notify: (event: ProgressEvent) => void;
}

/**
 * Run the evaluator attack loop. Returns the per-evaluator results plus the stop
 * reason if a non-retryable error halted the run partway (a partial report).
 */
export async function runEvaluatorAttacks(
  ctx: EvaluatorLoopContext
): Promise<{ evaluatorResults: EvaluatorResult[]; stopReason?: string }> {
  const {
    ordered,
    config,
    attackModel,
    judgeModel,
    judgeLlmConfig,
    mcpTarget,
    tools,
    traceContext,
    notify,
  } = ctx;
  const sessionMap = new Map<string, SessionContext>();
  const evaluatorResults: EvaluatorResult[] = [];

  for (const evaluator of ordered) {
    notify({ type: "evaluator_start", evaluatorId: evaluator.id, evaluatorName: evaluator.name });

    const deps = evaluator.dependsOn ?? [];
    const missing = deps.filter((d) => !sessionMap.has(d));
    if (missing.length > 0) {
      log.warn(
        `\n⚠ ${evaluator.name}: skipping — missing dependency sessions: ${missing.join(", ")}`
      );
      continue;
    }

    const upstreamSessions =
      deps.length > 0 ? deps.map((d) => sessionMap.get(d)!).filter(Boolean) : undefined;

    if (upstreamSessions?.length) {
      const depNames = upstreamSessions.map((s) => s.evaluatorName).join(", ");
      log.info(`\n▶ ${evaluator.name} (${evaluator.id}) [depends on: ${depNames}]`);
    } else {
      log.info(`\n▶ ${evaluator.name} (${evaluator.id})`);
    }

    const { turnMode, effectiveTurns } = TurnPlan.from(config);

    let attacks: AttackSpec[];
    try {
      attacks = await generateAttacks({
        evaluator,
        target: config.target,
        effort: config.effort,
        model: attackModel,
        turns: effectiveTurns,
        turnMode,
        options: { tools, traceContext, upstreamSessions },
      });
    } catch (err) {
      if (isStopError(err)) {
        const stopReason = getStopReason(err);
        log.error(`\n🛑 Run stopped: ${stopReason}`);
        notify({ type: "run_stopped", reason: stopReason });
        return { evaluatorResults, stopReason };
      }
      throw err;
    }

    if (config.attackObjective) {
      for (const attack of attacks) {
        if (attack.kind === "agent") attack.attackObjective = config.attackObjective;
      }
    }

    log.info(`  ${attacks.length} attack(s) generated [effort: ${config.effort}]`);

    const attackResults: AttackResult[] = [];
    const evaluatorMeta = {
      evaluatorId: evaluator.id,
      evaluatorName: evaluator.name,
      standards: evaluator.standards,
      severity: evaluator.severity,
    };

    for (const attack of attacks) {
      if (upstreamSessions?.length) {
        attack.upstreamSessions = upstreamSessions;
      }

      notify({ type: "attack_start", attackId: attack.id, patternName: attack.patternName });
      log.info(`  → ${attack.patternName}`);

      // Branch on the attack discriminant (not isMcp) so the compiler narrows
      // `attack` to the matching arm for each runner.
      let result: AttackResult;
      try {
        result =
          attack.kind === "mcp"
            ? await runMcpAttack(attack, mcpTarget!, attackModel, judgeLlmConfig)
            : await runAgentAttack(
                attack,
                attackModel,
                judgeModel,
                attack.id,
                evaluator.patterns,
                ctx.agentTarget ?? createAgentTarget(config.target as AgentTargetConfig),
                { targetConfig: config.target, telemetry: config.telemetry }
              );
      } catch (err) {
        const makeFailedResult = (reason: string): AttackResult =>
          attack.kind === "agent"
            ? {
                kind: "agent",
                attackId: attack.id,
                evaluatorId: attack.evaluatorId,
                patternName: attack.patternName,
                prompt: attack.prompt ?? "(attack prompt not captured)",
                response: `ERROR: ${reason}`,
                judge: errorJudge(reason),
              }
            : {
                kind: "mcp",
                attackId: attack.id,
                evaluatorId: attack.evaluatorId,
                patternName: attack.patternName,
                judge: errorJudge(reason),
              };

        // Non-retryable LLM (attacker/judge) or target errors halt the whole run
        // with a partial report; anything else propagates.
        const stopReason = isStopError(err)
          ? getStopReason(err)
          : err instanceof TargetStopError
            ? err.message
            : undefined;
        if (stopReason === undefined) throw err;

        log.error(`\n🛑 Run stopped: ${stopReason}`);
        notify({ type: "run_stopped", reason: stopReason });
        attackResults.push(makeFailedResult(stopReason));
        notify({ type: "attack_done", attackId: attack.id, verdict: "ERROR" });
        evaluatorResults.push(toEvaluatorResult(evaluatorMeta, attackResults));
        return { evaluatorResults, stopReason };
      }

      attackResults.push(result);
      notify({ type: "attack_done", attackId: attack.id, verdict: result.judge.verdict });

      log.info(
        `     ${verdictIcon(result.judge.verdict)} ${result.judge.verdict} (score ${result.judge.score}/10)`
      );
    }

    const { passed, failed, errors } = summarizeVerdicts(attackResults);
    notify({ type: "evaluator_done", evaluatorId: evaluator.id, passed, failed, errors });

    evaluatorResults.push(toEvaluatorResult(evaluatorMeta, attackResults));
    sessionMap.set(evaluator.id, captureSessionContext(evaluator, attackResults));
  }

  return { evaluatorResults };
}

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
          history.push({
            role: "user",
            content: `[tool:${t.toolName}] ${JSON.stringify(t.toolArguments)}`,
          });
          history.push({ role: "assistant", content: t.response });
        }
      }
    } else if (r.kind === "agent" && r.prompt && r.response) {
      history.push({ role: "user", content: r.prompt });
      history.push({ role: "assistant", content: r.response });
    } else if (r.kind === "mcp" && r.toolName && r.toolResponse) {
      history.push({
        role: "user",
        content: `[tool:${r.toolName}] ${JSON.stringify(r.toolArguments)}`,
      });
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
