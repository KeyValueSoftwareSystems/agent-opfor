// Self-contained, executive-grade HTML report for the autonomous runner. No external assets.
// Layout: dark cover → sticky nav → executive summary (verdict, severity bar, top findings) →
// vuln-class matrix → key findings → attack tree → per-finding conversation cards → synthesis.

import type { AutonomousReport, ReportFinding, ReportTurn, Severity } from "./types.js";
import { renderForest } from "../state/observe.js";

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
const SEV_HEX: Record<Severity, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#16A34A",
};
const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function expandableBlock(content: string, fadeColor = "#F1F5F9"): string {
  return `<div class="code-wrap">
    <pre class="result-code">${content}</pre>
    <div class="code-fade" style="background:linear-gradient(to bottom,${fadeColor}00,${fadeColor})"></div>
    <button class="code-more" onclick="var w=this.closest('.code-wrap');w.classList.toggle('expanded');this.textContent=w.classList.contains('expanded')?'▲ Show less':'▼ Show more'">▼ Show more</button>
  </div>`;
}

function renderTurn(t: ReportTurn, failing: boolean): string {
  const score = typeof t.score === "number" ? t.score : undefined;
  const scoreColor =
    score === undefined ? "#94A3B8" : score <= 3 ? "#DC2626" : score <= 6 ? "#D97706" : "#059669";
  const tag =
    `${t.persona ?? "-"} / ${t.strategy ?? "-"}` + (score !== undefined ? `  ·  ${score}/10` : "");
  return `
    <details class="turn-card"${failing ? " open" : ""}>
      <summary class="turn-card-header" style="border-left:3px solid ${failing ? "var(--fail)" : "var(--line-2)"}">
        <span class="mono" style="font-size:10px;color:var(--muted-2)">T${t.turnIndex}</span>
        <span>Turn ${t.turnIndex}${failing ? " — breach" : ""}</span>
        <span style="margin-left:auto;font-size:10px;color:${scoreColor};font-weight:600">${esc(tag)}</span>
      </summary>
      <div class="turn-operator"><div class="turn-label">Operator</div>${expandableBlock(esc(truncate(t.prompt, 8000)))}</div>
      <div class="turn-agent"><div class="turn-label">Target</div>${expandableBlock(esc(truncate(t.response, 8000)), "#FFFFFF")}</div>
    </details>`;
}

function renderFindingCard(f: ReportFinding): string {
  const sevColor = SEV_HEX[f.severity];
  const failSet = new Set(f.failingTurns ?? []);
  const turns = f.turns.map((t) => renderTurn(t, failSet.has(t.turnIndex))).join("");
  const standards =
    f.standards && Object.keys(f.standards).length
      ? Object.entries(f.standards)
          .map(([k, v]) => `<span class="std">${esc(k)}:${esc(v)}</span>`)
          .join(" ")
      : "";
  const sc = f.selfCheck;
  const selfCheckBlock = sc
    ? `<div class="selfcheck"><strong>Independent verifier:</strong> ${esc(sc.verdict)} · score ${sc.score}/10 · confidence ${sc.confidence}% — ${esc(sc.reasoning)}</div>`
    : "";
  const corr = f.crossSessionCorroborated
    ? `<span class="corr-badge">✓ corroborated · ${f.corroboratingThreads?.length ?? 2} independent threads</span>`
    : "";
  return `
    <details class="finding-card">
      <summary>
        <span class="sev-dot" style="background:${sevColor}"></span>
        <span class="sev-tag" style="background:${sevColor}14;color:${sevColor};border-color:${sevColor}40">${esc(f.severity)}</span>
        <span class="fc-name">${esc(f.name)}</span>
        <span class="fc-right"><span class="fc-conf">${f.confidence}%</span><svg class="chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
      </summary>
      <div class="finding-body">
        <div class="finding-meta">
          <span class="std">${esc(f.vulnClassId)}</span>${standards}
          <span class="meta-pill">thread ${esc(f.threadId)}${f.gen ? ` · gen ${f.gen}` : ""}</span>
          ${f.strategy ? `<span class="meta-pill">strategy: ${esc(f.strategy)}</span>` : ""}
          ${f.personaArc.length ? `<span class="meta-pill">personas: ${esc(f.personaArc.join(" → "))}</span>` : ""}
          ${corr}
        </div>
        ${f.evidence && f.evidence !== "N/A" ? `<div class="result-section"><div class="result-section-label">Evidence — verbatim from target</div><div class="evidence"><code>${esc(truncate(f.evidence, 1400))}</code></div></div>` : ""}
        <div class="result-section"><div class="result-section-label">Why this is a finding</div><div class="reasoning">${esc(f.reasoning)}</div></div>
        ${selfCheckBlock}
        ${turns ? `<div class="result-section"><div class="result-section-label">Conversation — ${f.turns.length} turn${f.turns.length === 1 ? "" : "s"} (breach turns expanded)</div>${turns}</div>` : ""}
      </div>
    </details>`;
}

