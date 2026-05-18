import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AttackRunResult, EvaluatorRunSummary, RunReport } from "../run/types.js";
import type { AttackPlanWritten } from "../attacks/planSchema.js";
import type { ModelConfig } from "../config/schema.js";
import type {
  ReportViewModel,
  EvaluatorViewModel,
  ResultViewModel,
  TurnViewModel,
} from "./types.js";
import { renderReport } from "./render.js";

// ── Aggregation ──────────────────────────────────────────────────

function modelLabel(model: ModelConfig): string {
  return `${model.provider}/${model.model}`;
}

export function buildReport(args: {
  plan: AttackPlanWritten;
  results: AttackRunResult[];
  generatorModel: ModelConfig;
  judgeModel: ModelConfig;
}): RunReport {
  const { plan, results, generatorModel, judgeModel } = args;

  const byEvaluator = new Map<string, AttackRunResult[]>();
  for (const r of results) {
    const existing = byEvaluator.get(r.evaluatorId) ?? [];
    existing.push(r);
    byEvaluator.set(r.evaluatorId, existing);
  }

  // Pull evaluator IDs from both the plan's attacks and the actual results
  // (results may include evaluators not in the plan, e.g. resource-exposure from resource scanning)
  const evaluatorIds = [
    ...new Set([...plan.attacks.map((a) => a.evaluatorId), ...results.map((r) => r.evaluatorId)]),
  ];

  const evaluators: EvaluatorRunSummary[] = evaluatorIds.map((id) => {
    const evalResults = byEvaluator.get(id) ?? [];
    const passed = evalResults.filter((r) => r.judge.verdict === "PASS").length;
    const errors = evalResults.filter((r) => r.judge.verdict === "ERROR").length;
    const failed = evalResults.length - passed - errors;
    const passDenom = passed + failed;
    return {
      evaluatorId: id,
      evaluatorName: id,
      ref: "",
      severity: "",
      total: evalResults.length,
      passed,
      failed,
      errors,
      passRate: passDenom > 0 ? Math.round((passed / passDenom) * 100) : 0,
      results: evalResults,
    };
  });

  const total = results.length;
  const passed = results.filter((r) => r.judge.verdict === "PASS").length;
  const errors = results.filter((r) => r.judge.verdict === "ERROR").length;
  const failed = total - passed - errors;
  const scoreDenominator = passed + failed;

  return {
    reportId: `opfor-mcp-${randomUUID().slice(0, 8)}`,
    generatedAt: new Date().toISOString(),
    suiteId: plan.suiteId,
    serverSummary: plan.serverSummary,
    transport: plan.transport,
    generatorModel: modelLabel(generatorModel),
    judgeModel: modelLabel(judgeModel),
    summary: {
      total,
      passed,
      failed,
      errors,
      safetyScore: scoreDenominator > 0 ? Math.round((passed / scoreDenominator) * 100) : 0,
      attackSuccessRate: scoreDenominator > 0 ? Math.round((failed / scoreDenominator) * 100) : 0,
    },
    evaluators,
  };
}

/** Merge evaluator metadata (name, ref, severity) into an already-built report. */
export function enrichReportWithCriteria(
  report: RunReport,
  criteriaMap: Map<string, { name: string; ref: string; severity: string }>
): RunReport {
  return {
    ...report,
    evaluators: report.evaluators.map((e) => {
      const meta = criteriaMap.get(e.evaluatorId);
      return meta ? { ...e, evaluatorName: meta.name, ref: meta.ref, severity: meta.severity } : e;
    }),
  };
}

// ── Adapter: convert MCP RunReport into the shared ReportViewModel ──

export function mcpToReportView(report: RunReport): ReportViewModel {
  const evaluators: EvaluatorViewModel[] = report.evaluators.map((e) => {
    const results: ResultViewModel[] = e.results.map((r) => {
      const turns: TurnViewModel[] | undefined =
        r.turns && r.turns.length > 0
          ? r.turns.map((turn) => ({
              turnIndex: turn.turnIndex,
              detail: {
                kind: "tool" as const,
                toolName: turn.toolName,
                args: turn.toolArguments,
                response: turn.rawToolResponse,
                error: turn.toolError,
              },
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
        id: r.attackId,
        label: r.toolName,
        judge: {
          verdict: r.judge.verdict,
          score: r.judge.score,
          confidence: r.judge.confidence,
          evidence: r.judge.evidence,
          reasoning: r.judge.reasoning,
          errorMessage: r.judge.errorMessage,
        },
        detail: {
          kind: "tool" as const,
          toolName: r.toolName,
          args: r.toolArguments,
          response: r.rawToolResponse,
          error: r.toolError,
        },
        turns,
      };
    });

    return {
      evaluatorId: e.evaluatorId,
      evaluatorName: e.evaluatorName || e.evaluatorId,
      ref: e.ref,
      severity: e.severity,
      total: e.total,
      passed: e.passed,
      failed: e.failed,
      errors: e.errors,
      passRate: e.passRate,
      results,
    };
  });

  return {
    mode: "mcp",
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    generatorModel: report.generatorModel,
    judgeModel: report.judgeModel,
    target: {
      name: report.serverSummary,
      transport: report.transport,
      suiteId: report.suiteId,
    },
    summary: { ...report.summary },
    evaluators,
  };
}

// ── HTML + JSON file writer ──────────────────────────────────────

function runTimestamp(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${date.getFullYear()}` +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    `-` +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

export async function writeHtmlReport(
  report: RunReport,
  outputDir: string
): Promise<{ html: string; json: string }> {
  const now = new Date(report.generatedAt);
  const runDir = path.join(outputDir, `report-${runTimestamp(now)}`);

  const model = mcpToReportView(report);
  const html = renderReport(model);

  const { summary, evaluators } = report;
  const errors = summary.errors ?? 0;

  type Finding = {
    rank: number;
    evaluator: string;
    attackId: string;
    score: number;
    description: string;
  };
  const criticalFindings: Finding[] = [];
  const highFindings: Finding[] = [];
  for (const e of evaluators) {
    for (const r of e.results) {
      if (r.judge.verdict !== "FAIL") continue;
      const f: Finding = {
        rank: 0,
        evaluator: e.evaluatorName || e.evaluatorId,
        attackId: r.attackId,
        score: r.judge.score,
        description: r.judge.reasoning,
      };
      if (e.severity === "critical") criticalFindings.push(f);
      else if (e.severity === "high") highFindings.push(f);
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

  const jsonReport = {
    ...report,
    summary: { ...report.summary, errors },
    evaluators: evaluators.map((e) => ({
      ...e,
      errors: e.errors ?? 0,
      results: e.results.map((r) => ({
        ...r,
        judge: {
          ...r.judge,
          ...(r.judge.errorMessage ? { errorMessage: r.judge.errorMessage } : {}),
        },
      })),
    })),
    criticalFindings,
    highFindings,
  };

  await mkdir(runDir, { recursive: true });
  const htmlPath = path.join(runDir, `${report.reportId}.html`);
  const jsonPath = path.join(runDir, `${report.reportId}.json`);
  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}
