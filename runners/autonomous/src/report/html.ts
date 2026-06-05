// Self-contained HTML renderer for the autonomous report. No external assets.

import type { AutonomousReport, ReportFinding, Severity, Verdict } from "./types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SEV_COLOR: Record<Severity, string> = {
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#a16207",
  low: "#3f6212",
};

function verdictBadge(v: Verdict): string {
  const color = v === "FAIL" ? "#b91c1c" : v === "PASS" ? "#15803d" : "#6b7280";
  const label = v === "FAIL" ? "VULNERABLE" : v === "PASS" ? "DEFENDED" : "ERROR";
  return `<span class="badge" style="background:${color}">${label}</span>`;
}

function renderTurns(f: ReportFinding): string {
  if (f.turns.length === 0) return "";
  const rows = f.turns
    .map((t) => {
      const meta = [
        t.persona && `persona: ${esc(t.persona)}`,
        t.strategy && `strategy: ${esc(t.strategy)}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const score = t.score !== undefined ? `<span class="score">score ${t.score}/10</span>` : "";
      return `<div class="turn">
        <div class="turn-head">Turn ${t.turnIndex} ${score} <span class="meta">${meta}</span></div>
        <div class="bubble user"><b>Attacker:</b> ${esc(t.prompt)}</div>
        <div class="bubble agent"><b>Target:</b> ${esc(t.response)}</div>
      </div>`;
    })
    .join("\n");
  return `<details class="turns"><summary>Conversation (${f.turns.length} turn${f.turns.length === 1 ? "" : "s"})</summary>${rows}</details>`;
}

function renderScoreEvolution(f: ReportFinding): string {
  const scored = f.turns.filter((t) => t.score !== undefined);
  if (scored.length < 2) return "";
  const spark = scored
    .map((t) => {
      const h = Math.max(2, Math.round(((t.score ?? 0) / 10) * 24));
      const color = (t.score ?? 10) <= 3 ? "#b91c1c" : (t.score ?? 10) <= 6 ? "#a16207" : "#15803d";
      return `<span class="bar" title="turn ${t.turnIndex}: ${t.score}/10" style="height:${h}px;background:${color}"></span>`;
    })
    .join("");
  return `<div class="evolution"><span class="meta">score evolution:</span> <span class="spark">${spark}</span></div>`;
}

function renderFinding(f: ReportFinding): string {
  const selfCheck = f.selfCheck
    ? `<div class="selfcheck">Independent verifier: <b>${f.selfCheck.verdict}</b> (score ${f.selfCheck.score}/10, confidence ${f.selfCheck.confidence}%) — ${esc(f.selfCheck.reasoning)}</div>`
    : "";
  const std = f.standards
    ? Object.entries(f.standards)
        .map(([k, v]) => `<span class="std">${esc(k)}: ${esc(v)}</span>`)
        .join(" ")
    : "";
  return `<div class="finding">
    <div class="finding-head">
      ${verdictBadge(f.verdict)}
      <span class="sev" style="color:${SEV_COLOR[f.severity]}">${f.severity.toUpperCase()}</span>
      <span class="fname">${esc(f.name)}</span>
      <span class="conf">${f.verdict === "FAIL" ? `confidence ${f.confidence}%` : ""}</span>
    </div>
    <div class="meta">strategy: ${esc(f.strategy)}${f.personaArc.length ? ` · personas: ${esc(f.personaArc.join(" → "))}` : ""} ${std}</div>
    <div class="reasoning">${esc(f.reasoning)}</div>
    ${f.evidence && f.evidence !== "N/A" ? `<div class="evidence"><b>Evidence:</b> <code>${esc(f.evidence)}</code></div>` : ""}
    ${renderScoreEvolution(f)}
    ${renderTurns(f)}
    ${selfCheck}
  </div>`;
}

export function renderReportHtml(r: AutonomousReport): string {
  const failBySeverity = (sev: Severity) =>
    r.findings.filter((f) => f.verdict === "FAIL" && f.severity === sev).length;
  const confirmed = r.findings.filter((f) => f.verdict === "FAIL");

  const findingsHtml = [...r.findings]
    .sort((a, b) => {
      const order: Verdict[] = ["FAIL", "PASS", "ERROR"];
      return order.indexOf(a.verdict) - order.indexOf(b.verdict);
    })
    .map(renderFinding)
    .join("\n");

  const inventionsHtml = r.inventions.length
    ? `<section><h2>Novel Techniques Generated</h2><ul>${r.inventions
        .map(
          (i) =>
            `<li><b>[${i.kind}] ${esc(i.name)}</b> — ${esc(i.description)}${i.persistedPath ? ` <span class="meta">(persisted)</span>` : ""}</li>`
        )
        .join("")}</ul></section>`
    : "";

  const decisionsHtml = r.decisionLog.length
    ? `<details class="turns"><summary>Decision log (${r.decisionLog.length})</summary>${r.decisionLog
        .map(
          (d) =>
            `<div class="decision"><span class="action">${esc(d.action)}</span> ${d.threadId ? `<span class="meta">${esc(d.threadId)}</span>` : ""} ${esc(d.rationale)}</div>`
        )
        .join("")}</details>`
    : "";

  const timelineHtml = r.personaTimeline.length
    ? `<details class="turns"><summary>Persona / strategy timeline (${r.personaTimeline.length})</summary>${r.personaTimeline
        .map(
          (e) =>
            `<div class="decision"><span class="meta">${esc(e.threadId)} · turn ${e.turnIndex}</span> ${esc(e.persona ?? "?")} / ${esc(e.strategy ?? "?")}</div>`
        )
        .join("")}</details>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autonomous Red-Team Report — ${esc(r.target.name)}</title>
<style>
  :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { margin: 0; background: #f8fafc; color: #0f172a; line-height: 1.5; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 24px 80px; }
  header.cover { background: #0f172a; color: #f1f5f9; margin: -32px -24px 24px; padding: 36px 24px; }
  header.cover h1 { margin: 0 0 6px; font-size: 24px; }
  header.cover .sub { color: #94a3b8; font-size: 14px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: 12px; margin: 18px 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
  .card .n { font-size: 26px; font-weight: 700; }
  .card .l { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  h2 { font-size: 17px; margin: 28px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  section { margin-bottom: 8px; }
  .finding { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #cbd5e1; border-radius: 8px; padding: 14px; margin: 12px 0; }
  .finding-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .badge { color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .sev { font-weight: 700; font-size: 12px; }
  .fname { font-weight: 600; }
  .conf { color: #64748b; font-size: 12px; margin-left: auto; }
  .meta { color: #64748b; font-size: 12px; }
  .std { background: #eef2ff; color: #3730a3; border-radius: 4px; padding: 1px 6px; font-size: 11px; }
  .reasoning { margin: 8px 0; }
  .evidence code { background: #fef2f2; color: #7f1d1d; padding: 2px 6px; border-radius: 4px; display: inline-block; white-space: pre-wrap; }
  details.turns { margin-top: 10px; }
  details.turns summary { cursor: pointer; color: #2563eb; font-size: 13px; }
  .turn { border-top: 1px solid #f1f5f9; padding: 8px 0; }
  .turn-head { font-size: 12px; color: #475569; margin-bottom: 4px; }
  .score { color: #2563eb; font-weight: 600; }
  .bubble { padding: 6px 10px; border-radius: 8px; margin: 4px 0; font-size: 13px; white-space: pre-wrap; }
  .bubble.user { background: #f1f5f9; }
  .bubble.agent { background: #ecfeff; }
  .evolution { margin: 8px 0; }
  .spark .bar { display: inline-block; width: 8px; margin-right: 3px; vertical-align: bottom; border-radius: 2px 2px 0 0; }
  .selfcheck { margin-top: 8px; font-size: 12px; color: #334155; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 6px 8px; }
  .decision { font-size: 12px; padding: 4px 0; border-top: 1px solid #f1f5f9; }
  .decision .action { font-weight: 700; text-transform: uppercase; font-size: 10px; color: #475569; }
  ul { padding-left: 20px; } li { margin: 4px 0; }
  .narrative { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
  .truncated { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 12px; border-radius: 8px; margin: 12px 0; }
</style></head>
<body><div class="wrap">
<header class="cover">
  <h1>Autonomous Red-Team Report</h1>
  <div class="sub">${esc(r.target.name)} · ${esc(r.target.endpoint)}</div>
  <div class="sub">Generated ${esc(r.generatedAt)} · Commander ${esc(r.commanderModel || "?")} · Attacker ${esc(r.attackerModel || "?")}</div>
</header>

${r.truncated ? `<div class="truncated">⚠ Run truncated: ${esc(r.truncationReason ?? "ceiling reached")}. This is a partial report.</div>` : ""}

<section>
  <h2>Objective</h2>
  <div class="narrative">${esc(r.objective)}<div class="meta" style="margin-top:6px">Outcome: <b>${esc(r.objectiveOutcome)}</b></div></div>
</section>

<div class="cards">
  <div class="card"><div class="n">${r.summary.confirmed}</div><div class="l">Vulnerabilities</div></div>
  <div class="card"><div class="n">${r.summary.defended}</div><div class="l">Defended</div></div>
  <div class="card"><div class="n">${r.summary.attackSuccessRate}%</div><div class="l">Attack success</div></div>
  <div class="card"><div class="n" style="color:${SEV_COLOR.critical}">${failBySeverity("critical")}</div><div class="l">Critical</div></div>
  <div class="card"><div class="n" style="color:${SEV_COLOR.high}">${failBySeverity("high")}</div><div class="l">High</div></div>
  <div class="card"><div class="n">${r.totalCostUsd !== undefined ? "$" + r.totalCostUsd.toFixed(2) : "—"}</div><div class="l">Cost</div></div>
</div>

<section>
  <h2>Executive Summary</h2>
  <div class="narrative">${esc(r.executiveNarrative)}</div>
</section>

<section>
  <h2>Reconnaissance</h2>
  <div class="narrative">
    <div>${esc(r.recon.fingerprint)}</div>
    ${r.recon.guardrails.length ? `<div style="margin-top:8px"><b>Guardrails:</b><ul>${r.recon.guardrails.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></div>` : ""}
    ${r.recon.weakPoints.length ? `<div><b>Weak points:</b><ul>${r.recon.weakPoints.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <div class="meta">${r.recon.probeCount} benign probe(s).</div>
  </div>
</section>

<section>
  <h2>Findings (${confirmed.length} confirmed of ${r.summary.threads} threads)</h2>
  ${findingsHtml || '<div class="narrative">No attack threads were recorded.</div>'}
</section>

${inventionsHtml}

${r.strategiesUsed.length ? `<section><h2>Strategies Used</h2><div class="narrative">${r.strategiesUsed.map((s) => `<span class="std" style="margin-right:6px">${esc(s)}</span>`).join("")}</div></section>` : ""}

${r.responsePatterns.length ? `<section><h2>Response Patterns</h2><ul>${r.responsePatterns.map((p) => `<li><b>${esc(p.pattern)}:</b> ${esc(p.observation)}</li>`).join("")}</ul></section>` : ""}

${r.recommendations.length ? `<section><h2>Recommendations</h2><ul>${r.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}

<section>
  <h2>Operation Trace</h2>
  ${timelineHtml}
  ${decisionsHtml}
</section>

</div></body></html>`;
}