function renderAttackTree(r: AutonomousReport): string {
  if (r.findings.length === 0) return "";
  // A thread can have several findings (multiple classes / cross-class hits), so group by
  // threadId and aggregate — otherwise the node would show only the last one.
  const byId = new Map<string, ReportFinding[]>();
  for (const f of r.findings) {
    const arr = byId.get(f.threadId);
    if (arr) arr.push(f);
    else byId.set(f.threadId, [f]);
  }
  const ids = [...byId.keys()];
  const tree = renderForest(
    ids,
    (id) => byId.get(id)![0].parentThreadId,
    (id) => {
      const fs = byId.get(id)!;
      const classes = [...new Set(fs.map((x) => x.vulnClassId))].join(", ");
      const fails = fs.filter((x) => x.verdict === "FAIL");
      const worst = SEV_ORDER.find((s) => fails.some((x) => x.severity === s));
      const mark = fails.length
        ? `🔴 ${worst}`
        : fs.every((x) => x.verdict === "PASS")
          ? "🛡 defended"
          : "⚠ error";
      const corr = fs.some((x) => x.crossSessionCorroborated) ? " ✓corr" : "";
      return `${id}  [${classes}]  ${mark}${corr}`;
    }
  );
  const e = r.exploration;
  return `<div class="section" id="tree">
    <div class="section-header"><div class="section-num">5</div><div class="section-title">Attack Tree</div>
      <div class="section-subtitle">${r.summary.threads} threads · ${e.leadsFlagged} leads (${e.leadsSpawned} expanded / ${e.leadsDismissed} dropped) · depth ${e.maxDepthReached}</div></div>
    <pre class="tree">${esc(tree)}</pre>
  </div>`;
}

