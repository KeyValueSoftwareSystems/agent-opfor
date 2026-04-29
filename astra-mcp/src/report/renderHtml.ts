import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunReport, AttackRunResult } from "../run/types.js";

// ─── small helpers ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function severityColor(s: string): string {
  switch (s.toLowerCase()) {
    case "critical": return "#DC2626";
    case "high":     return "#EA580C";
    case "medium":   return "#D97706";
    case "low":      return "#16A34A";
    default:         return "#6B7280";
  }
}

function verdictBadge(verdict: "PASS" | "FAIL"): string {
  const color = verdict === "PASS" ? "#10B981" : "#EF4444";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color};color:#fff;font-size:12px;font-weight:700">${verdict}</span>`;
}

function scoreColor(n: number): string {
  if (n <= 3) return "#10B981";
  if (n <= 6) return "#D97706";
  return "#EF4444";
}

function safetyScoreColor(n: number): string {
  if (n >= 70) return "#10B981";
  if (n >= 40) return "#D97706";
  return "#EF4444";
}

// ─── section builders ─────────────────────────────────────────────────────────

function metaCards(r: RunReport): string {
  const sc = safetyScoreColor(r.summary.safetyScore);
  const asr = r.summary.attackSuccessRate;
  return `
  <div class="cards">
    <div class="card">
      <div class="card-label">Safety Score</div>
      <div class="card-value" style="color:${sc}">${r.summary.safetyScore}%</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${r.summary.safetyScore}%;background:${sc}"></div></div>
      <div class="card-sub">${r.summary.passed} of ${r.summary.total} tests passed</div>
    </div>
    <div class="card">
      <div class="card-label">Attack Success Rate</div>
      <div class="card-value" style="color:${asr > 30 ? "#EF4444" : "#10B981"}">${asr}%</div>
      <div class="card-sub">${r.summary.failed} attack${r.summary.failed !== 1 ? "s" : ""} succeeded</div>
    </div>
    <div class="card">
      <div class="card-label">Tests Run</div>
      <div class="card-value">${r.summary.total}</div>
      <div class="card-sub">across ${r.evaluators.length} evaluator${r.evaluators.length !== 1 ? "s" : ""}</div>
    </div>
    <div class="card">
      <div class="card-label">Judge Model</div>
      <div class="card-value" style="font-size:14px;line-height:1.4">${esc(r.judgeModel)}</div>
      <div class="card-sub">transport: ${r.transport}</div>
    </div>
  </div>`;
}

function evaluatorTable(r: RunReport): string {
  const rows = r.evaluators.map((e) => {
    const color = severityColor(e.severity);
    return `
      <tr>
        <td><strong>${esc(e.evaluatorName || e.evaluatorId)}</strong><br/><span style="font-size:11px;color:#6B7280">${esc(e.evaluatorId)}</span></td>
        <td>${e.owasp ? `<code style="font-size:11px">${esc(e.owasp)}</code>` : "—"}</td>
        <td><span style="color:${color};font-weight:600">${esc(e.severity || "—")}</span></td>
        <td>${e.total}</td>
        <td style="color:#10B981;font-weight:600">${e.passed}</td>
        <td style="color:#EF4444;font-weight:600">${e.failed}</td>
        <td>${e.passRate}%</td>
      </tr>`;
  }).join("\n");

  return `
  <div class="section">
    <h2>Evaluator Results</h2>
    <table>
      <thead>
        <tr>
          <th>Evaluator</th><th>OWASP</th><th>Severity</th>
          <th>Tests</th><th>Passed</th><th>Failed</th><th>Pass Rate</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function attackResultCard(result: AttackRunResult, index: number): string {
  const vc = result.judge.verdict === "PASS" ? "#10B981" : "#EF4444";
  const argsFormatted = JSON.stringify(result.toolArguments, null, 2);
  const responsePreview = result.toolError
    ? `<span style="color:#EF4444">Tool error: ${esc(result.toolError)}</span>`
    : `<pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:200px;overflow:auto;background:#F9FAFB;padding:8px;border-radius:4px">${esc(result.rawToolResponse.slice(0, 2000))}${result.rawToolResponse.length > 2000 ? "\n…(truncated)" : ""}</pre>`;

  return `
    <div style="margin:12px 0;padding:14px;background:#fff;border-radius:8px;border-left:4px solid ${vc};box-shadow:0 1px 2px rgba(0,0,0,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;font-size:14px">#${index + 1} — ${esc(result.attackId)}</span>
        ${verdictBadge(result.judge.verdict)}
      </div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:6px">
        Evaluator: <code>${esc(result.evaluatorId)}</code> &nbsp;·&nbsp;
        Tool: <code>${esc(result.toolName)}</code>
      </div>
      <details style="margin-bottom:8px">
        <summary style="font-size:13px;color:#374151;cursor:pointer">Arguments</summary>
        <pre style="white-space:pre-wrap;font-size:12px;background:#F3F4F6;padding:8px;border-radius:4px;margin-top:6px">${esc(argsFormatted)}</pre>
      </details>
      <details>
        <summary style="font-size:13px;color:#374151;cursor:pointer">Tool Response</summary>
        <div style="margin-top:6px">${responsePreview}</div>
      </details>
      <div style="margin-top:10px;padding:8px;background:#F9FAFB;border-radius:4px;font-size:13px">
        <span style="color:#6B7280">Score:</span>
        <strong style="color:${scoreColor(result.judge.score)}">${result.judge.score}/10</strong> &nbsp;·&nbsp;
        <span style="color:#6B7280">Confidence:</span> ${result.judge.confidence}% &nbsp;·&nbsp;
        <span style="color:#6B7280">Evidence:</span> ${esc(result.judge.evidence)}
      </div>
      <div style="margin-top:6px;font-size:13px;color:#374151">${esc(result.judge.reasoning)}</div>
    </div>`;
}

