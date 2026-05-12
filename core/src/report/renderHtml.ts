import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunReport, AttackRunResult } from "../run/types.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function severityColor(s: string): string {
  switch (s.toLowerCase()) {
    case "critical":
      return "#DC2626";
    case "high":
      return "#EA580C";
    case "medium":
      return "#D97706";
    case "low":
      return "#16A34A";
    default:
      return "#6B7280";
  }
}

function severityEmoji(s: string): string {
  switch (s.toLowerCase()) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🟢";
    default:
      return "⚪";
  }
}

function severityBadgeClass(s: string): string {
  switch (s.toLowerCase()) {
    case "critical":
      return "sev-critical";
    case "high":
      return "sev-high";
    case "medium":
      return "sev-medium";
    case "low":
      return "sev-low";
    default:
      return "sev-low";
  }
}

function donutSvg(passRate: number, color: string): string {
  const r = 15.9;
  const circumference = 2 * Math.PI * r;
  const filled = (passRate / 100) * circumference;
  const gap = circumference - filled;
  return `<svg viewBox="0 0 36 36" width="80" height="80" style="transform:rotate(-90deg)">
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="#E5E7EB" stroke-width="3.2"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3.2"
      stroke-dasharray="${filled.toFixed(1)} ${gap.toFixed(1)}" stroke-linecap="round"/>
  </svg>`;
}

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

// ─── attack result card ───────────────────────────────────────────────────────