export function renderReportHtml(r: AutonomousReport): string {
  const now = new Date(r.generatedAt);
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const fails = r.findings.filter((f) => f.verdict === "FAIL");
  const sevCount = (s: Severity) => fails.filter((f) => f.severity === s).length;
  const crit = sevCount("critical"),
    high = sevCount("high"),
    med = sevCount("medium"),
    low = sevCount("low");

  const vulnerable = r.summary.confirmed > 0;
  const verdict = vulnerable ? "VULNERABLE" : "DEFENDED";
  const risk =
    crit > 0
      ? { label: "Critical Risk", color: "#B91C1C" }
      : high > 0
        ? { label: "High Risk", color: "#DC2626" }
        : vulnerable
          ? { label: "Medium Risk", color: "#D97706" }
          : { label: "Low Risk", color: "#059669" };

  const ranked = [...fails].sort(
    (a, b) =>
      SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || b.confidence - a.confidence
  );

  // Severity distribution bar (proportional segments).
  const sevSeg = (
    [
      ["critical", crit],
      ["high", high],
      ["medium", med],
      ["low", low],
    ] as [Severity, number][]
  )
    .filter(([, n]) => n > 0)
    .map(
      ([s, n]) =>
        `<div class="sevbar-seg" style="flex:${n};background:${SEV_HEX[s]}" title="${n} ${s}"></div>`
    )
    .join("");
  const sevLegend = (["critical", "high", "medium", "low"] as Severity[])
    .map(
      (s) =>
        `<span class="sev-leg"><span class="sev-dot" style="background:${SEV_HEX[s]}"></span>${sevCount(s)} ${s}</span>`
    )
    .join("");

  // Top findings preview ("what went wrong" at a glance).
  const topFindings = ranked
    .slice(0, 6)
    .map(
      (f) => `<a class="top-find" href="#detail">
        <span class="sev-dot" style="background:${SEV_HEX[f.severity]}"></span>
        <span class="tf-name">${esc(f.name)}</span>
        <span class="tf-cls">${esc(f.vulnClassId)}</span>
        <span class="tf-conf" style="color:${SEV_HEX[f.severity]}">${esc(f.severity)} · ${f.confidence}%</span>
      </a>`
    )
    .join("");

  // Per-class matrix.
  const classes = [...new Set(r.findings.map((f) => f.vulnClassId))];
  const classRows = classes
    .map((cls) => {
      const rows = r.findings.filter((f) => f.vulnClassId === cls);
      const c = rows.filter((f) => f.verdict === "FAIL");
      const d = rows.filter((f) => f.verdict === "PASS").length;
      const denom = c.length + d;
      const rate = denom > 0 ? Math.round((c.length / denom) * 100) : 0;
      const worst = SEV_ORDER.find((s) => c.some((f) => f.severity === s));
      const wc = worst ? SEV_HEX[worst] : "#94A3B8";
      return { cls, confirmed: c.length, defended: d, rate, worst, wc };
    })
    .sort((a, b) => b.confirmed - a.confirmed || b.rate - a.rate);
  const classTable = classRows
    .map(
      (x) => `
    <tr>
      <td><span class="mono-cls">${esc(x.cls)}</span></td>
      <td>${x.worst ? `<span class="sev-tag" style="background:${x.wc}14;color:${x.wc};border-color:${x.wc}40">${esc(x.worst)}</span>` : "—"}</td>
      <td style="font-weight:600;color:${x.confirmed > 0 ? "#DC2626" : "#059669"}">${x.confirmed}</td>
      <td style="color:#059669">${x.defended}</td>
      <td><div class="rate-cell"><div class="rate-bar"><div class="rate-fill" style="width:${x.rate}%;background:${x.rate > 0 ? "#DC2626" : "#059669"}"></div></div><span class="rate-num">${x.rate}%</span></div></td>
    </tr>`
    )
    .join("");

  // Findings detail grouped by class.
  const byClass = new Map<string, ReportFinding[]>();
  for (const f of ranked)
    (byClass.get(f.vulnClassId) ?? byClass.set(f.vulnClassId, []).get(f.vulnClassId)!).push(f);
  const detailHtml = [...byClass.entries()]
    .map(
      ([cls, list]) =>
        `<div class="class-group"><div class="class-group-head">${esc(cls)} <span class="meta-pill">${list.length} confirmed</span></div>${list.map(renderFindingCard).join("")}</div>`
    )
    .join("");

  const defended = r.findings.filter((f) => f.verdict === "PASS");
  const errored = r.findings.filter((f) => f.verdict === "ERROR");
  const chip = (f: ReportFinding) =>
    `<span class="thread-chip" title="${esc(f.reasoning)}">${esc(f.threadId)} · ${esc(f.vulnClassId)}</span>`;

  const recs = r.recommendations.length
    ? `<div class="section" id="recs"><div class="section-header"><div class="section-num">7</div><div class="section-title">Recommendations</div></div>
        <ol class="rec-list">${r.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>`
    : "";
  const patterns = r.responsePatterns.length
    ? `<div class="section"><div class="section-header"><div class="section-num">8</div><div class="section-title">Response Patterns</div></div>
        <div class="card"><table class="kv">${r.responsePatterns.map((p) => `<tr><td class="kv-k">${esc(p.pattern)}</td><td>${esc(p.observation)}</td></tr>`).join("")}</table></div></div>`
    : "";
  const decisionLog = r.decisionLog.length
    ? `<details class="appendix"><summary>Decision log (${r.decisionLog.length})</summary><div class="appendix-body">${r.decisionLog
        .map(
          (d) =>
            `<div class="decision"><span class="decision-action decision-${esc(d.action)}">${esc(d.action)}</span> ${d.threadId ? `<span class="mono">${esc(d.threadId)}</span> ` : ""}${esc(d.rationale)}</div>`
        )
        .join("")}</div></details>`
    : "";
  const inventions = r.inventions.length
    ? `<details class="appendix"><summary>Novel techniques invented (${r.inventions.length})</summary><div class="appendix-body"><ul>${r.inventions.map((i) => `<li><strong>${esc(i.kind)}: ${esc(i.name)}</strong> — ${esc(i.description)}</li>`).join("")}</ul></div></details>`
    : "";
  const strategies = r.strategiesUsed.length
    ? `<div class="card" style="margin-bottom:8px">${r.strategiesUsed.map((s) => `<span class="std" style="margin:0 6px 6px 0;display:inline-block">${esc(s)}</span>`).join("")}</div>`
    : "";

  const narrative = r.synthesisComplete
    ? esc(r.executiveNarrative)
    : `Assessment of <strong>${esc(r.target.name)}</strong>: <strong>${r.summary.confirmed}</strong> confirmed vulnerabilit${r.summary.confirmed === 1 ? "y" : "ies"} (${crit} critical, ${high} high) across ${r.summary.threads} attack threads — ${r.summary.attackSuccessRate}% attack-success rate.${r.truncated ? ` <em>Run truncated: ${esc(r.truncationReason ?? "")}.</em>` : ""}`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Opfor Hunt — ${esc(r.target.name)}</title>
<style>
  :root{--bg:#F6F7F9;--surface:#FFF;--surface-2:#F1F4F8;--text:#0B1220;--text-2:#3A475A;--muted:#6B7A90;--muted-2:#9AA7B8;--line:#E4E8EE;--line-2:#CBD3DE;--pass:#059669;--pass-bg:#ECFDF5;--pass-border:#A7F3D0;--fail:#DC2626;--fail-bg:#FEF2F2;--fail-border:#FCA5A5;--accent:#f5ad5c;--ink:#0F172A;--shadow:0 1px 2px rgba(16,24,40,.04),0 1px 3px rgba(16,24,40,.06)}
  *{box-sizing:border-box;margin:0;padding:0}
  html{background:var(--bg);scroll-behavior:smooth}
  body{color:var(--text);font:14px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);padding:0 0 60px}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .page{max-width:1000px;margin:0 auto;padding:0 24px}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow)}

  /* cover */
  .cover{background:linear-gradient(160deg,#0F172A,#111c33);color:#fff}
  .cover-inner{max-width:1000px;margin:0 auto;padding:38px 24px 34px}
  .cover-top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:26px}
  .cover-brand{display:flex;align-items:center;gap:10px}
  .cover-brand-icon{width:38px;height:38px;background:linear-gradient(135deg,#f5ad5c,#c47a2a);border-radius:9px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(245,173,92,.3)}
  .cover-brand-name{font-size:15px;font-weight:700;letter-spacing:.04em}
  .cover-brand-sub{font-size:11px;color:#94A3B8;letter-spacing:.08em;text-transform:uppercase;margin-top:1px}
  .cover-classification{padding:4px 12px;border:1px solid rgba(255,255,255,.15);border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#CBD5E1}
  .cover-title{font-size:27px;font-weight:700;letter-spacing:-.01em;margin-bottom:6px}
  .cover-subtitle{font-size:14px;color:#94A3B8;margin-bottom:22px}
  .cover-obj{font-size:13px;color:#DBE3EE;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:11px 15px;margin-bottom:20px;line-height:1.55}
  .cover-obj b{color:#fff;text-transform:uppercase;font-size:10px;letter-spacing:.09em;display:block;margin-bottom:3px;color:#94A3B8}
  .cover-meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden}
  .cover-meta-item{padding:13px 17px;border-right:1px solid rgba(255,255,255,.08);border-top:1px solid rgba(255,255,255,.08)}
  .cover-meta-item:nth-child(-n+3){border-top:none}
  .cover-meta-k{font-size:10px;color:#7C8BA1;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
  .cover-meta-v{font-size:13px;color:#E7ECF3;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cover-meta-v.mono{font-size:11px}

  /* sticky nav */
  .nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);margin-bottom:28px}
  .nav-inner{max-width:1000px;margin:0 auto;padding:0 24px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;height:46px}
  .nav a{font-size:12.5px;font-weight:500;color:var(--text-2);padding:6px 11px;border-radius:7px}
  .nav a:hover{background:var(--surface-2);color:var(--text);text-decoration:none}
  .nav .nav-verdict{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.04em;padding:3px 10px;border-radius:999px}

  .section{margin-bottom:34px;scroll-margin-top:60px}
  .section-header{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--line)}
  .section-num{width:22px;height:22px;border-radius:6px;background:var(--ink);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .section-title{font-size:15px;font-weight:700;letter-spacing:-.01em}
  .section-subtitle{font-size:12px;color:var(--muted);margin-left:auto}

  /* exec */
  .exec-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;border-radius:14px;border:1px solid var(--line-2);background:var(--surface);margin-bottom:14px;box-shadow:var(--shadow)}
  .exec-banner.pass{border-color:var(--pass-border);background:var(--pass-bg)}
  .exec-banner.fail{border-color:var(--fail-border);background:var(--fail-bg)}
  .exec-banner-left{display:flex;align-items:center;gap:15px}
  .exec-verdict-icon{width:46px;height:46px;border-radius:11px;border:1px solid;display:flex;align-items:center;justify-content:center}
  .exec-banner.pass .exec-verdict-icon{border-color:var(--pass-border);color:var(--pass)}
  .exec-banner.fail .exec-verdict-icon{border-color:var(--fail-border);color:var(--fail)}
  .exec-verdict-label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
  .exec-verdict-text{font-size:25px;font-weight:800;letter-spacing:.03em;line-height:1}
  .exec-banner.pass .exec-verdict-text{color:var(--pass)}.exec-banner.fail .exec-verdict-text{color:var(--fail)}
  .exec-verdict-sub{font-size:11px;color:var(--muted);margin-top:4px}
  .exec-risk{font-size:12px;font-weight:700;padding:5px 13px;border-radius:999px;border:1px solid;white-space:nowrap}
  .sevbar-wrap{margin-bottom:14px}
  .sevbar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--surface-2);border:1px solid var(--line)}
  .sevbar-seg{min-width:3px}
  .sevbar-empty{flex:1;background:repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2) 6px,#fff 6px,#fff 12px)}
  .sev-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:11.5px;color:var(--muted)}
  .sev-leg{display:flex;align-items:center;gap:5px}
  .sev-dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex-shrink:0}
  .summary-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .stat-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:15px 17px;box-shadow:var(--shadow)}
  .sc-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .sc-value{font-size:24px;font-weight:800;line-height:1}
  .sc-bar{height:5px;background:var(--line);border-radius:3px;margin-top:9px;overflow:hidden}
  .sc-bar-fill{height:100%;border-radius:3px}
  .sc-sub{font-size:11px;color:var(--muted);margin-top:5px}
  .summary-narrative{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:17px;margin-top:14px;font-size:13.5px;color:var(--text-2);line-height:1.75;box-shadow:var(--shadow)}
  .summary-narrative strong{color:var(--text)}

  /* top findings preview */
  .top-finds{margin-top:14px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface);box-shadow:var(--shadow)}
  .top-finds-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:11px 16px;border-bottom:1px solid var(--line);background:var(--surface-2)}
  .top-find{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);color:var(--text)}
  .top-find:last-child{border-bottom:none}.top-find:hover{background:var(--surface-2);text-decoration:none}
  .tf-name{font-weight:600;font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tf-cls{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace;flex-shrink:0}
  .tf-conf{font-size:11px;font-weight:700;text-transform:uppercase;flex-shrink:0;width:120px;text-align:right}

  /* class matrix */
  .matrix-wrap{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
  table.matrix{width:100%;border-collapse:collapse}
  table.matrix th{background:var(--surface-2);padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)}
  table.matrix td{padding:11px 14px;font-size:13px;border-bottom:1px solid var(--line);vertical-align:middle}
  table.matrix tr:last-child td{border-bottom:none}table.matrix tr:hover td{background:var(--surface-2)}
  .mono-cls{font-family:ui-monospace,monospace;font-size:12.5px;font-weight:600}
  .rate-cell{display:flex;align-items:center;gap:8px}
  .rate-bar{flex:1;height:6px;background:var(--line);border-radius:3px;overflow:hidden;min-width:60px}
  .rate-fill{height:100%;border-radius:3px}
  .rate-num{font-size:12px;font-weight:600;color:var(--text-2);width:34px;text-align:right}

  /* recon */
  .recon-narrative{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:17px;font-size:13.5px;color:var(--text-2);line-height:1.75;margin-bottom:12px;box-shadow:var(--shadow)}
  .scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .scope-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow)}
  .scope-card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:12px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--text-2)}

  /* key findings blocks */
  .findings-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .finding-block{background:var(--surface);border:1px solid;border-left-width:3px;border-radius:12px;padding:16px;box-shadow:var(--shadow)}
  .finding-block-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .finding-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em}
  .finding-count{font-size:11px;font-weight:700;padding:2px 8px;border:1px solid;border-radius:999px}
  .finding-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px}
  .finding-list li{font-size:13px;color:var(--text-2);line-height:1.5}
  .finding-list strong{color:var(--text)}
  .finding-score{margin-left:6px;font-size:11px;color:var(--muted);font-weight:600;background:var(--surface-2);padding:1px 6px;border-radius:4px;border:1px solid var(--line)}
  .finding-desc{margin-top:3px;font-size:12px;color:var(--muted);font-style:italic}
  .no-findings{background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:12px;padding:18px;text-align:center;color:var(--pass);font-weight:600;font-size:13px}

  .tree{background:#0b1020;color:#e2e8f0;padding:15px 17px;border-radius:12px;overflow-x:auto;font-size:12.5px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:var(--shadow)}

  /* findings detail */
  .class-group{margin-bottom:20px}
  .class-group-head{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;color:var(--text)}
  .finding-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:8px;box-shadow:var(--shadow)}
  .finding-card>summary{display:flex;align-items:center;gap:10px;padding:13px 16px;cursor:pointer;list-style:none}
  .finding-card>summary::-webkit-details-marker{display:none}
  .finding-card>summary:hover{background:var(--surface-2)}
  .finding-card[open]>summary{background:var(--surface-2);border-bottom:1px solid var(--line)}
  .fc-name{font-size:13.5px;font-weight:600;flex:1;min-width:0}
  .fc-right{display:flex;align-items:center;gap:9px;flex-shrink:0}
  .fc-conf{font-size:12px;color:var(--muted);font-weight:600}
  .chevron{color:var(--muted-2);transition:transform .2s}
  .finding-card[open] .chevron{transform:rotate(180deg)}
  .finding-body{padding:16px}
  .finding-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:13px;align-items:center}
  .meta-pill{font-size:11px;color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:5px;padding:2px 8px}
  .corr-badge{font-size:11px;color:var(--pass);background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:5px;padding:2px 8px;font-weight:600}
  .std{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600}
  .result-section{margin-bottom:11px}
  .result-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px}
  .evidence code{background:#fff1f1;color:#7f1d1d;padding:9px 11px;border-radius:7px;display:block;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace;font-size:12px;border:1px solid #fecaca}
  .reasoning{font-size:13px;color:var(--text-2);line-height:1.6}
  .selfcheck{margin:11px 0;font-size:12px;color:#334155;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:7px;padding:9px 11px}
  .sev-tag{display:inline-block;padding:2px 8px;border:1px solid;border-radius:5px;font-size:11px;font-weight:700;text-transform:capitalize;white-space:nowrap}
  .thread-chip{display:inline-block;font-size:11px;color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:5px;padding:3px 8px;margin:0 5px 5px 0;font-family:ui-monospace,monospace}

  /* turns */
  .turn-card{margin-bottom:8px;border:1px solid var(--line);border-radius:9px;overflow:hidden}
  .turn-card-header{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface-2);cursor:pointer;list-style:none;font-size:11px;font-weight:600;border-bottom:1px solid var(--line)}
  .turn-card-header::-webkit-details-marker{display:none}
  .turn-operator{padding:11px 13px;border-bottom:1px solid var(--line);border-left:3px solid var(--accent);background:#fffaf3}
  .turn-agent{padding:11px 13px;border-left:3px solid var(--line-2)}
  .turn-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px}
  .turn-operator .turn-label{color:#b45309}.turn-agent .turn-label{color:var(--muted)}
  .code-wrap{position:relative}
  .result-code{font-size:12px;background:var(--surface);border:1px solid var(--line);padding:9px 11px;border-radius:7px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace;max-height:200px;overflow:hidden;line-height:1.55}
  .code-fade{position:absolute;bottom:28px;left:0;right:0;height:42px;pointer-events:none}
  .code-more{display:block;width:100%;font-size:11px;font-weight:600;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-top:none;border-radius:0 0 7px 7px;padding:5px;cursor:pointer;text-align:center}
  .code-more:hover{background:var(--surface-2)}
  .code-wrap.expanded .result-code{max-height:none}.code-wrap.expanded .code-fade{display:none}

  /* synthesis + appendix */
  table.kv{width:100%;border-collapse:collapse}
  table.kv td{padding:9px 0;font-size:13px;border-bottom:1px solid var(--line);vertical-align:top}
  table.kv tr:last-child td{border-bottom:none}
  .kv-k{font-weight:600;white-space:nowrap;padding-right:16px;color:var(--text)}
  .rec-list{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:9px;font-size:13.5px;color:var(--text-2);line-height:1.65}
  .appendix{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:8px;overflow:hidden;box-shadow:var(--shadow)}
  .appendix>summary{padding:12px 16px;cursor:pointer;font-size:13px;font-weight:600;list-style:none}
  .appendix>summary::-webkit-details-marker{display:none}
  .appendix>summary:hover{background:var(--surface-2)}
  .appendix-body{padding:0 16px 14px;font-size:12px;color:var(--text-2)}
  .decision{padding:6px 0;border-top:1px solid var(--line);line-height:1.5}
  .decision-action{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-right:7px;background:var(--surface-2);border:1px solid var(--line)}
  .decision-fork{color:#7c3aed}.decision-dispatch{color:#2563eb}.decision-stop{color:var(--fail)}.decision-pivot{color:#d97706}
  .report-footer{max-width:1000px;margin:40px auto 0;padding:16px 24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}

  @media print{body{background:#fff}.nav{display:none}.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}.stat-card,.scope-card,.finding-block,.finding-card,.matrix-wrap{break-inside:avoid}.finding-card{box-shadow:none}}
  @media(max-width:680px){.cover-meta{grid-template-columns:1fr 1fr}.summary-stats,.scope-grid,.findings-grid{grid-template-columns:1fr 1fr}.tf-conf{width:auto}}
</style></head><body>

<div class="cover"><div class="cover-inner">
  <div class="cover-top">
    <div class="cover-brand"><div class="cover-brand-icon"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg></div>
      <div><div class="cover-brand-name">Opfor</div><div class="cover-brand-sub">Autonomous Red-Team</div></div></div>
    <div class="cover-classification">Confidential</div>
  </div>
  <div class="cover-title">Autonomous Red-Team Assessment</div>
  <div class="cover-subtitle">Adaptive adversarial evaluation · ${esc(dateStr)}</div>
  <div class="cover-obj"><b>Objective</b>${esc(r.objective)}</div>
  <div class="cover-meta">
    <div class="cover-meta-item"><div class="cover-meta-k">Target</div><div class="cover-meta-v" title="${esc(r.target.name)}">${esc(truncate(r.target.name, 50))}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Endpoint</div><div class="cover-meta-v mono">${esc(truncate(r.target.endpoint, 50))}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Assessment Date</div><div class="cover-meta-v">${esc(dateStr)}, ${esc(timeStr)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Commander · Operator</div><div class="cover-meta-v mono">${esc(r.commanderModel)} · ${esc(r.operatorModel)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Cost</div><div class="cover-meta-v">${r.totalCostUsd !== undefined ? "$" + r.totalCostUsd.toFixed(2) : "—"}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Report ID</div><div class="cover-meta-v mono" style="color:#7C8BA1">${esc(r.reportId.slice(0, 8))}</div></div>
  </div>
</div></div>

<nav class="nav"><div class="nav-inner">
  <a href="#exec">Summary</a><a href="#recon">Recon</a><a href="#classes">Categories</a><a href="#findings">Key Findings</a><a href="#tree">Attack Tree</a><a href="#detail">Detail</a>${recs ? '<a href="#recs">Recommendations</a>' : ""}
  <span class="nav-verdict" style="background:${risk.color}14;color:${risk.color};border:1px solid ${risk.color}40">${verdict}</span>
</div></nav>

<div class="page">

  <div class="section" id="exec">
    <div class="section-header"><div class="section-num">1</div><div class="section-title">Executive Summary</div></div>
    <div class="exec-banner ${vulnerable ? "fail" : "pass"}">
      <div class="exec-banner-left">
        <div class="exec-verdict-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${vulnerable ? '<path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/>' : '<path d="M20 6L9 17l-5-5"/>'}</svg></div>
        <div><div class="exec-verdict-label">Overall Verdict</div><div class="exec-verdict-text">${verdict}</div><div class="exec-verdict-sub">objective ${esc(r.objectiveOutcome)}${r.truncated ? " · run truncated" : ""}</div></div>
      </div>
      <div class="exec-risk" style="background:${risk.color}14;color:${risk.color};border-color:${risk.color}40">${risk.label}</div>
    </div>
    ${vulnerable ? `<div class="sevbar-wrap"><div class="sevbar">${sevSeg || '<div class="sevbar-empty"></div>'}</div><div class="sev-legend">${sevLegend}</div></div>` : ""}
    <div class="summary-stats">
      <div class="stat-card"><div class="sc-label">Confirmed Vulnerabilities</div><div class="sc-value" style="color:${vulnerable ? "#DC2626" : "#059669"}">${r.summary.confirmed}</div><div class="sc-sub">${crit} critical · ${high} high</div></div>
      <div class="stat-card"><div class="sc-label">Attack Success Rate</div><div class="sc-value" style="color:${r.summary.attackSuccessRate > 0 ? "#DC2626" : "#059669"}">${r.summary.attackSuccessRate}%</div><div class="sc-bar"><div class="sc-bar-fill" style="width:${r.summary.attackSuccessRate}%;background:${r.summary.attackSuccessRate > 0 ? "#DC2626" : "#059669"}"></div></div><div class="sc-sub">${r.summary.confirmed}/${r.summary.confirmed + r.summary.defended} attempts breached</div></div>
      <div class="stat-card"><div class="sc-label">Defended</div><div class="sc-value" style="color:#059669">${r.summary.defended}</div><div class="sc-sub">held under pressure</div></div>
      <div class="stat-card"><div class="sc-label">Exploration</div><div class="sc-value">${r.summary.threads}</div><div class="sc-sub">threads · ${r.exploration.leadsSpawned} follow-up wave(s)</div></div>
    </div>
    <div class="summary-narrative">${narrative}</div>
    ${topFindings ? `<div class="top-finds"><div class="top-finds-head">Top findings — what went wrong</div>${topFindings}</div>` : ""}
  </div>

  <div class="section" id="recon">
    <div class="section-header"><div class="section-num">2</div><div class="section-title">Reconnaissance</div><div class="section-subtitle">${r.recon.probeCount} benign probe(s)</div></div>
    <div class="recon-narrative">${esc(r.recon.fingerprint)}</div>
    <div class="scope-grid">
      <div class="scope-card"><div class="scope-card-title">Observed Guardrails</div>${r.recon.guardrails.length ? `<div class="chips">${r.recon.guardrails.map((g) => `<span class="chip">${esc(g)}</span>`).join("")}</div>` : '<div class="sc-sub">None recorded.</div>'}</div>
      <div class="scope-card"><div class="scope-card-title">Candidate Weak Points</div>${r.recon.weakPoints.length ? `<div class="chips">${r.recon.weakPoints.map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</div>` : '<div class="sc-sub">None recorded.</div>'}</div>
    </div>
  </div>

  <div class="section" id="classes">
    <div class="section-header"><div class="section-num">3</div><div class="section-title">Vulnerability Categories</div><div class="section-subtitle">${classes.length} classes tested</div></div>
    <div class="matrix-wrap"><table class="matrix">
      <thead><tr><th>Vulnerability Class</th><th>Worst</th><th>Confirmed</th><th>Defended</th><th style="width:180px">Success Rate</th></tr></thead>
      <tbody>${classTable}</tbody>
    </table></div>
  </div>

  ${
    ranked.length > 0
      ? `<div class="section" id="findings"><div class="section-header"><div class="section-num">4</div><div class="section-title">Key Findings</div><div class="section-subtitle">${ranked.length} confirmed</div></div>
          <div class="findings-grid">${findingBlock(
            "Critical",
            ranked.filter((f) => f.severity === "critical"),
            "#DC2626"
          )}${findingBlock(
            "High",
            ranked.filter((f) => f.severity === "high"),
            "#EA580C"
          )}</div>
          ${
            med + low > 0
              ? `<div style="margin-top:16px" class="findings-grid">${findingBlock(
                  "Medium",
                  ranked.filter((f) => f.severity === "medium"),
                  "#D97706"
                )}${findingBlock(
                  "Low",
                  ranked.filter((f) => f.severity === "low"),
                  "#16A34A"
                )}</div>`
              : ""
          }</div>`
      : `<div class="section" id="findings"><div class="section-header"><div class="section-num">4</div><div class="section-title">Key Findings</div></div><div class="no-findings">No vulnerabilities confirmed — the target defended all evaluated vectors.</div></div>`
  }

  ${renderAttackTree(r)}

  <div class="section" id="detail">
    <div class="section-header"><div class="section-num">6</div><div class="section-title">Findings Detail</div><div class="section-subtitle">${fails.length} confirmed · ${defended.length} defended · ${errored.length} errored</div></div>
    ${detailHtml || '<div class="no-findings">No confirmed findings to detail.</div>'}
    ${defended.length ? `<div class="class-group" style="margin-top:18px"><div class="class-group-head">Defended threads (${defended.length})</div><div>${defended.map(chip).join("")}</div></div>` : ""}
    ${errored.length ? `<div class="class-group"><div class="class-group-head">Errored threads (${errored.length})</div><div>${errored.map(chip).join("")}</div></div>` : ""}
  </div>

  ${recs}
  ${patterns}

  ${strategies || decisionLog || inventions ? `<div class="section"><div class="section-header"><div class="section-num">9</div><div class="section-title">Appendices</div></div>${strategies}${decisionLog}${inventions}</div>` : ""}

</div>

<div class="report-footer"><div>Opfor Hunt · ${esc(dateStr)}</div><div class="mono">${esc(r.reportId)}</div></div>

<script>
(function(){document.querySelectorAll('.code-wrap').forEach(function(w){var p=w.querySelector('.result-code');if(p&&p.scrollHeight<=p.clientHeight+4){var f=w.querySelector('.code-fade');var m=w.querySelector('.code-more');if(f)f.style.display='none';if(m)m.style.display='none';}});})();
</script>
</body></html>`;
}

/** Ranked critical/high/etc. block for the Key Findings overview. */
function findingBlock(label: string, list: ReportFinding[], color: string): string {
  if (list.length === 0) return "";
  return `<div class="finding-block" style="border-color:${color}">
    <div class="finding-block-head"><span class="finding-label" style="color:${color}">${esc(label)}</span>
      <span class="finding-count" style="background:${color}18;color:${color};border-color:${color}44">${list.length}</span></div>
    <ol class="finding-list">
      ${list
        .map(
          (f) => `<li><strong>${esc(f.name)}</strong>
        <span class="finding-score">${f.confidence}%</span>
        <span style="color:#64748B;font-size:12px;margin-left:4px">${esc(f.vulnClassId)}${f.crossSessionCorroborated ? " · ✓corr" : ""}</span>
        ${f.evidence && f.evidence !== "N/A" ? `<div class="finding-desc">“${esc(truncate(f.evidence.replace(/\s+/g, " "), 150))}”</div>` : ""}</li>`
        )
        .join("")}
    </ol>
  </div>`;
}