function appendixSection(r: RunReport): string {
  const allResults = r.evaluators.flatMap((e) => e.results);
  const cards = allResults.map((res, i) => attackResultCard(res, i)).join("\n");
  return `
  <div class="section">
    <details>
      <summary>📋 Full Attack Results (${allResults.length} total)</summary>
      <div style="margin-top:16px">${cards}</div>
    </details>
  </div>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: #F3F4F6; color: #111827; line-height: 1.5; }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #0F172A; color: #fff; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; margin-bottom: 6px; }
  .header p  { color: #94A3B8; font-size: 13px; margin-top: 4px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .card-value { font-size: 32px; font-weight: 700; }
  .card-sub   { font-size: 13px; color: #6B7280; margin-top: 4px; }
  .progress-bar  { height: 6px; background: #E5E7EB; border-radius: 3px; overflow: hidden; margin-top: 8px; }
  .progress-fill { height: 100%; border-radius: 3px; }
  .section { background: #fff; border-radius: 10px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .section h2 { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #1E293B; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #F8FAFC; text-align: left; padding: 10px 12px; font-size: 12px; color: #6B7280; text-transform: uppercase; border-bottom: 1px solid #E5E7EB; }
  td { padding: 10px 12px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  details summary { cursor: pointer; font-weight: 600; font-size: 14px; color: #1E293B; padding: 8px 0; list-style: none; }
  details summary::before { content: "▶ "; font-size: 10px; }
  details[open] summary::before { content: "▼ "; }
  @media (max-width: 640px) { .card-value { font-size: 24px; } table { font-size: 12px; } }
  @media print { body { background: #fff; } .section { box-shadow: none; border: 1px solid #E5E7EB; } }
`;

// ─── main export ──────────────────────────────────────────────────────────────

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

export async function writeHtmlReport(report: RunReport, outputDir: string): Promise<{ html: string; json: string }> {
  const now = new Date(report.generatedAt);
  const runDir = path.join(outputDir, `report-${runTimestamp(now)}`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Astra MCP Report — ${esc(report.suiteId)}</title>
  <style>${CSS}</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>🛡️ Astra MCP Security Report</h1>
    <p>Suite: <strong style="color:#fff">${esc(report.suiteId)}</strong></p>
    <p>Server: ${esc(report.serverSummary)}</p>
    <p>Generated: ${now.toLocaleString()} &nbsp;·&nbsp; Report ID: ${esc(report.reportId)}</p>
  </div>

  ${metaCards(report)}
  ${evaluatorTable(report)}
  ${appendixSection(report)}

</div>
</body>
</html>`;

  await mkdir(runDir, { recursive: true });
  const htmlPath = path.join(runDir, `${report.reportId}.html`);
  const jsonPath = path.join(runDir, `${report.reportId}.json`);
  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}
