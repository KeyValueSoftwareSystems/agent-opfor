// Browser-safe full run function for use in Chrome extensions and other
// non-Node environments. Takes pre-loaded evaluators and a pre-built
// AgentTarget — no disk reads, no child_process, no Node-only modules.

import { randomUUID } from "../lib/random.js";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import { generateAttacks } from "../generate/generateAttacks.js";
import { createModel } from "../providers/factory.js";
import type { LlmConfig } from "../config/types.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import { TargetStopError } from "../targets/agentTarget.js";
import { runAgentAttack } from "./runAgentLoop.js";
import { log } from "../lib/logger.js";
import { isStopError, getStopReason } from "../lib/llmRetry.js";
import { TurnPlan } from "./turnPlan.js";
import {
  summarizeVerdicts,
  toEvaluatorResult,
  buildUnifiedReport,
  modelLabel,
} from "./aggregate.js";
import type {
  AgentAttackSpec,
  AttackResult,
  EvaluatorResult,
  UnifiedRunReport,
  Effort,
} from "./types.js";

export interface BrowserRunConfig {
  attackerLlm: LlmConfig;
  judgeLlm?: LlmConfig;
  effort: Effort;
  turnMode?: "single" | "multi";
  turns: number;
  targetName?: string;
  /** Operator's primary attack objective from the popup. */
  attackObjective?: string;
  /** Operator's business-use-case context from the popup. */
  businessUseCase?: string;
  /** Sanitized DOM snapshot from the chat-locate phase (verbatim labels). */
  siteSnapshot?: string;
  /** Per-widget char cap detected during locate; bounds attacker output. */
  maxMessageLength?: number;
}

export type BrowserProgressEvent =
  | { type: "evaluator_start"; evaluatorId: string; evaluatorName: string }
  | { type: "attack_start"; attackId: string; patternName: string }
  | { type: "attack_done"; attackId: string; result: AttackResult }
  | { type: "evaluator_done"; evaluatorId: string; passed: number; failed: number; errors: number }
  | { type: "run_stopped"; reason: string };

export interface BrowserRunAllOptions {
  onProgress?: (event: BrowserProgressEvent) => void;
  /** Prior conversation turns to resume from (passed through to the agent loop). */
  initialHistory?: { role: "user" | "assistant"; content: string }[];
}

/**
 * Run red-team evaluations in browser/extension environments.
 * Equivalent to runAll() but takes pre-loaded evaluators and a pre-built
 * AgentTarget instead of resolving them from disk.
 */