function attackCard(result: AttackRunResult, index: number): string {
  const verdict = result.judge.verdict;
  const tcClass = verdict === "PASS" ? "pass" : verdict === "ERROR" ? "error" : "fail";
  const argsFormatted = esc(JSON.stringify(result.toolArguments, null, 2));

  // Tool response body
  const responseBody = result.toolError
    ? `<span style="color:#EF4444">Tool error: ${esc(result.toolError)}</span>`
    : `<div class="tc-turn-text">${esc(result.rawToolResponse.slice(0, 2000))}${result.rawToolResponse.length > 2000 ? "\n…(truncated)" : ""}</div>`;

  // Multi-turn breakdown
  let turnsHtml = "";
  if (result.turns && result.turns.length > 1) {
    const turnItems = result.turns
      .map((turn) => {
        const turnArgs = esc(JSON.stringify(turn.toolArguments, null, 2));
        const turnResp = turn.toolError
          ? `<span style="color:#EF4444">Error: ${esc(turn.toolError)}</span>`
          : `<div class="tc-turn-text">${esc(turn.rawToolResponse.slice(0, 800))}${turn.rawToolResponse.length > 800 ? "\n…" : ""}</div>`;
        const turnVerdict = turn.judge.verdict;
        const turnVerdictColor =
          turnVerdict === "PASS" ? "#16A34A" : turnVerdict === "ERROR" ? "#D97706" : "#DC2626";
        return `
          <div style="margin-bottom:10px;padding:8px 10px;background:#F8FAFC;border-radius:6px;border-left:2px solid #CBD5E1">
            <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Turn ${turn.turnIndex} — <code>${esc(turn.toolName)}</code> <span style="color:${turnVerdictColor}">${turnVerdict}</span>${turnVerdict !== "ERROR" ? ` · score ${turn.judge.score}/10` : ""}</div>
            <div class="tc-turn-label">Arguments</div>
            <pre class="tc-turn-text">${turnArgs}</pre>
            <div class="tc-turn-label" style="margin-top:6px">Response</div>
            ${turnResp}
            ${turn.judge.reasoning ? `<div style="font-size:11px;color:#6B7280;margin-top:4px;font-style:italic">${esc(turn.judge.reasoning)}</div>` : ""}
          </div>`;
      })
      .join("");
    turnsHtml = `
        <details style="margin-bottom:10px">
          <summary style="font-size:13px">Multi-turn breakdown (${result.turns.length} turns)</summary>
          <div style="margin-top:10px">${turnItems}</div>
        </details>`;
  }

  // Body for ERROR verdict
  let bodyHtml: string;
  if (verdict === "ERROR") {
    bodyHtml = `
        <details style="margin-bottom:8px">
          <summary style="font-size:13px;color:#374151;cursor:pointer">Arguments</summary>
          <pre class="tc-turn-text" style="margin-top:6px">${argsFormatted}</pre>
        </details>
        <div style="margin-top:8px;padding:10px 12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;font-size:13px;color:#92400E">
          <strong>Tool Error:</strong> ${esc(result.judge.errorMessage ?? result.toolError ?? result.rawToolResponse)}
        </div>
        ${turnsHtml}`;
  } else {
    bodyHtml = `
        <details style="margin-bottom:8px">
          <summary style="font-size:13px;color:#374151;cursor:pointer">Arguments</summary>
          <pre class="tc-turn-text" style="margin-top:6px">${argsFormatted}</pre>
        </details>
        <details style="margin-bottom:8px">
          <summary style="font-size:13px;color:#374151;cursor:pointer">Tool Response</summary>
          <div style="margin-top:6px">${responseBody}</div>
        </details>
        ${turnsHtml}`;
  }

  // Judge block (skip for ERROR)
  const judgeBlock =
    verdict === "ERROR"
      ? ""
      : (() => {
          const judgeBg = verdict === "PASS" ? "#F0FDF4" : "#FEF2F2";
          const judgeBorder = verdict === "PASS" ? "#BBF7D0" : "#FECACA";
          const judgeStrong = verdict === "PASS" ? "#065F46" : "#991B1B";
          return `
        <div class="tc-judge ${verdict === "FAIL" ? "fail" : ""}" style="background:${judgeBg};border-color:${judgeBorder}">
          <strong style="color:${judgeStrong}">${verdict}</strong>
          &nbsp;·&nbsp;Score ${result.judge.score}/10
          &nbsp;·&nbsp;Confidence ${result.judge.confidence}%
          ${result.judge.evidence && result.judge.evidence !== "N/A" ? `&nbsp;·&nbsp;Evidence: <em>${esc(result.judge.evidence)}</em>` : ""}
          <br><span style="color:#374151">${esc(result.judge.reasoning)}</span>
        </div>`;
        })();

  return `
      <div class="tc-item ${tcClass}">
        <div class="tc-title">
          #${index + 1} — ${esc(result.attackId)}
        </div>
        <div class="tc-meta">
          Evaluator: <code>${esc(result.evaluatorId)}</code> &nbsp;·&nbsp; Tool: <code>${esc(result.toolName)}</code>
        </div>
        ${bodyHtml}
        ${judgeBlock}
      </div>`;
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function writeHtmlReport(
  report: RunReport,
  outputDir: string
): Promise<{ html: string; json: string }> {
  const now = new Date(report.generatedAt);
  const runDir = path.join(outputDir, `report-${runTimestamp(now)}`);

  const { summary, evaluators } = report;
  const scoreDenominator = summary.passed + summary.failed;
  const noScoreableTests = scoreDenominator === 0;
  const errors = summary.errors ?? 0;

  // Score colors
  const scoreColor = noScoreableTests
    ? "#6B7280"
    : summary.safetyScore >= 70
      ? "#16A34A"
      : summary.safetyScore >= 50
        ? "#EAB308"
        : "#DC2626";
  const scoreClass = noScoreableTests
    ? "color-gray"
    : summary.safetyScore >= 70
      ? "color-green"
      : summary.safetyScore >= 50
        ? "color-yellow"
        : "color-red";
  const scoreFillClass = noScoreableTests
    ? "fill-gray"
    : summary.safetyScore >= 70
      ? "fill-green"
      : summary.safetyScore >= 50
        ? "fill-yellow"
        : "fill-red";
  const attackClass = summary.attackSuccessRate > 30 ? "color-red" : "color-green";
  const evalsFailed = evaluators.filter((e) => e.failed > 0).length;
  const evalsClass = evalsFailed > 0 ? "color-red" : errors > 0 ? "color-amber" : "color-green";
  const errorsClass = errors > 0 ? "color-amber" : "color-green";

  // ── Assessment Scope ───────────────────────────────────────────────────────
  const scopeDesc = evaluators
    .map(
      (e) => `${(e.evaluatorName || e.evaluatorId).toLowerCase()}${e.owasp ? ` (${e.owasp})` : ""}`
    )
    .join(" · ");

  const scopeSection = `
  <section>
    <h2>Assessment Scope</h2>
    <div class="suite-box">
      <div class="pie-wrap">
        ${donutSvg(noScoreableTests ? 0 : summary.safetyScore, scoreColor)}
        <div class="pie-label" style="color:${scoreColor}">${noScoreableTests ? "N/A" : `${summary.safetyScore}%`}</div>
      </div>
      <div style="flex:1;min-width:160px">
        <div class="suite-name">${esc(report.suiteId)}</div>
        <div class="suite-desc">${esc(scopeDesc)}</div>
      </div>
      <div class="suite-stats">
        <div class="suite-stat">
          <div class="suite-stat-num">${evaluators.length}</div>
          <div class="suite-stat-label">Evaluators</div>
        </div>
        <div class="suite-stat">
          <div class="suite-stat-num color-green">${summary.passed}</div>
          <div class="suite-stat-label">Passed</div>
        </div>
        <div class="suite-stat">
          <div class="suite-stat-num color-red">${summary.failed}</div>
          <div class="suite-stat-label">Failed</div>
        </div>
        ${
          errors > 0
            ? `
        <div class="suite-stat">
          <div class="suite-stat-num color-amber">${errors}</div>
          <div class="suite-stat-label">Errors</div>
        </div>`
            : ""
        }
      </div>
    </div>
  </section>`;

  // ── Evaluator Results Table ────────────────────────────────────────────────
  const anyErrors = evaluators.some((e) => (e.errors ?? 0) > 0);
  const evaluatorRows = evaluators
    .map((e) => {
      const evalErrors = e.errors ?? 0;
      const passDenom = e.passed + e.failed;
      const passRate = passDenom > 0 ? Math.round((e.passed / passDenom) * 100) : 0;
      const scoreable = e.results.filter((r) => r.judge.verdict !== "ERROR");
      const avgScore =
        scoreable.length > 0
          ? (scoreable.reduce((s, r) => s + r.judge.score, 0) / scoreable.length).toFixed(1)
          : "—";
      const emoji = severityEmoji(e.severity);
      const badgeClass = severityBadgeClass(e.severity);
      return `
        <tr>
          <td><strong>${emoji} ${esc(e.evaluatorName || e.evaluatorId)}</strong>${e.owasp ? `<br><span style="font-size:11px;color:#6B7280">${esc(e.owasp)}</span>` : ""}</td>
          <td>${e.severity ? `<span class="sev-badge ${badgeClass}">${esc(e.severity)}</span>` : "—"}</td>
          <td>${e.total}</td>
          <td style="color:#16A34A;font-weight:700">${e.passed}</td>
          <td style="color:#DC2626;font-weight:700">${e.failed}</td>
          ${anyErrors ? `<td style="color:#D97706;font-weight:700">${evalErrors > 0 ? evalErrors : "—"}</td>` : ""}
          <td>${passDenom > 0 ? `${passRate}%` : "—"}</td>
          <td>${avgScore !== "—" ? `${avgScore} / 10` : "—"}</td>
        </tr>`;
    })
    .join("\n");

  // ── Findings ──────────────────────────────────────────────────────────────
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
    if (e.severity === "critical") {
      for (const r of e.results) {
        if (r.judge.verdict === "FAIL") {
          criticalFindings.push({
            rank: 0,
            evaluator: e.evaluatorName || e.evaluatorId,
            attackId: r.attackId,
            score: r.judge.score,
            description: r.judge.reasoning,
          });
        }
      }
    }
  }
  for (const e of evaluators) {
    if (e.severity === "high") {
      for (const r of e.results) {
        if (r.judge.verdict === "FAIL") {
          highFindings.push({
            rank: 0,
            evaluator: e.evaluatorName || e.evaluatorId,
            attackId: r.attackId,
            score: r.judge.score,
            description: r.judge.reasoning,
          });
        }
      }
    }
  }
  criticalFindings.sort((a, b) => a.score - b.score);
  highFindings.sort((a, b) => a.score - b.score);
  criticalFindings.forEach((f, i) => {
    f.rank = i + 1;
  });
  highFindings.forEach((f, i) => {
    f.rank = i + 1;
  });

  const findingCard = (f: Finding, color: string) => `
      <div class="finding-card" style="border-left-color:${color}">
        <div class="finding-header">
          <span class="finding-rank">#${f.rank}</span>
          <strong>${esc(f.evaluator)}</strong>
          <span style="color:#6B7280;font-size:12px">${esc(f.attackId)}</span>
          <span style="margin-left:auto;font-size:12px;font-weight:600;color:${color}">Score ${f.score}/10</span>
        </div>
        <div class="finding-desc">${esc(f.description)}</div>
      </div>`;

  const findingsHtml = (() => {
    if (criticalFindings.length === 0 && highFindings.length === 0) {
      return `<div class="findings-empty">No vulnerabilities found — all tests passed.</div>`;
    }
    let out = "";
    if (criticalFindings.length > 0) {
      out += `<h3 style="color:#DC2626;margin-bottom:12px">Critical (${criticalFindings.length})</h3>`;
      out += criticalFindings.map((f) => findingCard(f, "#DC2626")).join("");
    }
    if (highFindings.length > 0) {
      out += `<h3 style="color:#EA580C;margin:${criticalFindings.length > 0 ? "24px" : "0"} 0 12px">High (${highFindings.length})</h3>`;
      out += highFindings.map((f) => findingCard(f, "#EA580C")).join("");
    }
    return out;
  })();

  // ── Appendix ──────────────────────────────────────────────────────────────
  const appendix = evaluators
    .map((e) => {
      const color = severityColor(e.severity);
      const evalErrors = e.errors ?? 0;
      const cards = e.results.map((r, i) => attackCard(r, i)).join("\n");
      const summaryLabel =
        `<span style="color:${color}">${esc(e.evaluatorName || e.evaluatorId)}</span>` +
        (e.owasp
          ? ` <span style="font-weight:400;font-size:12px;color:#6B7280"> · ${esc(e.owasp)}</span>`
          : "") +
        ` <span style="font-weight:400;font-size:12px;color:#6B7280"> · ${e.severity} · ${e.passed}/${e.total - evalErrors} passed${evalErrors > 0 ? ` · ${evalErrors} error${evalErrors !== 1 ? "s" : ""}` : ""}</span>`;
      return `
      <details>
        <summary>${summaryLabel}</summary>
        <div class="tc-block">${cards}</div>
      </details>`;
    })
    .join("\n");

  // ── JSON report ───────────────────────────────────────────────────────────
  const jsonReport = {
    ...report,
    summary: {
      ...report.summary,
      errors,
    },
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

  // ── HTML ──────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Astra MCP Report — ${esc(report.suiteId)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, system-ui, sans-serif; background: #F9FAFB; color: #111827; font-size: 14px; line-height: 1.5; }

    /* ── Header ── */
    .header { background: #1E293B; color: #F1F5F9; padding: 24px 32px; }
    .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .header-meta { display: flex; flex-wrap: wrap; gap: 20px; font-size: 13px; color: #94A3B8; margin-top: 6px; }
    .header-meta span strong { color: #CBD5E1; }
    .badge-completed { background: #16A34A; color: #fff; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }

    /* ── Layout ── */
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    section { margin-bottom: 40px; }
    h2 { font-size: 16px; font-weight: 700; color: #1E293B; margin-bottom: 16px; border-bottom: 2px solid #E2E8F0; padding-bottom: 8px; }
    h3 { font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 10px; }

    /* ── Summary Cards ── */
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    @media (max-width: 768px) { .cards { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 400px) { .cards { grid-template-columns: 1fr; } }
    .card { background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 20px; text-align: center; }
    .card-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .card-value { font-size: 36px; font-weight: 800; line-height: 1; }
    .card-sub { font-size: 12px; color: #6B7280; margin-top: 6px; }
    .bar { height: 6px; border-radius: 3px; background: #E5E7EB; margin-top: 10px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .color-green  { color: #16A34A; } .fill-green  { background: #16A34A; }
    .color-yellow { color: #EAB308; } .fill-yellow { background: #EAB308; }
    .color-red    { color: #DC2626; } .fill-red    { background: #DC2626; }
    .color-amber  { color: #D97706; } .fill-amber  { background: #D97706; }
    .color-gray   { color: #6B7280; } .fill-gray   { background: #6B7280; }

    /* ── Suite Box ── */
    .suite-box { background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 20px 24px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    .suite-name { font-size: 15px; font-weight: 700; color: #1E293B; }
    .suite-desc { font-size: 13px; color: #6B7280; margin-top: 2px; }
    .pie-wrap { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
    .pie-wrap svg { display: block; }
    .pie-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }
    .suite-stats { display: flex; gap: 24px; flex-wrap: wrap; margin-left: auto; }
    .suite-stat { text-align: center; }
    .suite-stat-num { font-size: 24px; font-weight: 800; color: #1E293B; }
    .suite-stat-label { font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: .05em; }

    /* ── Results Table ── */
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #E2E8F0; }
    th { background: #F8FAFC; text-align: left; padding: 10px 14px; font-size: 12px; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #E2E8F0; }
    td { padding: 12px 14px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #F9FAFB; }
    .sev-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .sev-critical { background: #FEE2E2; color: #DC2626; }
    .sev-high     { background: #FFEDD5; color: #EA580C; }
    .sev-medium   { background: #FEF9C3; color: #A16207; }
    .sev-low      { background: #DCFCE7; color: #16A34A; }

    /* ── Findings ── */
    .findings-empty { background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 10px; padding: 20px 24px; color: #15803D; font-weight: 600; text-align: center; font-size: 15px; }
    .finding-card { background: #fff; border: 1px solid #E2E8F0; border-left: 4px solid #DC2626; border-radius: 0 8px 8px 0; padding: 14px 16px; margin-bottom: 12px; }
    .finding-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 14px; }
    .finding-rank { background: #F3F4F6; color: #374151; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px; }
    .finding-desc { font-size: 13px; color: #4B5563; }

    /* ── Appendix ── */
    details { background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; margin-bottom: 12px; }
    summary { padding: 14px 18px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 10px; user-select: none; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: "▶"; font-size: 10px; color: #6B7280; transition: transform 0.15s; flex-shrink: 0; }
    details[open] > summary::before { transform: rotate(90deg); }
    .tc-block { padding: 0 18px 18px; }
    .tc-item { border-left: 3px solid #E2E8F0; padding: 10px 14px; margin-bottom: 14px; border-radius: 0 6px 6px 0; }
    .tc-item.pass  { border-color: #10B981; }
    .tc-item.fail  { border-color: #EF4444; }
    .tc-item.error { border-color: #F59E0B; background: #FFFBEB; }
    .tc-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #1E293B; }
    .tc-meta  { font-size: 12px; color: #6B7280; margin-bottom: 8px; }
    .tc-turn-label { font-size: 11px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
    .tc-turn-text { font-size: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; max-height: 200px; overflow: auto; }
    .tc-judge { margin-top: 10px; font-size: 12px; padding: 8px 12px; border-radius: 6px; border: 1px solid #BBF7D0; background: #F0FDF4; line-height: 1.6; }
    .tc-judge.fail { background: #FEF2F2; border-color: #FECACA; }

    /* ── Print ── */
    @media print {
      .header { background: #fff !important; color: #000 !important; border-bottom: 2px solid #000; }
      body { background: #fff; }
      details { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

<!-- Header -->
<div class="header">
  <h1>Astra MCP Security Report — ${esc(report.suiteId)}</h1>
  <div class="header-meta">
    <span><strong>Report ID:</strong> ${esc(report.reportId)}</span>
    <span><strong>Date:</strong> ${now.toLocaleString()}</span>
    <span><strong>Server:</strong> ${esc(report.serverSummary)}</span>
    <span><strong>Generator:</strong> ${esc(report.generatorModel)}</span>
    <span><strong>Judge:</strong> ${esc(report.judgeModel)}</span>
    <span><strong>Results:</strong> ${summary.passed}/${summary.total} passed</span>
    <span><span class="badge-completed">Completed</span></span>
  </div>
</div>

<div class="container">

  <!-- Summary Cards -->
  <section>
    <h2>Summary</h2>
    <div class="cards">
      <div class="card">
        <div class="card-label">Safety Score</div>
        <div class="card-value ${scoreClass}">${noScoreableTests ? "N/A" : `${summary.safetyScore}%`}</div>
        ${noScoreableTests ? "" : `<div class="bar"><div class="bar-fill ${scoreFillClass}" style="width:${summary.safetyScore}%"></div></div>`}
        <div class="card-sub">${noScoreableTests ? "No scoreable tests" : `${summary.passed} of ${scoreDenominator} tests passed`}${errors > 0 ? ` · ${errors} error${errors !== 1 ? "s" : ""} excluded` : ""}</div>
      </div>
      <div class="card">
        <div class="card-label">Evaluations Failed</div>
        <div class="card-value ${evalsClass}">${evalsFailed}</div>
        <div class="card-sub">of ${evaluators.length} evaluator${evaluators.length !== 1 ? "s" : ""} run</div>
      </div>
      <div class="card">
        <div class="card-label">Attack Success Rate</div>
        <div class="card-value ${attackClass}">${noScoreableTests ? "N/A" : `${summary.attackSuccessRate}%`}</div>
        ${noScoreableTests ? "" : `<div class="bar"><div class="bar-fill ${summary.attackSuccessRate > 30 ? "fill-red" : "fill-green"}" style="width:${summary.attackSuccessRate}%"></div></div>`}
        <div class="card-sub">${summary.failed} attack${summary.failed !== 1 ? "s" : ""} succeeded</div>
      </div>
      <div class="card">
        <div class="card-label">Errors</div>
        <div class="card-value ${errorsClass}">${errors}</div>
        <div class="card-sub">${errors > 0 ? "tool errors (excluded from score)" : "no tool errors"}</div>
      </div>
    </div>
  </section>

  ${scopeSection}

  <!-- Evaluator Results Table -->
  <section>
    <h2>Evaluator Results</h2>
    <table>
      <thead>
        <tr>
          <th>Evaluator</th>
          <th>Severity</th>
          <th>Tests</th>
          <th>Passed</th>
          <th>Failed</th>
          ${anyErrors ? "<th>Errors</th>" : ""}
          <th>Pass Rate</th>
          <th>Avg Score</th>
        </tr>
      </thead>
      <tbody>
        ${evaluatorRows}
      </tbody>
    </table>
  </section>

  <!-- Findings -->
  <section>
    <h2>Findings</h2>
    ${findingsHtml}
  </section>

  <!-- Appendix -->
  <section>
    <h2>Appendix — Full Attack Results</h2>
    ${appendix}
  </section>

</div>

<footer style="text-align:center;color:#9CA3AF;font-size:12px;padding:24px 0;border-top:1px solid #E2E8F0;margin-top:8px">
  Generated by Astra MCP &nbsp;·&nbsp; ${esc(report.reportId)} &nbsp;·&nbsp; ${now.toISOString()} &nbsp;·&nbsp; Generator: ${esc(report.generatorModel)} &nbsp;·&nbsp; Judge: ${esc(report.judgeModel)}
</footer>

</body>
</html>`;

  await mkdir(runDir, { recursive: true });
  const htmlPath = path.join(runDir, `${report.reportId}.html`);
  const jsonPath = path.join(runDir, `${report.reportId}.json`);
  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}
