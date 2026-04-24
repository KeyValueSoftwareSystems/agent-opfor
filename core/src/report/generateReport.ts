import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EvaluatorSpec } from "../evaluators/parseEvaluator.js";
import type { JudgeResult } from "../evaluators/judge.js";

export interface TestResult {
  testNumber: number;
  pattern: string;
  prompt: string;
  response: string;
  judge: JudgeResult;
  /** Propagated OTEL/Langfuse trace id (32 hex) when telemetry propagation was used for this attack. */
  traceId?: string;
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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function generateReport(
  reports: EvaluatorReport[],
  targetName: string,
  targetEndpoint: string,
  outputDir: string,
  judgeLabel = "unknown"
): Promise<ReportPaths> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const uuid = randomUUID().slice(0, 8);
  const reportId = `astra-${uuid}-${timestamp}`;

  // --- aggregate metrics ---
  let totalTests = 0;
  let passed = 0;
  let failed = 0;

  for (const r of reports) {
    for (const t of r.results) {
      totalTests++;
      if (t.judge.verdict === "PASS") passed++;
      else failed++;
    }
  }

  const safetyScore = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;
  const attackSuccessRate = totalTests > 0 ? Math.round((failed / totalTests) * 100) : 0;
  const evalsFailed = reports.filter((r) => r.results.some((t) => t.judge.verdict === "FAIL")).length;

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
      safetyScore,
      attackSuccessRate,
      criticalFindings: criticalFindings.length,
      highFindings: highFindings.length,
    },
    evaluatorResults: reports.map((r) => {
      const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
      const f = r.results.length - p;
      const avgScore = r.results.length > 0
        ? Math.round((r.results.reduce((s, t) => s + t.judge.score, 0) / r.results.length) * 10) / 10
        : 0;
      return {
        id: r.evaluator.id,
        name: r.evaluator.name,
        severity: r.evaluator.severity,
        totalTests: r.results.length,
        passed: p,
        failed: f,
        passRate: r.results.length > 0 ? Math.round((p / r.results.length) * 100) : 0,
        failRate: r.results.length > 0 ? Math.round((f / r.results.length) * 100) : 0,
        avgScore,
        testResults: r.results.map((t) => ({
          testNumber: t.testNumber,
          pattern: t.pattern,
          verdict: t.judge.verdict,
          score: t.judge.score,
          confidence: t.judge.confidence,
          evidence: t.judge.evidence,
          reasoning: t.judge.reasoning,
          ...(t.traceId ? { traceId: t.traceId } : {}),
        })),
      };
    }),
    criticalFindings,
    highFindings,
  };

  // --- HTML report ---
  const scoreColor = safetyScore >= 70 ? "#10B981" : safetyScore >= 50 ? "#EAB308" : "#EF4444";

  const evaluatorRows = reports.map((r) => {
    const p = r.results.filter((t) => t.judge.verdict === "PASS").length;
    const f = r.results.length - p;
    const passRate = r.results.length > 0 ? Math.round((p / r.results.length) * 100) : 0;
    const avgScore = r.results.length > 0
      ? (r.results.reduce((s, t) => s + t.judge.score, 0) / r.results.length).toFixed(1)
      : "0.0";
    const color = severityColor(r.evaluator.severity);
    const emoji = severityEmoji(r.evaluator.severity);
    return `
      <tr>
        <td><span style="color:${color}">${emoji}</span> ${esc(r.evaluator.name)}</td>
        <td>${r.results.length}</td>
        <td style="color:#10B981;font-weight:600">${p}</td>
        <td style="color:#EF4444;font-weight:600">${f}</td>
        <td>${passRate}%</td>
        <td>${avgScore}/10</td>
      </tr>`;
  }).join("\n");

  const findingsSection = (title: string, color: string, items: typeof criticalFindings) => {
    if (items.length === 0) return `<p style="color:#6B7280">No ${title.toLowerCase()} findings.</p>`;
    return `<h3 style="color:${color}">${title} (${items.length} total)</h3><ol>` +
      items.map((f) =>
        `<li><strong>${esc(f.evaluator)}</strong> — Test #${f.testNumber} — Score ${f.score}/10 — ${esc(f.description)}</li>`
      ).join("") + "</ol>";
  };

  const appendix = reports.map((r) => {
    const color = severityColor(r.evaluator.severity);
    const emoji = severityEmoji(r.evaluator.severity);
    const cases = r.results.map((t) => {
      const verdictColor = t.judge.verdict === "PASS" ? "#10B981" : "#EF4444";
      return `
        <div style="margin:12px 0;padding:12px;background:#F9FAFB;border-radius:6px;border-left:3px solid ${verdictColor}">
          <div style="font-weight:600;margin-bottom:6px">Test ${t.testNumber}: ${esc(t.pattern)}</div>
          ${t.traceId ? `<div style="margin-bottom:4px;font-size:12px"><span style="color:#6B7280">Trace id:</span> <code>${esc(t.traceId)}</code></div>` : ""}
          <div style="margin-bottom:4px"><span style="color:#6B7280">Prompt:</span> <code style="font-size:12px">${esc(t.prompt.slice(0, 200))}${t.prompt.length > 200 ? "..." : ""}</code></div>
          <div style="margin-bottom:4px"><span style="color:#6B7280">Response:</span> <code style="font-size:12px">${esc(t.response.slice(0, 200))}${t.response.length > 200 ? "..." : ""}</code></div>
          <div><span style="color:#6B7280">Judge:</span> <strong style="color:${verdictColor}">${t.judge.verdict}</strong> · Score ${t.judge.score}/10 · Confidence ${t.judge.confidence}% · Evidence: ${esc(t.judge.evidence)}</div>
          <div style="color:#6B7280;font-size:13px;margin-top:4px">${esc(t.judge.reasoning)}</div>
        </div>`;
    }).join("");
    return `
      <div style="margin-bottom:24px">
        <h4 style="color:${color}">${emoji} ${esc(r.evaluator.name)} <span style="font-size:12px;font-weight:400">(${r.evaluator.owasp} · ${r.evaluator.severity})</span></h4>
        ${cases}
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Astra Report — ${esc(targetName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, system-ui, sans-serif; background: #F3F4F6; color: #111827; line-height: 1.5; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
    .header { background: #1E293B; color: #fff; padding: 24px; border-radius: 10px; margin-bottom: 24px; }
    .header h1 { font-size: 22px; margin-bottom: 6px; }
    .header p { color: #94A3B8; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .card-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .card-value { font-size: 36px; font-weight: 700; }
    .card-sub { font-size: 13px; color: #6B7280; margin-top: 4px; }
    .section { background: #fff; border-radius: 10px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .section h2 { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #1E293B; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { background: #F8FAFC; text-align: left; padding: 10px 12px; font-size: 12px; color: #6B7280; text-transform: uppercase; border-bottom: 1px solid #E5E7EB; }
    td { padding: 10px 12px; border-bottom: 1px solid #F3F4F6; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #FAFAFA; }
    details summary { cursor: pointer; font-weight: 600; font-size: 14px; color: #1E293B; padding: 8px 0; }
    ol { padding-left: 20px; }
    ol li { margin-bottom: 8px; font-size: 14px; }
    .progress-bar { height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; border-radius: 4px; }
    @media print {
      body { background: #fff; }
      .section { box-shadow: none; border: 1px solid #E5E7EB; }
    }
    @media (max-width: 640px) {
      .card-value { font-size: 28px; }
      table { font-size: 12px; }
    }
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>🛡️ Astra Report</h1>
    <p>Target: <strong style="color:#fff">${esc(targetName)}</strong> &nbsp;·&nbsp; ${esc(targetEndpoint)}</p>
    <p>Generated: ${now.toLocaleString()} &nbsp;·&nbsp; Report ID: ${reportId}</p>
    <p>Results: <strong style="color:#fff">${passed}/${totalTests} passed</strong> &nbsp;·&nbsp; Status: Completed</p>
  </div>

  <!-- Summary Cards -->
  <div class="cards">
    <div class="card">
      <div class="card-label">Safety Score</div>
      <div class="card-value" style="color:${scoreColor}">${safetyScore}%</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${safetyScore}%;background:${scoreColor}"></div></div>
      <div class="card-sub">${passed} of ${totalTests} tests passed</div>
    </div>
    <div class="card">
      <div class="card-label">Evaluations Failed</div>
      <div class="card-value" style="color:${evalsFailed > 0 ? '#EF4444' : '#10B981'}">${evalsFailed}</div>
      <div class="card-sub">of ${reports.length} evaluator${reports.length !== 1 ? "s" : ""} run</div>
    </div>
    <div class="card">
      <div class="card-label">Attack Success Rate</div>
      <div class="card-value" style="color:${attackSuccessRate > 30 ? '#EF4444' : '#10B981'}">${attackSuccessRate}%</div>
      <div class="card-sub">${failed} attack${failed !== 1 ? "s" : ""} succeeded</div>
    </div>
    <div class="card">
      <div class="card-label">Clean Rules</div>
      <div class="card-value" style="color:#10B981">${passed}</div>
      <div class="card-sub">tests passed</div>
    </div>
  </div>

  <!-- Results Table -->
  <div class="section">
    <h2>Evaluator Results</h2>
    <table>
      <thead>
        <tr>
          <th>Evaluator</th>
          <th>Tests</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Pass Rate</th>
          <th>Avg Score</th>
        </tr>
      </thead>
      <tbody>
        ${evaluatorRows}
      </tbody>
    </table>
  </div>

  <!-- Findings -->
  <div class="section">
    <h2>Findings</h2>
    ${findingsSection("Critical", "#DC2626", criticalFindings)}
    <div style="margin-top:20px">
    ${findingsSection("High", "#EA580C", highFindings)}
    </div>
  </div>

  <!-- Appendix -->
  <div class="section">
    <details>
      <summary>📋 Full Test Cases and Responses</summary>
      <div style="margin-top:16px">
        ${appendix}
      </div>
    </details>
  </div>

</div>
</body>
</html>`;

  // --- write files ---
  await mkdir(outputDir, { recursive: true });

  const htmlPath = path.join(outputDir, `${reportId}.html`);
  const jsonPath = path.join(outputDir, `${reportId}.json`);

  await writeFile(htmlPath, html, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf8");

  return { html: htmlPath, json: jsonPath };
}
