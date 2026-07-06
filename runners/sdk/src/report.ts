import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunResults } from "./types.js";

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

      const html = renderHtmlReport(results);
      await writeFile(resolvedPath, html, "utf8");
      return resolvedPath;
    },
  };
}

function toFsPath(p: string | URL): string {
  return p instanceof URL ? fileURLToPath(p) : p;
}

function renderHtmlReport(results: RunResults): string {
  const findingRows = results.findings
    .map(
      (f) => `
      <tr class="${f.severity}">
        <td><span class="severity ${f.severity}">${f.severity.toUpperCase()}</span></td>
        <td>${escapeHtml(f.title)}</td>
        <td>${escapeHtml(f.evaluatorId)}</td>
        <td>${escapeHtml(f.evidence ?? "")}</td>
      </tr>`
    )
    .join("\n");

  const evaluatorRows = results.evaluators
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.evaluatorName)}</td>
        <td><span class="severity ${e.severity}">${e.severity}</span></td>
        <td>${e.total}</td>
        <td class="pass">${e.passed}</td>
        <td class="fail">${e.failed}</td>
        <td>${e.errors}</td>
        <td>${(e.passRate * 100).toFixed(0)}%</td>
      </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Opfor Security Report - ${escapeHtml(results.targetName)}</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --surface: #141414;
      --border: #2a2a2a;
      --text: #e0e0e0;
      --text-muted: #888;
      --critical: #ff4444;
      --high: #ff8844;
      --medium: #ffcc00;
      --low: #44aa44;
      --pass: #22c55e;
      --fail: #ef4444;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    
    .container { max-width: 1200px; margin: 0 auto; }
    
    h1, h2, h3 { font-weight: 600; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.25rem; margin: 2rem 0 1rem; color: var(--text-muted); }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    
    .score-box {
      text-align: center;
      padding: 1rem 2rem;
      background: var(--surface);
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    
    .score {
      font-size: 3rem;
      font-weight: 700;
      color: ${results.score >= 80 ? "var(--pass)" : results.score >= 50 ? "var(--medium)" : "var(--fail)"};
    }
    
    .score-label { color: var(--text-muted); font-size: 0.875rem; }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .stat-card {
      background: var(--surface);
      padding: 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      text-align: center;
    }
    
    .stat-value { font-size: 1.5rem; font-weight: 700; }
    .stat-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 2rem;
    }
    
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      background: var(--bg);
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    
    .severity {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .severity.critical { background: var(--critical); color: white; }
    .severity.high { background: var(--high); color: black; }
    .severity.medium { background: var(--medium); color: black; }
    .severity.low { background: var(--low); color: white; }
    
    .pass { color: var(--pass); }
    .fail { color: var(--fail); }
    
    .meta { color: var(--text-muted); font-size: 0.875rem; }
    
    .no-findings {
      text-align: center;
      padding: 3rem;
      color: var(--pass);
      font-size: 1.25rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>Opfor Security Report</h1>
        <p class="meta">Target: ${escapeHtml(results.targetName)} (${results.targetKind})</p>
        <p class="meta">Generated: ${new Date(results.timestamp).toLocaleString()}</p>
        <p class="meta">Models: ${escapeHtml(results.attackerModel)} / ${escapeHtml(results.judgeModel)}</p>
      </div>
      <div class="score-box">
        <div class="score">${results.score}%</div>
        <div class="score-label">Safety Score</div>
      </div>
    </div>
    
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${results.summary.total}</div>
        <div class="stat-label">Total Attacks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value pass">${results.summary.passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value fail">${results.summary.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${results.summary.errors}</div>
        <div class="stat-label">Errors</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${results.findings.length}</div>
        <div class="stat-label">Findings</div>
      </div>
    </div>
    
    <h2>Findings</h2>
    ${
      results.findings.length === 0
        ? '<div class="no-findings">✓ No vulnerabilities detected</div>'
        : `
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Finding</th>
          <th>Evaluator</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        ${findingRows}
      </tbody>
    </table>`
    }
    
    <h2>Evaluators</h2>
    <table>
      <thead>
        <tr>
          <th>Evaluator</th>
          <th>Severity</th>
          <th>Total</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Errors</th>
          <th>Pass Rate</th>
        </tr>
      </thead>
      <tbody>
        ${evaluatorRows}
      </tbody>
    </table>
    
    <p class="meta" style="text-align: center; margin-top: 2rem;">
      Report ID: ${results.id} | Effort: ${results.effort}
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
