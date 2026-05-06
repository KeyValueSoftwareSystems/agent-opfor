import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import type { JudgeResult } from "../evaluators/judge.js";

/** A single turn in a multi-turn attack sequence. */
export interface TurnRecord {
  turnIndex: number;
  prompt: string;
  response: string;
  judge: JudgeResult;
}

export interface TestResult {
  testNumber: number;
  pattern: string;
  prompt: string;
  response: string;
  judge: JudgeResult;
  /** Propagated OTEL/Langfuse trace id (32 hex) when telemetry propagation was used for this attack. */
  traceId?: string;
  /** Present for multi-turn attacks — full turn-by-turn breakdown. */
  turns?: TurnRecord[];
}

export interface EvaluatorReport {
  evaluator: EvaluatorSpec;
  results: TestResult[];
}

export interface ReportPaths {
  html: string;
  json: string;
}

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical": return "#DC2626";
    case "high":     return "#EA580C";
    case "medium":   return "#EAB308";
    case "low":      return "#16A34A";
    default:         return "#6B7280";
  }
}

function severityEmoji(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical": return "🔴";
    case "high":     return "🟠";
    case "medium":   return "🟡";
    case "low":      return "🟢";
    default:         return "⚪";
  }
}

function severityBadgeClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical": return "sev-critical";
    case "high":     return "sev-high";
    case "medium":   return "sev-medium";
    case "low":      return "sev-low";
    default:         return "sev-low";
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Build an inline SVG donut showing passRate (0–100). */
function donutSvg(passRate: number, color: string): string {
  const r = 15.9;
  const circumference = 2 * Math.PI * r; // ≈ 99.9
  const filled = (passRate / 100) * circumference;
  const gap = circumference - filled;
  return `<svg viewBox="0 0 36 36" width="80" height="80" style="transform:rotate(-90deg)">
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="#E5E7EB" stroke-width="3.2"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3.2"
      stroke-dasharray="${filled.toFixed(1)} ${gap.toFixed(1)}" stroke-linecap="round"/>
  </svg>`;
}

