import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  UnifiedRunReport,
  AttackResult,
  EvaluatorResult,
  TurnRecord,
} from "../execute/types.js";
import { renderReport } from "./render.js";
import type {
  ReportViewModel,
  EvaluatorViewModel,
  ResultViewModel,
  TurnViewModel,
  DetailCard,
  ReportJudge,
} from "./types.js";

export interface ReportFiles {
  html: string;
  json: string;
}

/**
 * Write a unified HTML + JSON report for any run (agent or MCP target).
 * Creates a per-run subfolder under `outputDir` so each run's artifacts stay
 * grouped together. Returns the absolute paths to the written files.
 *
 * Layout:
 *   <outputDir>/run-report-<compactTs>-<slug>-<shortId>/
 *     ├─ <slug>-report.html
 *     └─ <slug>-report.json
 */
export async function writeReport(report: UnifiedRunReport, outputDir = "."): Promise<ReportFiles> {
  const compactTs = new Date(report.generatedAt)
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const slug =
    report.targetName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "target";
  const shortId = report.reportId.replace(/-/g, "").slice(0, 8);
  const runFolder = path.resolve(outputDir, `run-report-${compactTs}-${slug}-${shortId}`);
  await mkdir(runFolder, { recursive: true });

  const htmlPath = path.join(runFolder, `${slug}-report.html`);
  const jsonPath = path.join(runFolder, `${slug}-report.json`);

  const viewModel = toReportViewModel(report);

  await writeFile(htmlPath, renderReport(viewModel), "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}

// ---------------------------------------------------------------------------
// Adapter: UnifiedRunReport → ReportViewModel
// ---------------------------------------------------------------------------

function toReportViewModel(report: UnifiedRunReport): ReportViewModel {
  return {
    mode: report.targetKind === "mcp" ? "mcp" : "agent",
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    generatorModel: report.attackModel,
    judgeModel: report.judgeModel,
    target: { name: report.targetName },
    summary: report.summary,
    evaluators: report.evaluators.map(toEvaluatorViewModel),
  };
}

function toEvaluatorViewModel(ev: EvaluatorResult): EvaluatorViewModel {
  return {
    evaluatorId: ev.evaluatorId,
    evaluatorName: ev.evaluatorName,
    standards: ev.standards,
    severity: ev.severity,
    total: ev.total,
    passed: ev.passed,
    failed: ev.failed,
    errors: ev.errors,
    passRate: ev.passRate,
    results: ev.attacks.map(toResultViewModel),
  };
}

function toResultViewModel(a: AttackResult): ResultViewModel {
  const judge: ReportJudge = {
    verdict: a.judge.verdict,
    score: a.judge.score,
    confidence: a.judge.confidence,
    evidence: a.judge.evidence ?? "",
    reasoning: a.judge.reasoning ?? "",
    failingTurns: a.judge.failingTurns,
    errorMessage: a.judge.errorMessage,
  };

  const detail: DetailCard =
    a.prompt !== undefined
      ? { kind: "prompt", prompt: a.prompt, response: a.response ?? "" }
      : {
          kind: "tool",
          toolName: a.toolName ?? "",
          args: a.toolArguments ?? {},
          response: a.toolResponse ?? "",
          error: a.toolError,
        };

  return {
    id: a.attackId,
    label: a.patternName,
    judge,
    detail,
    turns: a.turns ? a.turns.map(toTurnViewModel) : undefined,
  };
}

function toTurnViewModel(t: TurnRecord): TurnViewModel {
  const detail: DetailCard =
    t.kind === "agent"
      ? { kind: "prompt", prompt: t.prompt, response: t.response }
      : {
          kind: "tool",
          toolName: t.toolName,
          args: t.toolArguments,
          response: t.response,
          error: t.toolError,
        };

  return {
    turnIndex: t.turnIndex,
    detail,
  };
}
