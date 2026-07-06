import { writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { writeReport } from "@keyvaluesystems/agent-opfor-core/report/buildReport.js";
import type { RunResults } from "./types.js";
import { getCoreReport } from "./internal/coreReportStore.js";

export interface ReportBuilder {
  json(outputPath: string | URL): Promise<string>;
  html(outputPath: string | URL): Promise<string>;
}

function toFsPath(outputPath: string | URL): string {
  return typeof outputPath === "string" ? outputPath : outputPath.pathname;
}

/**
 * Build a report from run results.
 *
 * HTML uses the same template as `opfor run` (core `writeReport`).
 * JSON writes the SDK `RunResults` shape unless a core report is available,
 * in which case the CLI-compatible unified report JSON is written instead.
 */
export function report(results: RunResults): ReportBuilder {
  return {
    async json(outputPath: string | URL): Promise<string> {
      const resolvedPath = path.resolve(toFsPath(outputPath));
      await mkdir(path.dirname(resolvedPath), { recursive: true });

      const core = getCoreReport(results);
      if (core) {
        const files = await writeReport(core, path.dirname(resolvedPath));
        if (path.resolve(files.json) !== resolvedPath) {
          await copyFile(files.json, resolvedPath);
        }
        return resolvedPath;
      }

      await writeFile(resolvedPath, JSON.stringify(results, null, 2), "utf8");
      return resolvedPath;
    },

    async html(outputPath: string | URL): Promise<string> {
      const resolvedPath = path.resolve(toFsPath(outputPath));
      await mkdir(path.dirname(resolvedPath), { recursive: true });

      const core = getCoreReport(results);
      if (core) {
        const files = await writeReport(core, path.dirname(resolvedPath));
        if (path.resolve(files.html) !== resolvedPath) {
          await copyFile(files.html, resolvedPath);
        }
        return resolvedPath;
      }

      await writeFile(resolvedPath, renderFallbackHtml(results), "utf8");
      return resolvedPath;
    },
  };
}

/** Minimal HTML when only transformed RunResults exist (e.g. unit tests). */
function renderFallbackHtml(results: RunResults): string {
  const findingsHtml = results.findings
    .map(
      (f) =>
        `<div class="finding ${f.severity}"><h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.description)}</p></div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Opfor Report — ${escapeHtml(results.targetName)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    .score { font-size: 2rem; font-weight: bold; }
    .finding { border-left: 4px solid #ccc; padding: 1rem; margin: 1rem 0; }
    .finding.critical { border-color: #dc2626; }
    .finding.high { border-color: #ea580c; }
    .finding.medium { border-color: #ca8a04; }
    .finding.low { border-color: #2563eb; }
  </style>
</head>
<body>
  <h1>Opfor Report</h1>
  <p>Target: ${escapeHtml(results.targetName)} (${results.targetKind})</p>
  <p class="score">Safety score: ${results.score}/100</p>
  <p>${results.summary.passed} passed · ${results.summary.failed} failed · ${results.summary.errors} errors</p>
  <h2>Findings (${results.findings.length})</h2>
  ${findingsHtml || "<p>No findings.</p>"}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
