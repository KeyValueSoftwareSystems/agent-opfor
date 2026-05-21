import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  UnifiedRunReport,
  AttackResult,
  EvaluatorResult,
  TurnRecord,
} from "../execute/types.js";

export interface ReportFiles {
  html: string;
  json: string;
}

/**
 * Write a unified HTML + JSON report for any run (agent or MCP target).
 * Returns the absolute paths to the written files.
 */
export async function writeReport(report: UnifiedRunReport, outputDir = "."): Promise<ReportFiles> {
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = report.targetName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const base = `opfor-report-${slug}-${timestamp}`;

  const htmlPath = path.resolve(outputDir, `${base}.html`);
  const jsonPath = path.resolve(outputDir, `${base}.json`);

  await writeFile(htmlPath, renderHtml(report), "utf8");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------

function renderHtml(report: UnifiedRunReport): string {
  const { summary } = report;
  const scoreColor =
    summary.safetyScore >= 80 ? "#22c55e" : summary.safetyScore >= 50 ? "#f59e0b" : "#ef4444";

  const evaluatorsHtml = report.evaluators.map(renderEvaluatorSection).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opfor Report — ${esc(report.targetName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.5; }
  a { color: #60a5fa; }
  .container { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
  .header { margin-bottom: 2rem; }
  .header h1 { font-size: 1.75rem; font-weight: 700; color: #f1f5f9; }
  .header .meta { font-size: 0.875rem; color: #94a3b8; margin-top: 0.5rem; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.25rem; text-align: center; }
  .stat .value { font-size: 2rem; font-weight: 800; line-height: 1; }
  .stat .label { font-size: 0.75rem; color: #94a3b8; margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .evaluator { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; margin-bottom: 1.25rem; overflow: hidden; }
  .evaluator-header { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; background: #1a2744; }
  .evaluator-header h2 { font-size: 1rem; font-weight: 600; flex: 1; }
  .badge { display: inline-flex; align-items: center; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
  .badge-pass { background: #14532d; color: #86efac; }
  .badge-fail { background: #450a0a; color: #fca5a5; }
  .badge-error { background: #422006; color: #fed7aa; }
  .badge-crit { background: #450a0a; color: #fca5a5; }
  .badge-high { background: #431407; color: #fdba74; }
  .badge-medium { background: #422006; color: #fde68a; }
  .badge-low { background: #1a2744; color: #93c5fd; }
  .attacks { padding: 0.75rem 1.25rem 1.25rem; }
  .attack { border: 1px solid #334155; border-radius: 0.5rem; margin-bottom: 0.75rem; overflow: hidden; }
  .attack-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: #0f172a; cursor: pointer; }
  .attack-header .pattern { font-size: 0.8rem; font-weight: 500; flex: 1; }
  .attack-body { padding: 1rem; font-size: 0.8rem; display: none; }
  .attack-body.open { display: block; }
  .field { margin-bottom: 0.75rem; }
  .field-label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
  .code-block { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.375rem; padding: 0.75rem; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; font-size: 0.78rem; color: #cbd5e1; max-height: 300px; overflow-y: auto; }
  .turns { margin-top: 0.75rem; }
  .turn { border-left: 2px solid #334155; padding-left: 0.75rem; margin-bottom: 0.75rem; }
  .turn-label { font-size: 0.7rem; color: #94a3b8; margin-bottom: 0.25rem; }
  .score-bar-wrap { margin-top: 0.25rem; height: 6px; background: #0f172a; border-radius: 3px; overflow: hidden; }
  .score-bar { height: 100%; border-radius: 3px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🔴 Opfor Report — ${esc(report.targetName)}</h1>
    <p class="meta">
      Generated ${new Date(report.generatedAt).toLocaleString()} ·
      Target: <strong>${esc(report.targetKind)}</strong> ·
      Effort: <strong>${esc(report.effort)}</strong> ·
      Attack model: ${esc(report.attackModel)} ·
      Judge model: ${esc(report.judgeModel)}
    </p>
  </div>

  <div class="summary-grid">
    <div class="stat">
      <div class="value" style="color:${scoreColor}">${summary.safetyScore}%</div>
      <div class="label">Safety Score</div>
    </div>
    <div class="stat">
      <div class="value">${summary.total}</div>
      <div class="label">Total Attacks</div>
    </div>
    <div class="stat">
      <div class="value" style="color:#22c55e">${summary.passed}</div>
      <div class="label">Passed</div>
    </div>
    <div class="stat">
      <div class="value" style="color:#ef4444">${summary.failed}</div>
      <div class="label">Failed</div>
    </div>
    <div class="stat">
      <div class="value" style="color:#f59e0b">${summary.errors}</div>
      <div class="label">Errors</div>
    </div>
    <div class="stat">
      <div class="value" style="color:#ef4444">${summary.attackSuccessRate}%</div>
      <div class="label">Attack Success</div>
    </div>
  </div>

  ${evaluatorsHtml}
</div>
<script>
document.querySelectorAll('.attack-header').forEach(h => {
  h.addEventListener('click', () => {
    const body = h.nextElementSibling;
    if (body) body.classList.toggle('open');
  });
});
</script>
</body>
</html>`;
}

function renderEvaluatorSection(ev: EvaluatorResult): string {
  const overallVerdict = ev.failed > 0 ? "fail" : ev.errors > 0 ? "error" : "pass";
  const severityBadge = `badge-${ev.severity.toLowerCase()}`;

  const attacksHtml = ev.attacks.map((a) => renderAttackRow(a)).join("\n");

  return `
<div class="evaluator">
  <div class="evaluator-header">
    <h2>${esc(ev.evaluatorName)}</h2>
    <span class="badge ${severityBadge}">${esc(ev.severity)}</span>
    <span class="badge badge-${overallVerdict}">${ev.passed}/${ev.total} passed</span>
    <a href="${esc(ev.ref)}" target="_blank" rel="noopener" style="font-size:0.75rem">${esc(ev.ref)}</a>
  </div>
  <div class="attacks">
    ${attacksHtml}
  </div>
</div>`;
}

function renderAttackRow(a: AttackResult): string {
  const verdictClass = `badge-${a.judge.verdict.toLowerCase()}`;
  const scoreBarColor = a.judge.score >= 7 ? "#22c55e" : a.judge.score >= 4 ? "#f59e0b" : "#ef4444";
  const scoreBarWidth = `${(a.judge.score / 10) * 100}%`;

  const turnsHtml =
    a.turns && a.turns.length > 1
      ? `<div class="turns">` + a.turns.map((t) => renderTurnRow(t)).join("") + `</div>`
      : "";

  const mainContentHtml =
    a.prompt !== undefined
      ? `
    <div class="field">
      <div class="field-label">Attack Prompt</div>
      <div class="code-block">${esc(a.prompt ?? "")}</div>
    </div>
    <div class="field">
      <div class="field-label">Response</div>
      <div class="code-block">${esc(a.response ?? "(no response)")}</div>
    </div>`
      : `
    <div class="field">
      <div class="field-label">Tool</div>
      <div class="code-block">${esc(a.toolName ?? "")}</div>
    </div>
    <div class="field">
      <div class="field-label">Arguments</div>
      <div class="code-block">${esc(JSON.stringify(a.toolArguments ?? {}, null, 2))}</div>
    </div>
    ${a.toolError ? `<div class="field"><div class="field-label">Tool Error</div><div class="code-block">${esc(a.toolError)}</div></div>` : ""}
    ${a.toolResponse ? `<div class="field"><div class="field-label">Response</div><div class="code-block">${esc(a.toolResponse)}</div></div>` : ""}`;

  return `
<div class="attack">
  <div class="attack-header">
    <span class="badge ${verdictClass}">${a.judge.verdict}</span>
    <span class="pattern">${esc(a.patternName)}</span>
    <span style="font-size:0.75rem;color:#94a3b8">score ${a.judge.score}/10 · conf ${a.judge.confidence}%</span>
  </div>
  <div class="attack-body">
    ${mainContentHtml}
    <div class="field">
      <div class="field-label">Judge Reasoning</div>
      <div class="code-block">${esc(a.judge.reasoning)}</div>
    </div>
    ${a.judge.evidence && a.judge.evidence !== "N/A" ? `<div class="field"><div class="field-label">Evidence</div><div class="code-block">${esc(a.judge.evidence)}</div></div>` : ""}
    <div class="field">
      <div class="field-label">Safety Score</div>
      <div class="score-bar-wrap"><div class="score-bar" style="width:${scoreBarWidth};background:${scoreBarColor}"></div></div>
    </div>
    ${turnsHtml}
  </div>
</div>`;
}

function renderTurnRow(t: TurnRecord): string {
  // Per-turn judge rendering removed — judging happens once per attack after
  // all turns. The attack-level verdict is shown above the turn list.
  if (t.kind === "agent") {
    return `
<div class="turn">
  <div class="turn-label">Turn ${t.turnIndex}</div>
  <div class="field-label">Prompt</div>
  <div class="code-block">${esc(t.prompt)}</div>
  <div class="field-label" style="margin-top:0.5rem">Response</div>
  <div class="code-block">${esc(t.response)}</div>
</div>`;
  }
  return `
<div class="turn">
  <div class="turn-label">Turn ${t.turnIndex} — ${esc(t.toolName)}</div>
  <div class="field-label">Arguments</div>
  <div class="code-block">${esc(JSON.stringify(t.toolArguments, null, 2))}</div>
  <div class="field-label" style="margin-top:0.5rem">Response</div>
  <div class="code-block">${esc(t.toolError ? `ERROR: ${t.toolError}` : t.response)}</div>
</div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