export async function runAllBrowser(
  evaluators: EvaluatorSpec[],
  config: BrowserRunConfig,
  agentTarget: AgentTarget,
  options?: BrowserRunAllOptions
): Promise<UnifiedRunReport> {
  const notify = options?.onProgress ?? (() => {});
  const attackModel = createModel(config.attackerLlm);
  const judgeModel = createModel(config.judgeLlm ?? config.attackerLlm);
  const evaluatorResults: EvaluatorResult[] = [];
  let stopReason: string | undefined;

  evaluatorLoop: for (const evaluator of evaluators) {
    notify({ type: "evaluator_start", evaluatorId: evaluator.id, evaluatorName: evaluator.name });
    log.info(`\n▶ ${evaluator.name} (${evaluator.id})`);

    const { turnMode, effectiveTurns } = TurnPlan.from(config);

    let generated;
    try {
      generated = await generateAttacks({
        evaluator,
        target: {
          kind: "agent",
          name: config.targetName ?? "target",
          description: config.targetName ?? "target",
          type: "http-endpoint",
        },
        effort: config.effort,
        model: attackModel,
        turns: effectiveTurns,
        turnMode,
      });
    } catch (err) {
      if (isStopError(err)) {
        stopReason = getStopReason(err);
        log.error(`\n🛑 Run stopped: ${stopReason}`);
        notify({ type: "run_stopped", reason: stopReason });
        break evaluatorLoop;
      }
      throw err;
    }

    // The browser target is always an agent target, so every generated spec is an
    // AgentAttackSpec. Narrow explicitly, then attach the extension-only
    // operator-intent fields so they reach generateNextAdaptiveTurn via the spec.
    const agentSpecs = generated.filter((a): a is AgentAttackSpec => a.kind === "agent");
    if (agentSpecs.length !== generated.length) {
      // Should never happen on the browser path; make a future regression visible
      // rather than silently dropping attacks.
      log.warn(
        `runAllBrowser: dropped ${generated.length - agentSpecs.length} non-agent attack spec(s) for evaluator ${evaluator.id} — the browser path only supports agent targets.`
      );
    }
    const attacks: AgentAttackSpec[] = agentSpecs.map((a) => ({
      ...a,
      attackObjective: config.attackObjective,
      businessUseCase: config.businessUseCase,
      siteSnapshot: config.siteSnapshot,
      maxMessageLength: config.maxMessageLength,
    }));

    log.info(`  ${attacks.length} attack(s) generated [effort: ${config.effort}]`);

    const attackResults: AttackResult[] = [];

    for (const attack of attacks) {
      notify({ type: "attack_start", attackId: attack.id, patternName: attack.patternName });
      log.info(`  → ${attack.patternName}`);

      let result: AttackResult;
      try {
        result = await runAgentAttack(
          attack,
          attackModel,
          judgeModel,
          attack.id,
          evaluator.patterns,
          agentTarget,
          options?.initialHistory ? { initialHistory: options.initialHistory } : undefined
        );
      } catch (err) {
        // Handle LLM stop errors (attacker/judge)
        // Browser path is agent-only, so all attacks here are AgentAttackSpec.
        const makeFailedResult = (reason: string): AttackResult => ({
          kind: "agent",
          attackId: attack.id,
          evaluatorId: attack.evaluatorId,
          patternName: attack.patternName,
          prompt: attack.prompt ?? "(attack prompt not captured)",
          response: `ERROR: ${reason}`,
          judge: {
            verdict: "ERROR",
            score: 0,
            confidence: 0,
            evidence: "N/A",
            reasoning: "",
            errorMessage: reason,
          },
        });

        if (isStopError(err)) {
          stopReason = getStopReason(err);
          log.error(`\n🛑 Run stopped: ${stopReason}`);
          notify({ type: "run_stopped", reason: stopReason });
          const failedResult = makeFailedResult(stopReason);
          attackResults.push(failedResult);
          notify({ type: "attack_done", attackId: attack.id, result: failedResult });
          evaluatorResults.push(
            toEvaluatorResult(
              {
                evaluatorId: evaluator.id,
                evaluatorName: evaluator.name,
                standards: evaluator.standards,
                severity: evaluator.severity,
              },
              attackResults
            )
          );
          break evaluatorLoop;
        }
        // Handle target stop errors
        if (err instanceof TargetStopError) {
          stopReason = err.message;
          log.error(`\n🛑 Run stopped: ${stopReason}`);
          notify({ type: "run_stopped", reason: stopReason });
          const failedResult = makeFailedResult(stopReason);
          attackResults.push(failedResult);
          notify({ type: "attack_done", attackId: attack.id, result: failedResult });
          evaluatorResults.push(
            toEvaluatorResult(
              {
                evaluatorId: evaluator.id,
                evaluatorName: evaluator.name,
                standards: evaluator.standards,
                severity: evaluator.severity,
              },
              attackResults
            )
          );
          break evaluatorLoop;
        }
        throw err;
      }

      attackResults.push(result);
      notify({ type: "attack_done", attackId: attack.id, result });

      const icon =
        result.judge.verdict === "PASS" ? "✓" : result.judge.verdict === "FAIL" ? "✗" : "⚠";
      log.info(`     ${icon} ${result.judge.verdict} (score ${result.judge.score}/10)`);
    }

    const { passed, failed, errors } = summarizeVerdicts(attackResults);
    notify({ type: "evaluator_done", evaluatorId: evaluator.id, passed, failed, errors });

    evaluatorResults.push(
      toEvaluatorResult(
        {
          evaluatorId: evaluator.id,
          evaluatorName: evaluator.name,
          standards: evaluator.standards,
          severity: evaluator.severity,
        },
        attackResults
      )
    );
  }

  return buildBrowserReport(config, evaluatorResults, stopReason);
}

function buildBrowserReport(
  config: BrowserRunConfig,
  evaluators: EvaluatorResult[],
  stopReason?: string
): UnifiedRunReport {
  const { attackModel, judgeModel } = modelLabel(config.attackerLlm, config.judgeLlm);
  return {
    ...buildUnifiedReport(
      {
        reportId: randomUUID(),
        generatedAt: new Date().toISOString(),
        targetName: config.targetName ?? "target",
        targetKind: "agent",
        effort: config.effort,
        attackModel,
        judgeModel,
      },
      evaluators
    ),
    stopReason,
  };
}
