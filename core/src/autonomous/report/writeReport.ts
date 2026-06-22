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

export async function writeAutonomousReport(
  report: AutonomousReport,
  outputDir: string
): Promise<ReportFiles> {
  const compactTs = report.generatedAt.replace(/[-:T.Z]/g, "").slice(0, 14);
  const slug =
    report.target.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "target";
  const shortId = report.reportId.replace(/-/g, "").slice(0, 8);
  const dir = path.resolve(outputDir, `hunt-report-${compactTs}-${slug}-${shortId}`);
  await mkdir(dir, { recursive: true });

  const htmlPath = path.join(dir, "report.html");
  const jsonPath = path.join(dir, "report.json");

  await writeFile(htmlPath, renderReportHtml(report), "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath, dir };
}
