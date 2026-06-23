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
import type { AttackResult, EvaluatorResult, UnifiedRunReport, Effort } from "./types.js";

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

    const turnMode: "single" | "multi" = config.turnMode ?? (config.turns > 1 ? "multi" : "single");
    const effectiveTurns = turnMode === "single" ? 1 : config.turns;

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

    // Attach extension-only operator-intent fields to each attack so they
    // reach generateNextAdaptiveTurn via the AttackSpec.
    const attacks = generated.map((a) => ({
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
        if (isStopError(err)) {
          stopReason = getStopReason(err);
          log.error(`\n🛑 Run stopped: ${stopReason}`);
          notify({ type: "run_stopped", reason: stopReason });

          // Add the failed attack to results
          const failedResult: AttackResult = {
            attackId: attack.id,
            evaluatorId: attack.evaluatorId,
            patternName: attack.patternName,
            prompt: attack.prompt ?? "(attack prompt not captured)",
            response: `ERROR: ${stopReason}`,
            judge: {
              verdict: "ERROR",
              score: 0,
              confidence: 0,
              evidence: "N/A",
              reasoning: "",
              errorMessage: stopReason,
            },
          };
          attackResults.push(failedResult);
          notify({ type: "attack_done", attackId: attack.id, result: failedResult });

          // Save partial results for this evaluator
          const total = attackResults.length;
          const passed = attackResults.filter((r) => r.judge.verdict === "PASS").length;
          const failed = attackResults.filter((r) => r.judge.verdict === "FAIL").length;
          const errors = attackResults.filter((r) => r.judge.verdict === "ERROR").length;
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
          break evaluatorLoop;
        }
        // Handle target stop errors
        if (err instanceof TargetStopError) {
          stopReason = err.message;
          log.error(`\n🛑 Run stopped: ${stopReason}`);
          notify({ type: "run_stopped", reason: stopReason });

          // Add the failed attack to results
          const failedResult: AttackResult = {
            attackId: attack.id,
            evaluatorId: attack.evaluatorId,
            patternName: attack.patternName,
            prompt: attack.prompt ?? "(attack prompt not captured)",
            response: `ERROR: ${stopReason}`,
            judge: {
              verdict: "ERROR",
              score: 0,
              confidence: 0,
              evidence: "N/A",
              reasoning: "",
              errorMessage: stopReason,
            },
          };
          attackResults.push(failedResult);
          notify({ type: "attack_done", attackId: attack.id, result: failedResult });

          // Save partial results for this evaluator
          const total = attackResults.length;
          const passed = attackResults.filter((r) => r.judge.verdict === "PASS").length;
          const failed = attackResults.filter((r) => r.judge.verdict === "FAIL").length;
          const errors = attackResults.filter((r) => r.judge.verdict === "ERROR").length;
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
  }

  return buildBrowserReport(config, evaluatorResults, stopReason);
}

function buildBrowserReport(
  config: BrowserRunConfig,
  evaluators: EvaluatorResult[],
  stopReason?: string
): UnifiedRunReport {
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
    targetName: config.targetName ?? "target",
    targetKind: "agent",
    effort: config.effort,
    attackModel,
    judgeModel,
    summary: { total, passed, failed, errors, safetyScore, attackSuccessRate },
    evaluators,
    stopReason,
  };
}
