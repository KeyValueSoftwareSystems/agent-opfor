import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import type { JudgeResult } from "../evaluators/judge.js";
import type {
  ReportViewModel,
  EvaluatorViewModel,
  ResultViewModel,
  TurnViewModel,
} from "./types.js";
import { renderReport } from "./render.js";

/** A single turn in a multi-turn attack sequence. */
export interface TurnRecord {
  turnIndex: number;
  prompt: string;
  response: string;
  judge?: JudgeResult;
}

export interface TestResult {
  testNumber: number;
  pattern: string;
  prompt: string;
  response: string;
  judge: JudgeResult;
  /** Propagated OTEL/Langfuse trace id (32 hex) when telemetry propagation was used for this attack. */
  traceId?: string;
  /** Present for multi-turn attacks — full turn-by-turn breakdown. */
  turns?: TurnRecord[];
}

export interface EvaluatorReport {
  evaluator: EvaluatorSpec;
  results: TestResult[];
}

export interface ReportPaths {
  html: string;
  json: string;
}

// ── Adapter: convert agent domain models into ReportViewModel ────

export function agentToReportView(
  reports: EvaluatorReport[],
  targetName: string,
  targetEndpoint: string,
  judgeLabel: string,
  generatorLabel: string,
  reportId: string,
  generatedAt: string
): ReportViewModel {
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let errors = 0;

  for (const r of reports) {
    for (const t of r.results) {
      totalTests++;
      if (t.judge.verdict === "PASS") passed++;
      else if (t.judge.verdict === "ERROR") errors++;
      else failed++;
    }
  }

  const scoreDenominator = passed + failed;
  const safetyScore = scoreDenominator > 0 ? Math.round((passed / scoreDenominator) * 100) : 0;
  const attackSuccessRate =
    scoreDenominator > 0 ? Math.round((failed / scoreDenominator) * 100) : 0;

  const evaluators: EvaluatorViewModel[] = reports.map((r) => {
    const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
    const e = r.results.filter((t) => t.judge.verdict === "ERROR").length;
    const f = r.results.length - p - e;
    const passDenom = p + f;

    const results: ResultViewModel[] = r.results.map((t) => {
      const turns: TurnViewModel[] | undefined =
        t.turns && t.turns.length > 0
          ? t.turns.map((turn) => ({
              turnIndex: turn.turnIndex,
              detail: { kind: "prompt" as const, prompt: turn.prompt, response: turn.response },
              judge: turn.judge
                ? {
                    verdict: turn.judge.verdict,
                    score: turn.judge.score,
                    confidence: turn.judge.confidence,
                    evidence: turn.judge.evidence,
                    reasoning: turn.judge.reasoning,
                    errorMessage: turn.judge.errorMessage,
                  }
                : undefined,
            }))
          : undefined;

      return {
        id: String(t.testNumber),
        label: t.pattern,
        judge: {
          verdict: t.judge.verdict,
          score: t.judge.score,
          confidence: t.judge.confidence,
          evidence: t.judge.evidence,
          reasoning: t.judge.reasoning,
          errorMessage: t.judge.errorMessage,
        },
        traceId: t.traceId,
        detail: { kind: "prompt" as const, prompt: t.prompt, response: t.response },
        turns,
      };
    });

    return {
      evaluatorId: r.evaluator.id,
      evaluatorName: r.evaluator.name,
      ref: r.evaluator.ref,
      severity: r.evaluator.severity,
      total: r.results.length,
      passed: p,
      failed: f,
      errors: e,
      passRate: passDenom > 0 ? Math.round((p / passDenom) * 100) : 0,
      results,
    };
  });

  return {
    mode: "agent",
    reportId,
    generatedAt,
    generatorModel: generatorLabel,
    judgeModel: judgeLabel,
    target: {
      name: targetName,
      endpoint: targetEndpoint,
    },
    summary: {
      total: totalTests,
      passed,
      failed,
      errors,
      safetyScore,
      attackSuccessRate,
    },
    evaluators,
  };
}

// ── Main entry point (unchanged signature) ───────────────────────

