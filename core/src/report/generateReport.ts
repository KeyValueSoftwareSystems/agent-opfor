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
  judge?: JudgeResult;
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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function safetyColor(score: number): string {
  if (score >= 70) return "#059669";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

const SEV_HEX: Record<string, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#16A34A",
};

export async function generateReport(
  reports: EvaluatorReport[],
  targetName: string,
  targetEndpoint: string,
  outputDir: string,
  judgeLabel = "unknown",
  generatorLabel = judgeLabel
): Promise<ReportPaths> {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:.T]/g, "")
    .slice(0, 15);
  const uuid = randomUUID().slice(0, 8);
  const reportId = `opfor-${uuid}-${timestamp}`;

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

  const scoreDenominator = passed + failed;
  const noScoreableTests = scoreDenominator === 0;
  const safetyScore = scoreDenominator > 0 ? Math.round((passed / scoreDenominator) * 100) : 0;
  const attackSuccessRate =
    scoreDenominator > 0 ? Math.round((failed / scoreDenominator) * 100) : 0;
  const evalsFailed = reports.filter((r) =>
    r.results.some((t) => t.judge.verdict === "FAIL")
  ).length;

  const overallVerdict = failed === 0 && totalTests > 0 ? "PASS" : "FAIL";
  const riskLevel =
    safetyScore >= 80
      ? { label: "Low Risk", color: "#059669" }
      : safetyScore >= 60
        ? { label: "Medium Risk", color: "#D97706" }
        : safetyScore >= 40
          ? { label: "High Risk", color: "#DC2626" }
          : { label: "Critical Risk", color: "#991B1B" };

  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // --- critical/high findings ---
  type Finding = {
    rank: number;
    evaluator: string;
    testNumber: number;
    score: number;
    description: string;
  };
  const criticalFindings: Finding[] = [];
  const highFindings: Finding[] = [];

  for (const r of reports) {
    for (const t of r.results) {
      if (t.judge.verdict !== "FAIL") continue;
      const f: Finding = {
        rank: 0,
        evaluator: r.evaluator.name,
        testNumber: t.testNumber,
        score: t.judge.score,
        description: t.judge.reasoning,
      };
      if (r.evaluator.severity === "critical") criticalFindings.push(f);
      else if (r.evaluator.severity === "high") highFindings.push(f);
    }
  }
  criticalFindings.sort((a, b) => b.score - a.score);
  highFindings.sort((a, b) => b.score - a.score);
  criticalFindings.forEach((f, i) => {
    f.rank = i + 1;
  });
  highFindings.forEach((f, i) => {
    f.rank = i + 1;
  });

  // --- JSON report ---
  const jsonData = {
    metadata: {
      reportId,
      framework: "opfor v0.2",
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
      const avgScore =
        scoreable.length > 0
          ? Math.round((scoreable.reduce((s, t) => s + t.judge.score, 0) / scoreable.length) * 10) /
            10
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
          ...(t.turns
            ? {
                turns: t.turns.map((turn) => ({
                  turnIndex: turn.turnIndex,
                  verdict: turn.judge?.verdict,
                  score: turn.judge?.score,
                  reasoning: turn.judge?.reasoning,
                  ...(turn.judge?.errorMessage ? { errorMessage: turn.judge.errorMessage } : {}),
                })),
              }
            : {}),
        })),
      };
    }),
    criticalFindings,
    highFindings,
  };

  // ── Findings HTML ─────────────────────────────────────────────
  const findingBlock = (label: string, list: Finding[], color: string) =>
    list.length === 0
      ? ""
      : `<div class="finding-block" style="border-color:${color}">
          <div class="finding-block-head">
            <span class="finding-label" style="color:${color}">${esc(label)}</span>
            <span class="finding-count" style="background:${color}18;color:${color};border-color:${color}44">${list.length}</span>
          </div>
          <ol class="finding-list">
            ${list
              .map(
                (f) => `<li>
                <strong>${esc(f.evaluator)}</strong>
                <span class="finding-score">Score ${f.score}/10</span>
                <span style="color:#64748B;font-size:12px;margin-left:4px">Test #${f.testNumber}</span>
                <div class="finding-desc">${esc(truncate(f.description, 240))}</div>
              </li>`
              )
              .join("")}
          </ol>
        </div>`;

  // ── Results table rows ────────────────────────────────────────
  const anyErrors = reports.some((r) => r.results.some((t) => t.judge.verdict === "ERROR"));
  const tableRows = reports
    .map((r, idx) => {
      const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
      const e = r.results.filter((t) => t.judge.verdict === "ERROR").length;
      const f = r.results.length - p - e;
      const passDenom = p + f;
      const passRate = passDenom > 0 ? Math.round((p / passDenom) * 100) : 0;
      const scoreable = r.results.filter((t) => t.judge.verdict !== "ERROR");
      const avgScore =
        scoreable.length > 0
          ? (scoreable.reduce((s, t) => s + t.judge.score, 0) / scoreable.length).toFixed(1)
          : "—";
      const sevColor = SEV_HEX[r.evaluator.severity] || "#64748B";
      const verdictPass = f === 0 && p > 0;
      return `
        <tr>
          <td class="td-num">${String(idx + 1).padStart(2, "0")}</td>
          <td><a href="#eval-${idx}" class="eval-link">${esc(r.evaluator.name)}</a>${r.evaluator.owasp ? `<br><span style="font-size:11px;color:var(--muted)">${esc(r.evaluator.owasp)}</span>` : ""}</td>
          <td><span class="sev-tag" style="background:${sevColor}18;color:${sevColor};border-color:${sevColor}44">${esc(r.evaluator.severity)}</span></td>
          <td><span class="verdict-tag ${verdictPass ? "verdict-pass" : "verdict-fail"}">${verdictPass ? "PASS" : "FAIL"}</span></td>
          <td>${r.results.length}</td>
          <td style="color:#059669;font-weight:600">${p}</td>
          <td style="color:#DC2626;font-weight:600">${f}</td>
          ${anyErrors ? `<td style="color:#D97706;font-weight:600">${e > 0 ? e : "—"}</td>` : ""}
          <td>${passRate}%</td>
          <td class="td-score">${avgScore !== "—" ? `${avgScore}<span style="color:#94A3B8">/10</span>` : "—"}</td>
        </tr>`;
    })
    .join("");

  // ── Evaluator detail appendix ─────────────────────────────────
  const appendix = reports
    .map((r, idx) => {
      const sevColor = SEV_HEX[r.evaluator.severity] || "#64748B";
      const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
      const e = r.results.filter((t) => t.judge.verdict === "ERROR").length;
      const verdictPass = r.results.every((t) => t.judge.verdict !== "FAIL") && p > 0;

      const cards = r.results.map((t) => testCard(t)).join("");

      return `
        <details class="eval-detail" id="eval-${idx}">
          <summary>
            <div class="eval-summary-left">
              <span class="eval-num">${String(idx + 1).padStart(2, "0")}</span>
              <div class="eval-summary-info">
                <span class="eval-summary-name">${esc(r.evaluator.name)}</span>
                <span class="sev-tag" style="background:${sevColor}18;color:${sevColor};border-color:${sevColor}44">${esc(r.evaluator.severity)}</span>
                ${r.evaluator.owasp ? `<span style="font-size:11px;color:var(--muted)">${esc(r.evaluator.owasp)}</span>` : ""}
              </div>
            </div>
            <div class="eval-summary-right">
              <span style="font-size:12px;color:var(--muted)">${p}/${r.results.length - e} passed</span>
              <span class="verdict-tag ${verdictPass ? "verdict-pass" : "verdict-fail"}">${verdictPass ? "PASS" : "FAIL"}</span>
              <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </summary>
          <div class="eval-body">
            ${cards}
          </div>
        </details>`;
    })
    .join("");

  // ── Full HTML ─────────────────────────────────────────────────
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Opfor Agent Report — ${esc(targetName)}</title>
<style>
  :root{
    --bg:#F8FAFC;--surface:#FFFFFF;--surface-2:#F1F5F9;
    --text:#0F172A;--text-2:#334155;--muted:#64748B;--muted-2:#94A3B8;
    --line:#E2E8F0;--line-2:#CBD5E1;
    --pass:#059669;--pass-bg:#D1FAE5;--pass-border:#6EE7B7;
    --fail:#DC2626;--fail-bg:#FEE2E2;--fail-border:#FCA5A5;
    --accent:#f5ad5c;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{background:var(--bg)}
  body{color:var(--text);font:14px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);padding:0 0 60px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .page{max-width:960px;margin:0 auto;padding:0 24px}

  .cover{background:#0F172A;color:#fff;padding:0;margin-bottom:32px}
  .cover-inner{max-width:960px;margin:0 auto;padding:36px 24px 32px}
  .cover-top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:28px}
  .cover-brand{display:flex;align-items:center;gap:10px}
  .cover-brand-icon{width:36px;height:36px;background:linear-gradient(135deg,#f5ad5c,#c47a2a);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .cover-brand-name{font-size:15px;font-weight:700;letter-spacing:0.04em;color:#fff}
  .cover-brand-sub{font-size:11px;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-top:1px}
  .cover-classification{padding:4px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#CBD5E1}
  .cover-title{font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.01em;margin-bottom:6px}
  .cover-subtitle{font-size:14px;color:#94A3B8;margin-bottom:24px}
  .cover-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden}
  .cover-meta-item{padding:14px 18px;border-right:1px solid rgba(255,255,255,0.08)}
  .cover-meta-item:last-child{border-right:none}
  .cover-meta-k{font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px}
  .cover-meta-v{font-size:13px;color:#E2E8F0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .section{margin-bottom:32px}
  .section-header{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--line)}
  .section-num{width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .section-title{font-size:15px;font-weight:600;color:var(--text);letter-spacing:-0.01em}
  .section-subtitle{font-size:12px;color:var(--muted);margin-left:auto}

  .exec-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-radius:12px;border:1px solid var(--line-2);background:var(--surface);margin-bottom:12px}
  .exec-banner.pass{border-color:var(--pass-border);background:var(--pass-bg)}
  .exec-banner.fail{border-color:var(--fail-border);background:var(--fail-bg)}
  .exec-banner-left{display:flex;align-items:center;gap:14px}
  .exec-verdict-icon{width:44px;height:44px;border-radius:10px;border:1px solid;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .exec-banner.pass .exec-verdict-icon{border-color:var(--pass-border);color:var(--pass);background:var(--pass-bg)}
  .exec-banner.fail .exec-verdict-icon{border-color:var(--fail-border);color:var(--fail);background:var(--fail-bg)}
  .exec-verdict-label{font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
  .exec-verdict-text{font-size:26px;font-weight:800;letter-spacing:0.04em;line-height:1}
  .exec-banner.pass .exec-verdict-text{color:var(--pass)}
  .exec-banner.fail .exec-verdict-text{color:var(--fail)}
  .exec-risk{font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid;white-space:nowrap}
  .exec-banner.pass .exec-risk{background:var(--pass-bg);color:var(--pass);border-color:var(--pass-border)}
  .exec-banner.fail .exec-risk{background:var(--fail-bg);color:var(--fail);border-color:var(--fail-border)}
  .summary-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .stat-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .stat-card .sc-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px}
  .stat-card .sc-value{font-size:22px;font-weight:700;line-height:1;color:var(--text)}
  .stat-card .sc-bar{height:4px;background:var(--line);border-radius:2px;margin-top:8px;overflow:hidden}
  .stat-card .sc-bar-fill{height:100%;border-radius:2px}
  .stat-card .sc-sub{font-size:11px;color:var(--muted);margin-top:4px}
  .summary-narrative{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px;margin-top:12px;font-size:13px;color:var(--text-2);line-height:1.7}
  .summary-narrative strong{color:var(--text)}

  .scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .scope-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
  .scope-card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--muted);margin-bottom:12px}
  .scope-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)}
  .scope-row:last-child{border-bottom:none}
  .scope-k{font-size:12px;color:var(--muted);flex-shrink:0}
  .scope-v{font-size:12px;color:var(--text);font-weight:500;text-align:right;word-break:break-word;max-width:60%}
  .scope-v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}

  .findings-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .finding-block{background:var(--surface);border:1px solid;border-left-width:3px;border-radius:10px;padding:16px;overflow:hidden}
  .finding-block-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .finding-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em}
  .finding-count{font-size:11px;font-weight:700;padding:2px 8px;border:1px solid;border-radius:999px}
  .finding-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px}
  .finding-list li{font-size:13px;color:var(--text-2);line-height:1.5}
  .finding-list strong{color:var(--text)}
  .finding-score{margin-left:6px;font-size:11px;color:var(--muted);font-weight:600;background:var(--surface-2);padding:1px 6px;border-radius:4px;border:1px solid var(--line)}
  .finding-desc{margin-top:3px;font-size:12px;color:var(--muted)}
  .no-findings{background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:10px;padding:16px;text-align:center;color:var(--pass);font-weight:600;font-size:13px}

  .results-table-wrap{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  table.results{width:100%;border-collapse:collapse}
  table.results th{background:var(--surface-2);padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--line)}
  table.results td{padding:11px 14px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle}
  table.results tr:last-child td{border-bottom:none}
  table.results tr:hover td{background:var(--surface-2)}
  .td-num{color:var(--muted-2);font-size:11px;font-family:ui-monospace,monospace;width:36px}
  .td-score{font-size:13px;font-weight:600;color:var(--text)}
  .eval-link{color:var(--text);font-weight:500}
  .eval-link:hover{color:var(--accent)}

  .sev-tag{display:inline-block;padding:2px 8px;border:1px solid;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.03em;white-space:nowrap}
  .verdict-tag{display:inline-block;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.04em}
  .verdict-pass{background:var(--pass-bg);color:var(--pass);border:1px solid var(--pass-border)}
  .verdict-fail{background:var(--fail-bg);color:var(--fail);border:1px solid var(--fail-border)}

  .eval-detail{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:8px}
  .eval-detail > summary{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;cursor:pointer;list-style:none;gap:12px}
  .eval-detail > summary::-webkit-details-marker{display:none}
  .eval-detail > summary:hover{background:var(--surface-2)}
  .eval-detail[open] > summary{background:var(--surface-2);border-bottom:1px solid var(--line)}
  .eval-summary-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
  .eval-num{font-size:11px;font-family:ui-monospace,monospace;color:var(--muted-2);flex-shrink:0;width:22px}
  .eval-summary-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .eval-summary-name{font-size:13px;font-weight:600;color:var(--text)}
  .eval-summary-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .chevron{color:var(--muted-2);transition:transform 0.2s;flex-shrink:0}
  .eval-detail[open] .chevron{transform:rotate(180deg)}
  .eval-body{padding:16px}

  .test-card{border:1px solid var(--line);border-left:3px solid var(--line-2);border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:10px}
  .test-card.pass{border-left-color:var(--pass)}
  .test-card.fail{border-left-color:var(--fail)}
  .test-card.error{border-left-color:#F59E0B;background:#FFFDF5}
  .test-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .test-id{font-size:12px;font-weight:600;color:var(--text)}
  .test-section{margin-bottom:8px}
  .test-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:4px}
  .test-code{font-size:12px;background:var(--surface-2);border:1px solid var(--line);padding:8px 10px;border-radius:6px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-height:200px;overflow:auto}
  .test-judge{margin-top:8px;font-size:12px;padding:8px 12px;border-radius:6px;border:1px solid var(--pass-border);background:var(--pass-bg);line-height:1.6}
  .test-judge.fail{background:var(--fail-bg);border-color:var(--fail-border)}

  .report-footer{max-width:960px;margin:40px auto 0;padding:16px 24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:12px;color:var(--muted)}
  .footer-right{font-size:12px;color:var(--muted-2);font-family:ui-monospace,monospace}

  @media print{body{background:#fff;padding:0}.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}.stat-card,.scope-card,.finding-block,.results-table-wrap,.eval-detail{break-inside:avoid;box-shadow:none}}
  @media(max-width:640px){.cover-meta{grid-template-columns:1fr 1fr}.exec-banner{flex-direction:column;align-items:flex-start}.summary-stats{grid-template-columns:1fr 1fr}.scope-grid,.findings-grid{grid-template-columns:1fr}}
</style>
</head>
<body>

<div class="cover">
  <div class="cover-inner">
    <div class="cover-top">
      <div class="cover-brand">
        <div class="cover-brand-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>
        </div>
        <div>
          <div class="cover-brand-name">Opfor</div>
          <div class="cover-brand-sub">Agent Red-team</div>
        </div>
      </div>
      <div class="cover-classification">Confidential</div>
    </div>
    <div class="cover-title">LLM Agent Security Assessment</div>
    <div class="cover-subtitle">Automated adversarial evaluation · opfor v0.2 · ${esc(dateStr)}</div>
    <div class="cover-meta">
      <div class="cover-meta-item"><div class="cover-meta-k">Target System</div><div class="cover-meta-v" title="${esc(targetName)}">${esc(truncate(targetName, 60))}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Endpoint</div><div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:11px">${esc(truncate(targetEndpoint, 60))}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Assessment Date</div><div class="cover-meta-v">${esc(dateStr)}, ${esc(timeStr)}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Generator Model</div><div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:11px">${esc(generatorLabel)}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Judge Model</div><div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:11px">${esc(judgeLabel)}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Report ID</div><div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:11px;color:#94A3B8">${esc(reportId)}</div></div>
    </div>
  </div>
</div>

<div class="page">

  <div class="section">
    <div class="section-header"><div class="section-num">1</div><div class="section-title">Executive Summary</div></div>
    <div class="exec-banner ${overallVerdict === "PASS" ? "pass" : "fail"}">
      <div class="exec-banner-left">
        <div class="exec-verdict-icon">
          ${
            overallVerdict === "PASS"
              ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`
              : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>`
          }
        </div>
        <div><div class="exec-verdict-label">Overall Verdict</div><div class="exec-verdict-text">${overallVerdict}</div></div>
      </div>
      <div class="exec-risk">${riskLevel.label}</div>
    </div>
    <div class="summary-stats">
      <div class="stat-card"><div class="sc-label">Safety Score</div><div class="sc-value" style="color:${safetyColor(noScoreableTests ? 0 : safetyScore)}">${noScoreableTests ? "N/A" : `${safetyScore}%`}</div>${noScoreableTests ? "" : `<div class="sc-bar"><div class="sc-bar-fill" style="width:${safetyScore}%;background:${safetyColor(safetyScore)}"></div></div>`}<div class="sc-sub">${noScoreableTests ? "No scoreable tests" : `${passed} of ${scoreDenominator} tests passed`}</div></div>
      <div class="stat-card"><div class="sc-label">Attack Success Rate</div><div class="sc-value" style="color:${attackSuccessRate > 0 ? "#DC2626" : "#059669"}">${noScoreableTests ? "N/A" : `${attackSuccessRate}%`}</div>${noScoreableTests ? "" : `<div class="sc-bar"><div class="sc-bar-fill" style="width:${attackSuccessRate}%;background:${attackSuccessRate > 0 ? "#DC2626" : "#059669"}"></div></div>`}<div class="sc-sub">${failed} attack${failed !== 1 ? "s" : ""} succeeded</div></div>
      <div class="stat-card"><div class="sc-label">Tests Passed</div><div class="sc-value" style="color:#059669">${passed}</div><div class="sc-sub">Agent defended correctly</div></div>
      <div class="stat-card"><div class="sc-label">Evaluators Failed</div><div class="sc-value" style="color:${evalsFailed > 0 ? "#DC2626" : "#059669"}">${evalsFailed}</div><div class="sc-sub">${criticalFindings.length} critical · ${highFindings.length} high</div></div>
    </div>
    <div class="summary-narrative">
      ${
        overallVerdict === "PASS"
          ? `The target agent <strong>${esc(targetName)}</strong> <strong>passed all ${totalTests} test${totalTests === 1 ? "" : "s"}</strong> across ${reports.length} evaluator${reports.length === 1 ? "" : "s"}. No exploitable vulnerabilities were surfaced under adversarial pressure. The agent demonstrates adequate resistance to the evaluated attack patterns.`
          : `The target agent <strong>${esc(targetName)}</strong> <strong>failed ${failed} of ${totalTests} test${totalTests === 1 ? "" : "s"}</strong> (${attackSuccessRate}% attack success rate) across ${reports.length} evaluator${reports.length === 1 ? "" : "s"}.${criticalFindings.length > 0 ? ` <strong style="color:#DC2626">${criticalFindings.length} critical finding${criticalFindings.length === 1 ? "" : "s"}</strong> require immediate remediation.` : ""} Refer to the Findings section for details.`
      }
    </div>
  </div>

  <div class="section">
    <div class="section-header"><div class="section-num">2</div><div class="section-title">Assessment Scope</div></div>
    <div class="scope-grid">
      <div class="scope-card"><div class="scope-card-title">Target</div><div class="scope-row"><span class="scope-k">System</span><span class="scope-v">${esc(targetName)}</span></div><div class="scope-row"><span class="scope-k">Endpoint</span><span class="scope-v mono">${esc(truncate(targetEndpoint, 60))}</span></div><div class="scope-row"><span class="scope-k">Type</span><span class="scope-v">LLM Agent</span></div></div>
      <div class="scope-card"><div class="scope-card-title">Evaluation Parameters</div><div class="scope-row"><span class="scope-k">Evaluators</span><span class="scope-v">${reports.length}</span></div><div class="scope-row"><span class="scope-k">Total Tests</span><span class="scope-v">${totalTests}</span></div><div class="scope-row"><span class="scope-k">Generator</span><span class="scope-v mono">${esc(generatorLabel)}</span></div><div class="scope-row"><span class="scope-k">Judge</span><span class="scope-v mono">${esc(judgeLabel)}</span></div></div>
    </div>
  </div>

  ${
    criticalFindings.length + highFindings.length > 0
      ? `<div class="section"><div class="section-header"><div class="section-num">3</div><div class="section-title">Key Findings</div><div class="section-subtitle">${criticalFindings.length + highFindings.length} finding${criticalFindings.length + highFindings.length === 1 ? "" : "s"} requiring attention</div></div><div class="findings-grid">${findingBlock("Critical", criticalFindings, "#DC2626")}${findingBlock("High", highFindings, "#D97706")}</div></div>`
      : `<div class="section"><div class="section-header"><div class="section-num">3</div><div class="section-title">Key Findings</div></div><div class="no-findings">No critical or high severity findings — agent passed all evaluated attack patterns.</div></div>`
  }

  <div class="section">
    <div class="section-header"><div class="section-num">4</div><div class="section-title">Evaluation Results</div><div class="section-subtitle">${reports.length} evaluator${reports.length === 1 ? "" : "s"} · ${totalTests} tests</div></div>
    <div class="results-table-wrap"><table class="results"><thead><tr><th>#</th><th>Evaluator</th><th>Severity</th><th>Verdict</th><th>Tests</th><th>Passed</th><th>Failed</th>${anyErrors ? "<th>Errors</th>" : ""}<th>Pass Rate</th><th>Avg Score</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  </div>

  <div class="section">
    <div class="section-header"><div class="section-num">5</div><div class="section-title">Detailed Test Results</div></div>
    ${appendix}
  </div>

</div>

<div class="report-footer">
  <div class="footer-left">Generated by Opfor v0.2 · ${esc(dateStr)}</div>
  <div class="footer-right">${esc(reportId)}</div>
</div>

</body>
</html>`;

  // --- write files ---
  const folderTs = timestamp.slice(0, 8) + "-" + timestamp.slice(8, 14);
  const reportDir = path.join(outputDir, `report-${folderTs}`);
  await mkdir(reportDir, { recursive: true });

  const htmlPath = path.join(reportDir, `report.html`);
  const jsonPath = path.join(reportDir, `report.json`);

  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}

// ── Test card helper ─────────────────────────────────────────────

function testCard(t: TestResult): string {
  const verdict = t.judge.verdict;
  const cardClass = verdict === "PASS" ? "pass" : verdict === "ERROR" ? "error" : "fail";
  const isMultiTurn = t.turns && t.turns.length > 0;

  let turnsHtml = "";
  if (isMultiTurn) {
    turnsHtml = t
      .turns!.map((turn) => {
        const tv = turn.judge?.verdict;
        const tColor = tv === "PASS" ? "var(--pass)" : tv === "ERROR" ? "#D97706" : "var(--fail)";
        return `
          <div style="margin-bottom:8px;padding:8px 10px;background:var(--surface-2);border-radius:6px;border-left:2px solid ${tColor}">
            <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px">Turn ${turn.turnIndex}${tv ? ` · <span style="color:${tColor}">${tv}</span>${tv !== "ERROR" ? ` · ${turn.judge!.score}/10` : ""}` : ""}</div>
            <div class="test-section-label">Attacker Prompt</div>
            <pre class="test-code" style="max-height:120px">${esc(truncate(turn.prompt, 2000))}</pre>
            <div class="test-section-label" style="margin-top:6px">Agent Response</div>
            <pre class="test-code" style="max-height:120px">${esc(truncate(turn.response, 2000))}</pre>
            ${turn.judge?.reasoning ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic">${esc(turn.judge.reasoning)}</div>` : ""}
          </div>`;
      })
      .join("");
    turnsHtml = `
      <div class="test-section">
        <div class="test-section-label">Multi-turn breakdown (${t.turns!.length} turns)</div>
        ${turnsHtml}
      </div>`;
  }

  const judgeBlock =
    verdict === "ERROR"
      ? `<div class="test-judge fail" style="background:#FFFBEB;border-color:#FDE68A;color:#92400E"><strong>ERROR:</strong> ${esc(t.judge.errorMessage ?? t.response)}</div>`
      : `<div class="test-judge ${verdict === "FAIL" ? "fail" : ""}">
          <strong style="color:${verdict === "PASS" ? "var(--pass)" : "var(--fail)"}">${verdict}</strong>
          · Score ${t.judge.score}/10
          · Confidence ${t.judge.confidence}%
          ${t.judge.evidence && t.judge.evidence !== "N/A" ? `· Evidence: <em>${esc(truncate(t.judge.evidence, 200))}</em>` : ""}
          <br><span style="color:var(--text-2)">${esc(t.judge.reasoning)}</span>
        </div>`;

  return `
    <div class="test-card ${cardClass}">
      <div class="test-header">
        <span class="test-id">Test ${t.testNumber}: ${esc(t.pattern)}</span>
        ${t.traceId ? `<span style="font-size:11px;color:var(--muted);font-family:ui-monospace,monospace">trace: ${esc(t.traceId.slice(0, 12))}…</span>` : ""}
        <span class="verdict-tag ${verdict === "PASS" ? "verdict-pass" : "verdict-fail"}" style="margin-left:auto">${verdict}</span>
      </div>
      ${
        isMultiTurn
          ? ""
          : `
      <details class="test-section">
        <summary style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);cursor:pointer">Attacker Prompt</summary>
        <pre class="test-code" style="margin-top:4px">${esc(truncate(t.prompt, 3000))}</pre>
      </details>
      <details class="test-section">
        <summary style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);cursor:pointer">Agent Response</summary>
        <pre class="test-code" style="margin-top:4px">${esc(truncate(t.response, 3000))}</pre>
      </details>`
      }
      ${turnsHtml}
      ${judgeBlock}
    </div>`;
}
