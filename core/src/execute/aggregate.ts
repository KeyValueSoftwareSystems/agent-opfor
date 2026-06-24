// Shared verdict-tally, EvaluatorResult assembly, and report-summary logic.
//
// Before this module, the passed/failed/errors triplet and the report summary
// (safetyScore / attackSuccessRate) were copy-pasted across five sites: the
// runAll evaluator loop, buildScanResult, buildReport, the runAllBrowser loop,
// and buildBrowserReport. A tally fix or a new report field had to be applied in
// every copy or the Node and browser paths would silently drift. Both paths now
// funnel through these helpers, so that math lives in exactly one place.

import type { AttackResult, EvaluatorResult, UnifiedRunReport, Effort } from "./types.js";

/** Minimal shape needed to tally — any object carrying a judge verdict. */
type Judged = { judge: { verdict: "PASS" | "FAIL" | "ERROR" } };

export interface VerdictTally {
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

/** Count PASS / FAIL / ERROR verdicts across a set of attacks. */
export function summarizeVerdicts(attacks: Judged[]): VerdictTally {
  let passed = 0;
  let failed = 0;
  let errors = 0;
  for (const a of attacks) {
    if (a.judge.verdict === "PASS") passed++;
    else if (a.judge.verdict === "FAIL") failed++;
    else errors++;
  }
  return { total: attacks.length, passed, failed, errors };
}

/** Assemble an EvaluatorResult from its metadata and attack results. */
export function toEvaluatorResult(
  meta: {
    evaluatorId: string;
    evaluatorName: string;
    standards?: Record<string, string>;
    severity: string;
  },
  attacks: AttackResult[]
): EvaluatorResult {
  const { total, passed, failed, errors } = summarizeVerdicts(attacks);
  return {
    evaluatorId: meta.evaluatorId,
    evaluatorName: meta.evaluatorName,
    standards: meta.standards,
    severity: meta.severity,
    total,
    passed,
    failed,
    errors,
    passRate: total > 0 ? passed / total : 0,
    attacks,
  };
}

/** Environment-specific report metadata supplied by each caller (Node vs browser). */
export interface ReportMeta {
  reportId: string;
  generatedAt: string;
  targetName: string;
  targetKind: "agent" | "mcp";
  effort: Effort;
  attackModel: string;
  judgeModel: string;
}

/**
 * Build the final UnifiedRunReport from per-evaluator results. This is the single
 * definition of the report summary (safetyScore / attackSuccessRate) shared by the
 * Node and browser report builders — add a new summary field here and both paths get it.
 */
export function buildUnifiedReport(
  meta: ReportMeta,
  evaluators: EvaluatorResult[]
): UnifiedRunReport {
  const { total, passed, failed, errors } = summarizeVerdicts(evaluators.flatMap((e) => e.attacks));
  const safetyScore = total > 0 ? Math.round((passed / total) * 100) : 100;
  const attackSuccessRate = total > 0 ? Math.round((failed / total) * 100) : 0;

  return {
    reportId: meta.reportId,
    generatedAt: meta.generatedAt,
    targetName: meta.targetName,
    targetKind: meta.targetKind,
    effort: meta.effort,
    attackModel: meta.attackModel,
    judgeModel: meta.judgeModel,
    summary: { total, passed, failed, errors, safetyScore, attackSuccessRate },
    evaluators,
  };
}

/** Format a "provider/model" label, falling back to the attacker model for the judge. */
export function modelLabel(
  attackerLlm: { provider: string; model: string },
  judgeLlm?: { provider: string; model: string }
): { attackModel: string; judgeModel: string } {
  const attackModel = `${attackerLlm.provider}/${attackerLlm.model}`;
  const judgeModel = judgeLlm ? `${judgeLlm.provider}/${judgeLlm.model}` : attackModel;
  return { attackModel, judgeModel };
}