export async function generateReport(
  reports: EvaluatorReport[],
  targetName: string,
  targetEndpoint: string,
  outputDir: string,
  judgeLabel = "unknown",
  generatorLabel = judgeLabel
): Promise<ReportPaths> {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:.T]/g, "")
    .slice(0, 15);
  const reportId = `opfor-agent-${randomUUID().slice(0, 8)}`;

  // Build the view model
  const model = agentToReportView(
    reports,
    targetName,
    targetEndpoint,
    judgeLabel,
    generatorLabel,
    reportId,
    now.toISOString()
  );

  // Render HTML via shared renderer
  const html = renderReport(model);

  // --- JSON report (preserves legacy shape for consumers) ---
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let errors = 0;
  for (const r of reports) {
    for (const t of r.results) {
      totalTests++;
      if (t.judge.verdict === "PASS") passed++;
      else if (t.judge.verdict === "ERROR") errors++;
      else failed++;
    }
  }
  const scoreDenominator = passed + failed;
  const safetyScore = scoreDenominator > 0 ? Math.round((passed / scoreDenominator) * 100) : 0;
  const attackSuccessRate =
    scoreDenominator > 0 ? Math.round((failed / scoreDenominator) * 100) : 0;

  type Finding = {
    rank: number;
    evaluator: string;
    testNumber: number;
    score: number;
    description: string;
  };
  const criticalFindings: Finding[] = [];
  const highFindings: Finding[] = [];
  for (const r of reports) {
    for (const t of r.results) {
      if (t.judge.verdict !== "FAIL") continue;
      const f: Finding = {
        rank: 0,
        evaluator: r.evaluator.name,
        testNumber: t.testNumber,
        score: t.judge.score,
        description: t.judge.reasoning,
      };
      if (r.evaluator.severity === "critical") criticalFindings.push(f);
      else if (r.evaluator.severity === "high") highFindings.push(f);
    }
  }
  criticalFindings.sort((a, b) => b.score - a.score);
  highFindings.sort((a, b) => b.score - a.score);
  criticalFindings.forEach((f, i) => {
    f.rank = i + 1;
  });
  highFindings.forEach((f, i) => {
    f.rank = i + 1;
  });

  const jsonData = {
    metadata: {
      reportId,
      framework: "opfor v0.2",
      generated: now.toISOString(),
      llmJudge: judgeLabel,
    },
    target: {
      name: targetName,
      type: "chatbot",
      targetType: "http-endpoint",
      endpoint: targetEndpoint,
      assessmentDate: now.toISOString(),
    },
    summary: {
      totalEvaluators: reports.length,
      totalTests,
      passed,
      failed,
      errors,
      safetyScore,
      attackSuccessRate,
      criticalFindings: criticalFindings.length,
      highFindings: highFindings.length,
    },
    evaluatorResults: reports.map((r) => {
      const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
      const e = r.results.filter((t) => t.judge.verdict === "ERROR").length;
      const f = r.results.length - p - e;
      const scoreable = r.results.filter((t) => t.judge.verdict !== "ERROR");
      const avgScore =
        scoreable.length > 0
          ? Math.round((scoreable.reduce((s, t) => s + t.judge.score, 0) / scoreable.length) * 10) /
            10
          : 0;
      const passDenom = p + f;
      return {
        id: r.evaluator.id,
        name: r.evaluator.name,
        severity: r.evaluator.severity,
        totalTests: r.results.length,
        passed: p,
        failed: f,
        errors: e,
        passRate: passDenom > 0 ? Math.round((p / passDenom) * 100) : 0,
        failRate: passDenom > 0 ? Math.round((f / passDenom) * 100) : 0,
        avgScore,
        testResults: r.results.map((t) => ({
          testNumber: t.testNumber,
          pattern: t.pattern,
          verdict: t.judge.verdict,
          score: t.judge.score,
          confidence: t.judge.confidence,
          evidence: t.judge.evidence,
          reasoning: t.judge.reasoning,
          ...(t.judge.errorMessage ? { errorMessage: t.judge.errorMessage } : {}),
          ...(t.traceId ? { traceId: t.traceId } : {}),
          ...(t.turns
            ? {
                turns: t.turns.map((turn) => ({
                  turnIndex: turn.turnIndex,
                  verdict: turn.judge?.verdict,
                  score: turn.judge?.score,
                  reasoning: turn.judge?.reasoning,
                  ...(turn.judge?.errorMessage ? { errorMessage: turn.judge.errorMessage } : {}),
                })),
              }
            : {}),
        })),
      };
    }),
    criticalFindings,
    highFindings,
  };

  // --- write files ---
  const folderTs = timestamp.slice(0, 8) + "-" + timestamp.slice(8, 14);
  const reportDir = path.join(outputDir, `report-${folderTs}`);
  await mkdir(reportDir, { recursive: true });

  const htmlPath = path.join(reportDir, `${reportId}.html`);
  const jsonPath = path.join(reportDir, `${reportId}.json`);

  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}
