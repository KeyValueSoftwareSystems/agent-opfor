import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "@keyvaluesystems/agent-opfor-core/report/render.js";
import type {
  ReportViewModel,
  EvaluatorViewModel,
  ResultViewModel,
} from "@keyvaluesystems/agent-opfor-core/report/types.js";
import type { RunResults, AttackResult, EvaluatorResult } from "./types.js";

export interface ReportBuilder {
  /**
   * Write results as JSON to the specified path.
   */
  json(outputPath: string | URL): Promise<string>;

  /**
   * Write results as HTML to the specified path.
   */
  html(outputPath: string | URL): Promise<string>;
}

/**
 * Create a report builder from execution results.
 *
 * @example
 * ```typescript
 * const results = await run({ ... });
 * await report(results).json("./report.json");
 * await report(results).html("./report.html");
 * ```
 */
export function report(results: RunResults): ReportBuilder {
  return {
    async json(outputPath: string | URL): Promise<string> {
      const resolvedPath = path.resolve(toFsPath(outputPath));
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, JSON.stringify(results, null, 2), "utf8");
      return resolvedPath;
    },

    async html(outputPath: string | URL): Promise<string> {
      const resolvedPath = path.resolve(toFsPath(outputPath));
      await mkdir(path.dirname(resolvedPath), { recursive: true });

      const html = renderReport(toReportViewModel(results));
      await writeFile(resolvedPath, html, "utf8");
      return resolvedPath;
    },
  };
}

function toFsPath(p: string | URL): string {
  return p instanceof URL ? fileURLToPath(p) : p;
}

// ---------------------------------------------------------------------------
// Adapter: SDK RunResults → core's shared ReportViewModel
//
// Renders through the same `renderReport` the CLI/MCP runners and the
// browser extension use, so the SDK's HTML report looks identical to theirs
// instead of maintaining its own template.
// ---------------------------------------------------------------------------

function toReportViewModel(results: RunResults): ReportViewModel {
  return {
    mode: results.targetKind,
    reportId: results.id,
    generatedAt: results.timestamp,
    generatorModel: results.attackerModel,
    judgeModel: results.judgeModel,
    target: { name: results.targetName, suiteId: results.suiteId },
    summary: results.summary,
    evaluators: results.evaluators.map(toEvaluatorViewModel),
  };
}

function toEvaluatorViewModel(e: EvaluatorResult): EvaluatorViewModel {
  return {
    evaluatorId: e.evaluatorId,
    evaluatorName: e.evaluatorName,
    standards: e.standards,
    severity: e.severity,
    total: e.total,
    passed: e.passed,
    failed: e.failed,
    errors: e.errors,
    passRate: e.passRate,
    results: e.attacks.map(toResultViewModel),
  };
}

function toResultViewModel(a: AttackResult): ResultViewModel {
  return {
    id: a.attackId,
    label: a.patternName,
    judge: {
      verdict: a.verdict,
      score: a.score ?? 0,
      confidence: a.confidence ?? 0,
      evidence: a.evidence ?? "",
      reasoning: a.reasoning ?? "",
      failingTurns: a.failingTurns,
      errorMessage: a.errorMessage,
    },
    detail: { kind: "prompt", prompt: a.prompt, response: a.response },
    turns: a.turns?.map((t) => ({
      turnIndex: t.turnIndex,
      detail: { kind: "prompt", prompt: t.prompt, response: t.response },
    })),
  };
}
