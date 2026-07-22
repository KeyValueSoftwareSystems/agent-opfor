// Write the HTML + JSON report into a per-run subfolder.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AutonomousReport } from "./types.js";
import { renderReportHtml } from "./html.js";

export interface ReportFiles {
  html: string;
  json: string;
  dir: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "target"
  );
}

/**
 * The report subfolder name is derived entirely from values known at run start (target name,
 * run id, start time) — not from anything only available once the run finishes. That lets
 * callers create this folder up front and write live logs directly into it, instead of writing
 * elsewhere and relocating them once the report exists.
 */
export function reportDirFor(
  outputDir: string,
  params: { targetName: string; runId: string; startedAt: string }
): string {
  const compactTs = params.startedAt.replace(/[-:T.Z]/g, "").slice(0, 14);
  const slug = slugify(params.targetName);
  const shortId = params.runId.replace(/-/g, "").slice(0, 8);
  return path.resolve(outputDir, `hunt-report-${compactTs}-${slug}-${shortId}`);
}

export async function writeAutonomousReport(
  report: AutonomousReport,
  outputDir: string
): Promise<ReportFiles> {
  const dir = reportDirFor(outputDir, {
    targetName: report.target.name,
    runId: report.reportId,
    startedAt: report.startedAt,
  });
  await mkdir(dir, { recursive: true });

  const slug = slugify(report.target.name);
  const htmlPath = path.join(dir, `${slug}-report.html`);
  const jsonPath = path.join(dir, `${slug}-report.json`);

  await writeFile(htmlPath, renderReportHtml(report), "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath, dir };
}