export async function generateReport(
  reports: EvaluatorReport[],
  targetName: string,
  targetEndpoint: string,
  outputDir: string,
  judgeLabel = "unknown"
): Promise<ReportPaths> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:.T]/g, "").slice(0, 15);
  const uuid = randomUUID().slice(0, 8);
  const reportId = `astra-${uuid}-${timestamp}`;

  // --- aggregate metrics ---
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let errors = 0;

  for (const r of reports) {
    for (const t of r.results) {
      totalTests++;
      if (t.judge.verdict === "PASS") passed++;
      else if (t.judge.verdict === "ERROR") errors++;
      else failed++;
    }
  }

  // Errors excluded from safety score (target unreachable ≠ vulnerability)
  const scoreDenominator = passed + failed;
  const safetyScore = scoreDenominator > 0 ? Math.round((passed / scoreDenominator) * 100) : 0;
  const attackSuccessRate = scoreDenominator > 0 ? Math.round((failed / scoreDenominator) * 100) : 0;
  const evalsFailed = reports.filter((r) => r.results.some((t) => t.judge.verdict === "FAIL")).length;
  const evalsErrored = reports.filter((r) => r.results.some((t) => t.judge.verdict === "ERROR") && !r.results.some((t) => t.judge.verdict === "FAIL")).length;

  // --- critical/high findings ---
  const criticalFindings: Array<{ rank: number; evaluator: string; testNumber: number; score: number; description: string }> = [];
  const highFindings: typeof criticalFindings = [];

  let rank = 1;
  for (const r of reports) {
    if (r.evaluator.severity === "critical") {
      for (const t of r.results) {
        if (t.judge.verdict === "FAIL") {
          criticalFindings.push({ rank: rank++, evaluator: r.evaluator.name, testNumber: t.testNumber, score: t.judge.score, description: t.judge.reasoning });
        }
      }
    }
  }
  rank = 1;
  for (const r of reports) {
    if (r.evaluator.severity === "high") {
      for (const t of r.results) {
        if (t.judge.verdict === "FAIL") {
          highFindings.push({ rank: rank++, evaluator: r.evaluator.name, testNumber: t.testNumber, score: t.judge.score, description: t.judge.reasoning });
        }
      }
    }
  }
  criticalFindings.sort((a, b) => b.score - a.score);
  highFindings.sort((a, b) => b.score - a.score);

  // --- JSON report ---
  const jsonData = {
    metadata: {
      reportId,
      framework: "astra v0.2",
      generated: now.toISOString(),
      llmJudge: judgeLabel,
    },
    target: {
      name: targetName,
      type: "chatbot",
      targetType: "http-endpoint",
      endpoint: targetEndpoint,
      assessmentDate: now.toISOString(),
    },
    summary: {
      totalEvaluators: reports.length,
      totalTests,
      passed,
      failed,
      errors,
      safetyScore,
      attackSuccessRate,
      criticalFindings: criticalFindings.length,
      highFindings: highFindings.length,
    },
    evaluatorResults: reports.map((r) => {
      const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
      const e = r.results.filter((t) => t.judge.verdict === "ERROR").length;
      const f = r.results.length - p - e;
      const scoreable = r.results.filter((t) => t.judge.verdict !== "ERROR");
      const avgScore = scoreable.length > 0
        ? Math.round((scoreable.reduce((s, t) => s + t.judge.score, 0) / scoreable.length) * 10) / 10
        : 0;
      const passDenom = p + f;
      return {
        id: r.evaluator.id,
        name: r.evaluator.name,
        severity: r.evaluator.severity,
        totalTests: r.results.length,
        passed: p,
        failed: f,
        errors: e,
        passRate: passDenom > 0 ? Math.round((p / passDenom) * 100) : 0,
        failRate: passDenom > 0 ? Math.round((f / passDenom) * 100) : 0,
        avgScore,
        testResults: r.results.map((t) => ({
          testNumber: t.testNumber,
          pattern: t.pattern,
          verdict: t.judge.verdict,
          score: t.judge.score,
          confidence: t.judge.confidence,
          evidence: t.judge.evidence,
          reasoning: t.judge.reasoning,
          ...(t.judge.errorMessage ? { errorMessage: t.judge.errorMessage } : {}),
          ...(t.traceId ? { traceId: t.traceId } : {}),
          ...(t.turns ? {
            turns: t.turns.map(turn => ({
              turnIndex: turn.turnIndex,
              verdict: turn.judge.verdict,
              score: turn.judge.score,
              reasoning: turn.judge.reasoning,
              ...(turn.judge.errorMessage ? { errorMessage: turn.judge.errorMessage } : {}),
            })),
          } : {}),
        })),
      };
    }),
    criticalFindings,
    highFindings,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // HTML report
  // ─────────────────────────────────────────────────────────────────────────────

  const noScoreableTests = scoreDenominator === 0;
  const scoreColor = noScoreableTests ? "#6B7280" : safetyScore >= 70 ? "#16A34A" : safetyScore >= 50 ? "#EAB308" : "#DC2626";
  const scoreClass = noScoreableTests ? "color-gray" : safetyScore >= 70 ? "color-green" : safetyScore >= 50 ? "color-yellow" : "color-red";
  const scoreFillClass = noScoreableTests ? "fill-gray" : safetyScore >= 70 ? "fill-green" : safetyScore >= 50 ? "fill-yellow" : "fill-red";
  const attackClass = attackSuccessRate > 30 ? "color-red" : "color-green";
  const evalsClass = evalsFailed > 0 ? "color-red" : evalsErrored > 0 ? "color-amber" : "color-green";
  const errorsClass = errors > 0 ? "color-amber" : "color-green";

  // Assessment scope section — donut + suite stats
  const totalMultiTurn = reports.reduce((n, r) => n + r.results.filter(t => t.turns && t.turns.length > 0).length, 0);
  const scopeDesc = reports.map(r => `${r.evaluator.name.toLowerCase()} (${r.evaluator.owasp})`).join(" · ")
    + (totalMultiTurn > 0 ? ` · ${totalMultiTurn} multi-turn` : "");

  const scopeSection = `
  <section>
    <h2>Assessment Scope</h2>
    <div class="suite-box">
      <div class="pie-wrap">
        ${donutSvg(safetyScore, scoreColor)}
        <div class="pie-label" style="color:${scoreColor}">${safetyScore}%</div>
      </div>
      <div style="flex:1;min-width:160px">
        <div class="suite-name">${esc(targetName)}</div>
        <div class="suite-desc">${esc(scopeDesc)}</div>
      </div>
      <div class="suite-stats">
        <div class="suite-stat">
          <div class="suite-stat-num">${reports.length}</div>
          <div class="suite-stat-label">Evaluators</div>
        </div>
        <div class="suite-stat">
          <div class="suite-stat-num color-green">${passed}</div>
          <div class="suite-stat-label">Passed</div>
        </div>
        <div class="suite-stat">
          <div class="suite-stat-num color-red">${failed}</div>
          <div class="suite-stat-label">Failed</div>
        </div>
        ${errors > 0 ? `
        <div class="suite-stat">
          <div class="suite-stat-num color-amber">${errors}</div>
          <div class="suite-stat-label">Errors</div>
        </div>` : ""}
      </div>
    </div>
  </section>`;

  // Evaluator results table
  const anyErrors = reports.some(r => r.results.some(t => t.judge.verdict === "ERROR"));
  const evaluatorRows = reports.map((r) => {
    const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
    const e = r.results.filter((t) => t.judge.verdict === "ERROR").length;
    const f = r.results.length - p - e;
    const passDenom = p + f;
    const passRate = passDenom > 0 ? Math.round((p / passDenom) * 100) : 0;
    const scoreable = r.results.filter((t) => t.judge.verdict !== "ERROR");
    const avgScore = scoreable.length > 0
      ? (scoreable.reduce((s, t) => s + t.judge.score, 0) / scoreable.length).toFixed(1)
      : "—";
    const emoji = severityEmoji(r.evaluator.severity);
    const badgeClass = severityBadgeClass(r.evaluator.severity);
    return `
        <tr>
          <td><strong>${emoji} ${esc(r.evaluator.name)}</strong><br><span style="font-size:11px;color:#6B7280">${esc(r.evaluator.owasp ?? "")}</span></td>
          <td><span class="sev-badge ${badgeClass}">${esc(r.evaluator.severity)}</span></td>
          <td>${r.results.length}</td>
          <td style="color:#16A34A;font-weight:700">${p}</td>
          <td style="color:#DC2626;font-weight:700">${f}</td>
          ${anyErrors ? `<td style="color:#D97706;font-weight:700">${e > 0 ? e : "—"}</td>` : ""}
          <td>${passDenom > 0 ? `${passRate}%` : "—"}</td>
          <td>${avgScore !== "—" ? `${avgScore} / 10` : "—"}</td>
        </tr>`;
  }).join("\n");

  // Findings section
  const findingCard = (f: typeof criticalFindings[0], color: string) => `
      <div class="finding-card" style="border-left-color:${color}">
        <div class="finding-header">
          <span class="finding-rank">#${f.rank}</span>
          <strong>${esc(f.evaluator)}</strong>
          <span style="color:#6B7280;font-size:12px">Test #${f.testNumber}</span>
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
      out += criticalFindings.map(f => findingCard(f, "#DC2626")).join("");
    }
    if (highFindings.length > 0) {
      out += `<h3 style="color:#EA580C;margin:${criticalFindings.length > 0 ? "24px" : "0"} 0 12px">High (${highFindings.length})</h3>`;
      out += highFindings.map(f => findingCard(f, "#EA580C")).join("");
    }
    return out;
  })();

  // Appendix — one <details> per evaluator, test cases inside
  const appendix = reports.map((r) => {
    const color = severityColor(r.evaluator.severity);
    const p = r.results.filter(t => t.judge.verdict === "PASS").length;
    const e = r.results.filter(t => t.judge.verdict === "ERROR").length;
    const f = r.results.length - p - e;

    const verdictBorderColor = (verdict: string) =>
      verdict === "PASS" ? "#10B981" : verdict === "ERROR" ? "#F59E0B" : "#EF4444";
    const verdictTcClass = (verdict: string) =>
      verdict === "PASS" ? "pass" : verdict === "ERROR" ? "error" : "fail";

    const testCases = r.results.map((t) => {
      const verdict = t.judge.verdict;
      const tcClass = verdictTcClass(verdict);
      const isMultiTurn = t.turns && t.turns.length > 0;

      let bodyHtml: string;
      if (isMultiTurn) {
        const turnsHtml = t.turns!.map((turn) => {
          const tv = turn.judge.verdict;
          const tColor = verdictBorderColor(tv);
          const turnBody = tv === "ERROR"
            ? `<div class="tc-turn">
                  <div class="tc-turn-label">Prompt</div>
                  <div class="tc-turn-text">${esc(turn.prompt)}</div>
                </div>
                <div style="margin-top:6px;padding:8px 10px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;font-size:12px;color:#92400E">
                  <strong>Target Error:</strong> ${esc(turn.judge.errorMessage ?? turn.response)}
                </div>`
            : `<div class="tc-turn">
                  <div class="tc-turn-label">Prompt</div>
                  <div class="tc-turn-text">${esc(turn.prompt)}</div>
                </div>
                <div class="tc-turn">
                  <div class="tc-turn-label">Response</div>
                  <div class="tc-turn-text">${esc(turn.response)}</div>
                </div>
                <div style="font-size:12px;color:#6B7280;margin-top:6px;padding:0 2px">${esc(turn.judge.reasoning)}</div>`;
          return `
              <div class="tc-item ${verdictTcClass(tv)}" style="margin-bottom:10px">
                <div class="tc-title">Turn ${turn.turnIndex} <span style="font-weight:400;color:${tColor}">${tv}</span>${tv !== "ERROR" ? ` · Score ${turn.judge.score}/10` : ""}</div>
                ${turnBody}
              </div>`;
        }).join("");
        bodyHtml = `
            <details style="margin-bottom:10px">
              <summary style="font-size:13px">Turn-by-turn breakdown (${t.turns!.length} turns)</summary>
              <div style="margin-top:10px">${turnsHtml}</div>
            </details>`;
      } else if (verdict === "ERROR") {
        bodyHtml = `
            <div class="tc-turn">
              <div class="tc-turn-label">Prompt</div>
              <div class="tc-turn-text">${esc(t.prompt)}</div>
            </div>
            <div style="margin-top:8px;padding:10px 12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;font-size:13px;color:#92400E">
              <strong>Target Error:</strong> ${esc(t.judge.errorMessage ?? t.response)}
            </div>`;
      } else {
        bodyHtml = `
            <div class="tc-turn">
              <div class="tc-turn-label">Prompt</div>
              <div class="tc-turn-text">${esc(t.prompt)}</div>
            </div>
            <div class="tc-turn">
              <div class="tc-turn-label">Response</div>
              <div class="tc-turn-text">${esc(t.response)}</div>
            </div>`;
      }

      const judgeBlock = verdict === "ERROR"
        ? ""
        : (() => {
            const judgeClass = verdict === "PASS" ? "" : "fail";
            const judgeStrong = verdict === "PASS" ? "#065F46" : "#991B1B";
            const judgeBg = verdict === "PASS" ? "#F0FDF4" : "#FEF2F2";
            const judgeBorder = verdict === "PASS" ? "#BBF7D0" : "#FECACA";
            return `
            <div class="tc-judge ${judgeClass}" style="background:${judgeBg};border-color:${judgeBorder}">
              <strong style="color:${judgeStrong}">${verdict}</strong>
              &nbsp;·&nbsp;Score ${t.judge.score}/10
              &nbsp;·&nbsp;Confidence ${t.judge.confidence}%
              ${t.judge.evidence && t.judge.evidence !== "N/A" ? `&nbsp;·&nbsp;Evidence: <em>${esc(t.judge.evidence)}</em>` : ""}
              <br><span style="color:#374151">${esc(t.judge.reasoning)}</span>
            </div>`;
          })();

      return `
          <div class="tc-item ${tcClass}">
            <div class="tc-title">
              Test ${t.testNumber}: ${esc(t.pattern)}
              ${isMultiTurn ? `<span style="font-size:11px;font-weight:400;color:#6B7280"> · multi-turn, ${t.turns!.length} turns</span>` : ""}
            </div>
            ${t.traceId ? `<div class="tc-meta">Trace: <code>${esc(t.traceId)}</code></div>` : ""}
            ${bodyHtml}
            ${judgeBlock}
          </div>`;
    }).join("");

    const summaryLabel = `<span style="color:${color}">${esc(r.evaluator.name)}</span>`
      + ` <span style="font-weight:400;font-size:12px;color:#6B7280"> · ${esc(r.evaluator.owasp ?? "")} · ${esc(r.evaluator.severity)} · ${p}/${r.results.length - e} passed${e > 0 ? ` · ${e} error${e !== 1 ? "s" : ""}` : ""}</span>`;

    return `
      <details>
        <summary>${summaryLabel}</summary>
        <div class="tc-block">${testCases}</div>
      </details>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Astra Report — ${esc(targetName)}</title>
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
    .color-green { color: #16A34A; } .fill-green { background: #16A34A; }
    .color-yellow { color: #EAB308; } .fill-yellow { background: #EAB308; }
    .color-red { color: #DC2626; } .fill-red { background: #DC2626; }
    .color-amber { color: #D97706; } .fill-amber { background: #D97706; }
    .color-gray { color: #6B7280; } .fill-gray { background: #6B7280; }
    .color-emerald { color: #10B981; }

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
    .sev-high { background: #FFEDD5; color: #EA580C; }
    .sev-medium { background: #FEF9C3; color: #A16207; }
    .sev-low { background: #DCFCE7; color: #16A34A; }

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
    .tc-item.pass { border-color: #10B981; }
    .tc-item.fail { border-color: #EF4444; }
    .tc-item.error { border-color: #F59E0B; background: #FFFBEB; }
    .tc-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #1E293B; }
    .tc-meta { font-size: 12px; color: #6B7280; margin-bottom: 8px; }
    .tc-turn { margin-bottom: 8px; }
    .tc-turn-label { font-size: 11px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
    .tc-turn-text { font-size: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; }
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
  <h1>Astra Red Team Report — ${esc(targetName)}</h1>
  <div class="header-meta">
    <span><strong>Report ID:</strong> ${reportId}</span>
    <span><strong>Date:</strong> ${now.toLocaleString()}</span>
    <span><strong>Target:</strong> ${esc(targetEndpoint)}</span>
    <span><strong>Judge:</strong> ${esc(judgeLabel)}</span>
    <span><strong>Results:</strong> ${passed}/${totalTests} passed</span>
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
        <div class="card-value ${scoreClass}">${noScoreableTests ? "N/A" : `${safetyScore}%`}</div>
        ${noScoreableTests ? "" : `<div class="bar"><div class="bar-fill ${scoreFillClass}" style="width:${safetyScore}%"></div></div>`}
        <div class="card-sub">${noScoreableTests ? "No scoreable tests" : `${passed} of ${scoreDenominator} tests passed`}${errors > 0 ? ` · ${errors} error${errors !== 1 ? "s" : ""} excluded` : ""}</div>
      </div>
      <div class="card">
        <div class="card-label">Evaluations Failed</div>
        <div class="card-value ${evalsClass}">${evalsFailed}</div>
        <div class="card-sub">of ${reports.length} evaluator${reports.length !== 1 ? "s" : ""} run</div>
      </div>
      <div class="card">
        <div class="card-label">Attack Success Rate</div>
        <div class="card-value ${attackClass}">${noScoreableTests ? "N/A" : `${attackSuccessRate}%`}</div>
        ${noScoreableTests ? "" : `<div class="bar"><div class="bar-fill ${attackSuccessRate > 30 ? "fill-red" : "fill-green"}" style="width:${attackSuccessRate}%"></div></div>`}
        <div class="card-sub">${failed} attack${failed !== 1 ? "s" : ""} succeeded</div>
      </div>
      <div class="card">
        <div class="card-label">Errors</div>
        <div class="card-value ${errorsClass}">${errors}</div>
        <div class="card-sub">${errors > 0 ? "target unreachable or rate-limited" : "no target errors"}</div>
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
    <h2>Appendix — Full Test Cases and Responses</h2>
    ${appendix}
  </section>

</div>

<footer style="text-align:center;color:#9CA3AF;font-size:12px;padding:24px 0;border-top:1px solid #E2E8F0;margin-top:8px">
  Generated by Astra v0.2 &nbsp;·&nbsp; ${reportId} &nbsp;·&nbsp; ${now.toISOString()} &nbsp;·&nbsp; Judge: ${esc(judgeLabel)}
</footer>

</body>
</html>`;

  // --- write files ---
  const reportDir = path.join(outputDir, `report-${reportId}`);
  await mkdir(reportDir, { recursive: true });

  const htmlPath = path.join(reportDir, `report.html`);
  const jsonPath = path.join(reportDir, `report.json`);

  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}
