import { runAll } from "@keyvaluesystems/agent-opfor-core";
import type {
  RunConfig,
  UnifiedRunReport,
} from "@keyvaluesystems/agent-opfor-core/execute/types.js";
import type { RunListener as CoreRunListener } from "@keyvaluesystems/agent-opfor-core/execute/runListener.js";
import type {
  RunOptions,
  RunResults,
  RunListener,
  Finding,
  AttackResult,
  EvaluatorResult,
} from "./types.js";
import { buildRunConfig as buildRunConfigInternal } from "./internal/buildRunConfig.js";
import { withEnvLock } from "./internal/envLock.js";
import { attachCoreReport } from "./internal/coreReportStore.js";

/**
 * Run adversarial tests against a target.
 *
 * This is the functional API - pass all configuration in options.
 */
export async function run(options: RunOptions): Promise<RunResults> {
  const { runConfig, env } = buildRunConfigInternal(options);

  return await withEnvLock(async () => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      prev[k] = process.env[k];
      process.env[k] = v;
    }

    try {
      const coreReport = await runAll(runConfig, {
        onProgress: options.onProgress,
        listeners: options.listeners?.map(wrapListener),
      });

      const results = transformReport(coreReport);
      attachCoreReport(results, coreReport);
      return results;
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
}

/**
 * Build a core RunConfig from SDK RunOptions.
 *
 * Note: this returns only the config object. The SDK `run()` function also
 * injects provider API keys into process.env *temporarily* for the duration of
 * the call.
 */
export function buildRunConfig(options: RunOptions): RunConfig {
  return buildRunConfigInternal(options).runConfig;
}

/** Adapt SDK RunListener hooks to core's observer (UnifiedRunReport → RunResults). */
function wrapListener(listener: RunListener): CoreRunListener {
  return {
    onRunStart: listener.onRunStart,
    onEvaluatorStart: listener.onEvaluatorStart,
    onAttackStart: listener.onAttackStart,
    onAttackDone: listener.onAttackDone,
    onEvaluatorDone: listener.onEvaluatorDone,
    onRunStopped: listener.onRunStopped,
    onRunError: listener.onRunError,
    onRunFinish: listener.onRunFinish
      ? (report: UnifiedRunReport) => listener.onRunFinish!(transformReport(report))
      : undefined,
  };
}

function transformReport(coreReport: UnifiedRunReport): RunResults {
  const findings = extractFindings(coreReport);
  const evaluators = coreReport.evaluators.map(transformEvaluatorResult);

  return {
    id: coreReport.reportId,
    timestamp: coreReport.generatedAt,
    targetName: coreReport.targetName,
    targetKind: coreReport.targetKind,
    effort: coreReport.effort,
    attackerModel: coreReport.attackModel,
    judgeModel: coreReport.judgeModel,
    score: coreReport.summary.safetyScore,
    summary: coreReport.summary,
    findings,
    evaluators,
  };
}

function extractFindings(report: UnifiedRunReport): Finding[] {
  const findings: Finding[] = [];

  for (const evaluator of report.evaluators) {
    for (const attack of evaluator.attacks) {
      if (attack.judge.verdict === "FAIL") {
        findings.push({
          id: attack.attackId,
          evaluatorId: evaluator.evaluatorId,
          patternName: attack.patternName,
          severity: evaluator.severity as Finding["severity"],
          title: `${evaluator.evaluatorName}: ${attack.patternName}`,
          description: attack.judge.reasoning ?? "",
          evidence: attack.judge.evidence,
          standards: evaluator.standards,
        });
      }
    }
  }

  return findings;
}

function transformEvaluatorResult(
  core: import("@keyvaluesystems/agent-opfor-core").EvaluatorResult
): EvaluatorResult {
  return {
    evaluatorId: core.evaluatorId,
    evaluatorName: core.evaluatorName,
    severity: core.severity,
    standards: core.standards,
    total: core.total,
    passed: core.passed,
    failed: core.failed,
    errors: core.errors,
    passRate: core.passRate,
    attacks: core.attacks.map(transformAttackResult),
  };
}

function transformAttackResult(
  core: import("@keyvaluesystems/agent-opfor-core").AttackResult
): AttackResult {
  const prompt = core.kind === "agent" ? (core.prompt ?? "") : (core.toolName ?? "");
  const response = core.kind === "agent" ? (core.response ?? "") : (core.toolResponse ?? "");
  return {
    attackId: core.attackId,
    evaluatorId: core.evaluatorId,
    patternName: core.patternName,
    prompt,
    response,
    verdict: core.judge.verdict,
    evidence: core.judge.evidence,
    turns: core.turns?.map((t) => {
      if (t.kind === "agent") {
        return {
          turnIndex: t.turnIndex,
          prompt: t.prompt,
          response: t.response,
        };
      }
      return {
        turnIndex: t.turnIndex,
        prompt: `[tool:${t.toolName}] ${JSON.stringify(t.toolArguments)}`,
        response: t.response,
      };
    }),
  };
}
