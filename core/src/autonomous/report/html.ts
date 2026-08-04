// Self-contained HTML report for the autonomous hunt runner. No external assets.
// Shares the run report's visual language (cover band, section rhythm, exec strip, safety
// gauge, transcript + turn rail) on a slightly roomier type scale, since a hunt carries more
// per screen than a suite run: cover → nav → exec summary → scope → recon → vuln-class matrix
// → findings (full transcripts) → attack tree → recommendations → appendices.

import type { AutonomousReport, ReportFinding, ReportTurn, Severity } from "./types.js";
import { renderForest } from "../state/observe.js";
import { formatStandardsLabel } from "../../evaluators/standards.js";
import {
  OPFOR_LOGO_SVG,
  LOCK_ICON,
  COPY_ICON,
  ATTACKER_ICON,
  AGENT_ICON,
  SEVERITY_ICON,
  CHEVRON_ICON,
} from "../../report/brand.js";

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

/** Format a run duration for display (e.g. 754000 → "12m 34s"). */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Map a safety score (0–100) to a red/amber/green hex colour. */
function safetyColor(score: number): string {
  if (score >= 70) return "#059669";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

const SEV_HEX: Record<Severity, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#16A34A",
};
const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** Semi-circular SVG gauge for a 0-100 percentage score. */
function gaugeSvg(pct: number, color: string): string {
  const r = 52;
  const circumference = Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<svg width="120" height="70" viewBox="0 0 120 70" style="display:block;margin:0">
    <path d="M8 64 A ${r} ${r} 0 0 1 112 64" fill="none" stroke="var(--line)" stroke-width="9" stroke-linecap="round"/>
    <path d="M8 64 A ${r} ${r} 0 0 1 112 64" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
  </svg>`;
}

/** Wall-clock run time, when the report carries a usable `startedAt` (older ones don't). */
function runDurationMs(r: AutonomousReport): number | undefined {
  if (!r.startedAt) return undefined;
  const started = Date.parse(r.startedAt);
  const ended = Date.parse(r.generatedAt);
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return undefined;
  return ended - started;
}

// ── Transcript ───────────────────────────────────────────────────

/** Role label row: icon + name. */
function roleLabel(icon: string, name: string): string {
  return `<div class="turn-role"><span class="turn-icon">${icon}</span>${name}</div>`;
}

/** One conversation turn: attacker prompt as plain text, target response as a bubble that's
 *  tinted when the judge cited this turn in `failingTurns`. `id` anchors the turn for the
 *  rail's click-to-scroll + scroll-spy. */
function renderTurn(t: ReportTurn, failing: boolean, id: string): string {
  const tags = [t.persona, t.strategy]
    .filter((x): x is string => !!x)
    .map((x) => `<span class="turn-tag">${esc(x)}</span>`)
    .join("");
  return `
    <div class="turn" id="${id}">
      <div class="turn-heading">
        <span class="turn-heading-label">Turn ${t.turnIndex}${failing ? " — breach" : ""}</span>
        <span class="turn-heading-line"></span>
        ${tags ? `<span class="turn-heading-tags">${tags}</span>` : ""}
      </div>
      <div class="turn-row attacker-row">
        ${roleLabel(ATTACKER_ICON, "Attacker")}
        <pre>${esc(truncate(t.prompt, 8000))}</pre>
      </div>
      <div class="turn-row agent-row">
        <div class="agent-bubble${failing ? " turn-highlight" : ""}">
          ${roleLabel(AGENT_ICON, "Target")}
          <pre>${esc(truncate(t.response, 8000))}</pre>
        </div>
      </div>
    </div>`;
}

/** Collapsible transcript with a turn rail. Breach turns are marked red on the rail so a long
 *  thread can be navigated straight to where it broke. */
function renderTranscript(f: ReportFinding, tId: string): string {
  if (f.turns.length === 0) return "";
  const failing = new Set(f.failingTurns ?? []);
  const turnId = (i: number): string => `${tId}-turn-${i}`;

  const rail =
    f.turns.length > 1
      ? `<div class="turn-rail-wrap"><div class="turn-rail">${f.turns
          .map((t) => {
            const bad = failing.has(t.turnIndex);
            return `<button class="turn-step${bad ? " fail-turn" : ""}" data-turn="${turnId(t.turnIndex)}" title="Jump to turn ${t.turnIndex}${bad ? " — breach" : ""}">${t.turnIndex}</button>`;
          })
          .join(
            ""
          )}</div><div class="rail-fade rail-fade-top"></div><div class="rail-fade rail-fade-bottom"></div></div>`
      : "";

  const turns = f.turns
    .map((t) => renderTurn(t, failing.has(t.turnIndex), turnId(t.turnIndex)))
    .join("");

  return `
    <div class="transcript-wrap" data-for="${tId}">
      <div class="transcript">
        <div class="transcript-header">Conversation Transcript <span class="tc-count">${f.turns.length} turn${f.turns.length === 1 ? "" : "s"}</span></div>
        <div class="transcript-body">
          ${rail}
          <div class="turn-content">${turns}</div>
        </div>
      </div>
    </div>
    <button class="transcript-toggle" data-target="${tId}">
      ${CHEVRON_ICON}
      <span class="tt-label">View more details</span>
    </button>`;
}

// ── Finding card ─────────────────────────────────────────────────

/** One finding as a card: header (severity, thread, verdict) + reasoning, evidence, self-check,
 *  confidence/standards, and the collapsible transcript. PASS/ERROR findings skip the
 *  evidence/confidence blocks, which carry no signal for a defended thread. */
function renderFindingCard(f: ReportFinding, index: number): string {
  const failed = f.verdict === "FAIL";
  const sevColor = SEV_HEX[f.severity] ?? "#64748B";
  const tId = `f${index}`;

  const verdictLabel = failed ? "Fail" : f.verdict === "PASS" ? "Pass" : "Error";
  const verdictClass = failed
    ? "verdict-fail"
    : f.verdict === "PASS"
      ? "verdict-pass"
      : "verdict-error";

  const pills = [
    `<span class="meta-pill">class: ${esc(f.vulnClassId)}</span>`,
    f.strategy ? `<span class="meta-pill">strategy: ${esc(f.strategy)}</span>` : "",
    f.personaArc.length
      ? `<span class="meta-pill">personas: ${esc(f.personaArc.join(" → "))}</span>`
      : "",
    f.gen ? `<span class="meta-pill">gen ${f.gen}</span>` : "",
    f.crossSessionCorroborated
      ? `<span class="corr-badge">✓ corroborated · ${f.corroboratingThreads?.length ?? 2} independent threads</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const evidence =
    failed && f.evidence && f.evidence !== "N/A"
      ? `<div class="detail-section"><div class="detail-section-label">Evidence — verbatim from target</div><div class="evidence-body">${esc(truncate(f.evidence, 1400))}</div></div>`
      : "";

  const sc = f.selfCheck;
  const selfCheck = sc
    ? `<div class="selfcheck"><strong>Independent verifier:</strong> ${esc(sc.verdict)} · score ${sc.score}/10 · confidence ${sc.confidence}% — ${esc(sc.reasoning)}</div>`
    : "";

  const standardsLabel = formatStandardsLabel(f.standards);
  const metaRow =
    failed || standardsLabel
      ? `<div class="eval-meta-row">
          ${failed ? `<div class="eval-meta-col"><div class="detail-section-label">Confidence</div><div class="meta-v-lg">${f.confidence}%</div></div>` : ""}
          ${standardsLabel ? `<div class="eval-meta-col standards-col"><div class="detail-section-label">Standards</div><div class="meta-v-standards">${esc(standardsLabel)}</div></div>` : ""}
        </div>`
      : "";

  return `
    <div class="eval-detail" id="finding-${index}">
      <div class="eval-summary">
        <div class="eval-summary-left">
          <span class="eval-num">${String(index + 1).padStart(2, "0")}</span>
          <div class="eval-summary-info">
            <span class="eval-summary-name">${esc(f.name || f.vulnClassId)}</span>
            <span class="eval-sep">|</span>
            <span class="sev-tag" style="color:${sevColor}">${SEVERITY_ICON}${esc(f.severity.toUpperCase())}</span>
          </div>
        </div>
        <div class="eval-summary-right">
          <span class="thread-ref">thread ${esc(f.threadId)}</span><span class="eval-sep">|</span>
          <span class="verdict-tag ${verdictClass}">${verdictLabel}</span>
        </div>
      </div>
      <div class="eval-body">
        ${pills ? `<div class="finding-meta-row">${pills}</div>` : ""}
        <div class="detail-section">
          <div class="detail-section-label">${failed ? "Why this is a finding" : "Outcome"}</div>
          <div class="detail-section-body">${esc(f.reasoning)}</div>
        </div>
        ${evidence}
        ${selfCheck}
        ${metaRow}
        ${renderTranscript(f, tId)}
      </div>
    </div>`;
}

// ── Attack tree ──────────────────────────────────────────────────

function renderAttackTree(r: AutonomousReport, num: number): string {
  if (r.findings.length === 0) return "";
  // A thread can produce several findings (multiple classes / cross-class hits), so group by
  // threadId and aggregate — otherwise a node would show only the last one.
  const byId = new Map<string, ReportFinding[]>();
  for (const f of r.findings) {
    const arr = byId.get(f.threadId);
    if (arr) arr.push(f);
    else byId.set(f.threadId, [f]);
  }
  const tree = renderForest(
    [...byId.keys()],
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
    <div class="section-header"><div class="section-num">${num}</div><div class="section-title">Attack Tree</div>
      <div class="section-subtitle">${r.summary.threads} threads · ${e.leadsFlagged} leads (${e.leadsSpawned} expanded / ${e.leadsDismissed} dropped) · depth ${e.maxDepthReached}</div></div>
    <div class="tree-card"><pre class="tree">${esc(tree)}</pre></div>
  </div>`;
}

// ── Public API ───────────────────────────────────────────────────

export function renderReportHtml(r: AutonomousReport): string {
  const now = new Date(r.generatedAt);
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const fails = r.findings.filter((f) => f.verdict === "FAIL");
  const defended = r.findings.filter((f) => f.verdict === "PASS");
  const errored = r.findings.filter((f) => f.verdict === "ERROR");
  const sevCount = (s: Severity): number => fails.filter((f) => f.severity === s).length;
  const crit = sevCount("critical");
  const high = sevCount("high");
  const med = sevCount("medium");
  const low = sevCount("low");

  const vulnerable = r.summary.confirmed > 0;
  const verdict = vulnerable ? "Vulnerable" : "Defended";
  const risk =
    crit > 0
      ? { label: "Critical Risk", color: "#991B1B" }
      : high > 0
        ? { label: "High Risk", color: "#DC2626" }
        : vulnerable
          ? { label: "Medium Risk", color: "#D97706" }
          : { label: "Low Risk", color: "#059669" };

  // Safety score mirrors the run report's 0-100 scale: the inverse of attack success.
  // N/A when nothing was conclusively scored (no confirmed and no defended threads).
  const scoreable = r.summary.confirmed + r.summary.defended;
  const safetyScore = scoreable > 0 ? 100 - r.summary.attackSuccessRate : null;
  const durationMs = runDurationMs(r);

  const ranked = [...fails].sort(
    (a, b) =>
      SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || b.confidence - a.confidence
  );
  // Confirmed first (worst severity, then confidence), then defended, then errored — every
  // thread gets a card so its transcript stays reachable even on an all-defended run.
  const ordered = [...ranked, ...defended, ...errored];

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
  const sevLegend = SEV_ORDER.map(
    (s) =>
      `<span class="sev-leg"><span class="sev-dot" style="background:${SEV_HEX[s]}"></span>${sevCount(s)} ${s}</span>`
  ).join("");

  // ── Vulnerability-class matrix ──
  const classes = [...new Set(r.findings.map((f) => f.vulnClassId))];
  const classRows = classes
    .map((cls) => {
      const rows = r.findings.filter((f) => f.vulnClassId === cls);
      const c = rows.filter((f) => f.verdict === "FAIL");
      const d = rows.filter((f) => f.verdict === "PASS").length;
      const denom = c.length + d;
      const rate = denom > 0 ? Math.round((c.length / denom) * 100) : 0;
      const worst = SEV_ORDER.find((s) => c.some((f) => f.severity === s));
      return {
        cls,
        confirmed: c.length,
        defended: d,
        rate,
        worst,
        wc: worst ? SEV_HEX[worst] : "",
      };
    })
    .sort((a, b) => b.confirmed - a.confirmed || b.rate - a.rate);
  const classTable = classRows
    .map(
      (x) => `
    <tr>
      <td><span class="mono-cls">${esc(x.cls)}</span></td>
      <td>${x.worst ? `<span class="sev-pill" style="background:${x.wc}14;color:${x.wc};border-color:${x.wc}40">${esc(x.worst)}</span>` : "—"}</td>
      <td style="font-weight:600;color:${x.confirmed > 0 ? "#DC2626" : "#059669"}">${x.confirmed}</td>
      <td style="color:#059669">${x.defended}</td>
      <td><div class="rate-cell"><div class="rate-bar"><div class="rate-fill" style="width:${x.rate}%;background:${x.rate > 0 ? "#DC2626" : "#059669"}"></div></div><span class="rate-num">${x.rate}%</span></div></td>
    </tr>`
    )
    .join("");

  const narrative = r.synthesisComplete
    ? esc(r.executiveNarrative)
    : `Assessment of <strong>${esc(r.target.name)}</strong>: <strong>${r.summary.confirmed}</strong> confirmed vulnerabilit${r.summary.confirmed === 1 ? "y" : "ies"} (${crit} critical, ${high} high) across ${r.summary.threads} attack threads — ${r.summary.attackSuccessRate}% attack-success rate.${r.truncated ? ` <em>Run truncated: ${esc(r.truncationReason ?? "")}.</em>` : ""}`;

  const outcomeLabel = r.objectiveOutcome.replace(/-/g, " ");

  // ── Section numbering + nav (both sections and links are conditional) ──
  let sectionNo = 0;
  const num = (): number => ++sectionNo;
  const nav: string[] = [];
  const link = (href: string, label: string): void => {
    nav.push(`<a href="#${href}">${label}</a>`);
  };

  const execNo = num();
  link("exec", "Summary");
  const scopeNo = num();
  link("scope", "Scope");
  const reconNo = num();
  link("recon", "Recon");
  const classesNo = classes.length > 0 ? num() : 0;
  if (classesNo) link("classes", "Categories");
  const findingsNo = num();
  link("findings", "Findings");
  const treeNo = r.findings.length > 0 ? num() : 0;
  if (treeNo) link("tree", "Attack Tree");
  const recsNo = r.recommendations.length > 0 ? num() : 0;
  if (recsNo) link("recs", "Recommendations");
  const hasAppendix =
    r.responsePatterns.length > 0 ||
    r.inventions.length > 0 ||
    r.decisionLog.length > 0 ||
    r.strategiesUsed.length > 0;
  const appendixNo = hasAppendix ? num() : 0;
  if (appendixNo) link("appendix", "Appendices");

  // ── Appendices ──
  const patterns = r.responsePatterns.length
    ? `<details class="appendix"><summary>Response Patterns (${r.responsePatterns.length})${CHEVRON_ICON}</summary><div class="appendix-body"><table class="kv">${r.responsePatterns
        .map(
          (p) => `<tr><td class="kv-k">${esc(p.pattern)}</td><td>${esc(p.observation)}</td></tr>`
        )
        .join("")}</table></div></details>`
    : "";
  const inventions = r.inventions.length
    ? `<details class="appendix"><summary>Novel Techniques Invented (${r.inventions.length})${CHEVRON_ICON}</summary><div class="appendix-body"><ul class="inv-list">${r.inventions
        .map(
          (i) => `<li><strong>${esc(i.kind)}: ${esc(i.name)}</strong> — ${esc(i.description)}</li>`
        )
        .join("")}</ul></div></details>`
    : "";
  const strategies = r.strategiesUsed.length
    ? `<details class="appendix"><summary>Strategies Used (${r.strategiesUsed.length})${CHEVRON_ICON}</summary><div class="appendix-body"><div class="chips">${r.strategiesUsed
        .map((s) => `<span class="chip">${esc(s)}</span>`)
        .join("")}</div></div></details>`
    : "";
  const decisionLog = r.decisionLog.length
    ? `<details class="appendix"><summary>Decision Log (${r.decisionLog.length})${CHEVRON_ICON}</summary><div class="appendix-body">${r.decisionLog
        .map(
          (d) =>
            `<div class="decision"><span class="decision-action decision-${esc(d.action)}">${esc(d.action)}</span>${d.threadId ? `<span class="mono decision-thread">${esc(d.threadId)}</span>` : ""}${esc(d.rationale)}</div>`
        )
        .join("")}</div></details>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Opfor Hunt Report — ${esc(r.target.name)}</title>
<style>
  :root{
    --bg:#F8FAFC;--surface:#FFFFFF;--surface-rgb:255,255,255;--surface-2:#F1F5F9;
    --text:#0F172A;--text-2:#334155;--muted:#64748B;--muted-2:#94A3B8;
    --line:#E2E8F0;--line-2:#CBD5E1;
    --pass:#059669;--pass-bg:#D1FAE5;--pass-border:#6EE7B7;
    --fail:#DC2626;--fail-bg:#FEE2E2;--fail-border:#FCA5A5;
    --accent:#FF4D4F;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{background:var(--bg);scroll-behavior:smooth}
  body{color:var(--text);font:15px/1.65 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);padding:0 0 60px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

  .page{max-width:1080px;margin:0 auto;padding:0 28px}

  /* ── Cover band ── */
  .cover{background:#000;color:#fff;padding:0}
  .cover-inner{max-width:1080px;margin:0 auto;padding:42px 28px 38px}
  .cover-top{display:flex;align-items:flex-start;justify-content:space-between;gap:28px;margin-bottom:22px}
  .cover-title{font-size:30px;font-weight:700;color:#fff;letter-spacing:-0.01em}
  .cover-subtitle{font-size:14.5px;color:#A8B2C1;margin-top:7px;max-width:760px;line-height:1.65}
  .cover-badges-row{display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap}
  .badge-confidential{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;padding:5px 12px;border-radius:6px;font-size:11.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase}
  .badge-mode{display:inline-flex;align-items:center;gap:6px;background:#262626;border:1px solid #3a3a3a;color:#E2E8F0;padding:5px 12px;border-radius:6px;font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase}
  .reportid-chip{display:inline-flex;align-items:center;gap:8px;background:#262626;border:1px solid #3a3a3a;color:#D4D4D4;padding:6px 11px;border-radius:6px;font-size:11.5px}
  .reportid-chip .mono{color:#fff}
  .copy-btn{background:none;border:none;color:#9CA3AF;cursor:pointer;padding:2px;display:flex;align-items:center;border-radius:3px}
  .copy-btn:hover{color:#fff;background:rgba(255,255,255,0.1)}
  .cover-date{font-size:12.5px;color:#9CA3AF}
  .cover-meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden}
  .cover-meta-item{padding:17px 20px;border-right:1px solid rgba(255,255,255,0.08)}
  .cover-meta-item:last-child{border-right:none}
  .cover-meta-k{font-size:11.5px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px}
  .cover-meta-v{font-size:14.5px;color:#E2E8F0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* ── Sticky nav ── */
  .nav{position:sticky;top:0;z-index:20;background:rgba(248,250,252,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);margin-bottom:32px}
  .nav-inner{max-width:1080px;margin:0 auto;padding:0 28px;display:flex;gap:3px;flex-wrap:wrap;align-items:center;height:52px}
  .nav a{font-size:13px;font-weight:500;color:var(--text-2);padding:7px 12px;border-radius:7px}
  .nav a:hover{background:var(--surface-2);color:var(--text);text-decoration:none}
  .nav .nav-verdict{margin-left:auto;font-size:11.5px;font-weight:700;letter-spacing:.04em;padding:4px 12px;border-radius:999px;white-space:nowrap;text-transform:uppercase}

  /* ── Section header ── */
  .section{margin-bottom:46px;scroll-margin-top:68px}
  .section-header{display:flex;align-items:center;gap:11px;margin-bottom:20px;padding-bottom:13px;border-bottom:1px solid var(--line)}
  .section-num{width:25px;height:25px;border-radius:7px;background:var(--accent);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .section-title{font-size:17.5px;font-weight:700;color:var(--text);letter-spacing:-0.01em}
  .section-subtitle{font-size:12.5px;color:var(--muted);margin-left:auto;text-align:right}

  /* ── Executive summary strip ── */
  .exec-strip{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden;margin-bottom:12px}
  /* flex-start, not center: the four cards hold different amounts of content, and centering
     each one vertically would land every label at a different height. */
  .exec-strip-item{flex:1;padding:22px 24px;border-right:1px solid var(--line);display:flex;flex-direction:column;justify-content:flex-start;min-width:0}
  .exec-strip-item:last-child{border-right:none}
  .exec-strip-label{font-size:11.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
  .exec-verdict-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .exec-verdict-text{font-size:31px;font-weight:800;letter-spacing:0.02em;line-height:1}
  .exec-verdict-text.pass{color:var(--pass)}
  .exec-verdict-text.fail{color:var(--fail)}
  .exec-risk{font-size:11.5px;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid;white-space:nowrap;cursor:default}
  /* Width matches the gauge so the value centres under the arc while the block itself stays
     left-aligned with the label, like every other card in the strip. */
  .gauge-value{font-size:24px;font-weight:800;color:var(--text);width:120px;text-align:center;margin-top:-30px}
  .sc-value{font-size:29px;font-weight:800;line-height:1;color:var(--text)}
  .sc-dots{display:flex;flex-direction:column;gap:3px;margin-top:8px}
  .sc-dot-row{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted)}
  .sc-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .sc-sub{font-size:12.5px;color:var(--muted);margin-top:5px}
  .summary-narrative{font-size:14.5px;color:var(--text-2);line-height:1.78;padding:6px 2px}
  .summary-narrative strong{color:var(--text)}

  /* ── Severity distribution ── */
  .sevbar-wrap{margin:14px 0 4px}
  .sevbar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--surface-2);border:1px solid var(--line)}
  .sevbar-seg{min-width:3px}
  .sev-legend{display:flex;gap:20px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--muted)}
  .sev-leg{display:flex;align-items:center;gap:6px}
  .sev-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}

  /* ── Scope / recon cards ── */
  .scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .scope-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:19px}
  .scope-card-title{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--muted);margin-bottom:15px}
  .scope-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
  .scope-row:last-child{border-bottom:none}
  .scope-k{font-size:13px;color:var(--muted);flex-shrink:0}
  .scope-v{font-size:13px;color:var(--text);font-weight:500;text-align:right;word-break:break-word;max-width:60%}
  .scope-v.mono{font-size:12px}
  .scope-full{grid-column:1/-1}
  .scope-text{font-size:14px;color:var(--text-2);line-height:1.72}
  .agent-role{display:block;font-size:11px;color:var(--muted-2);font-weight:400;margin-top:1px}
  .chips{display:flex;flex-wrap:wrap;gap:7px}
  .chip{font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--text-2)}

  /* ── Badges ── */
  .eval-sep{color:var(--line-2);font-weight:400}
  .sev-tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;letter-spacing:0.04em;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .sev-pill{display:inline-block;padding:3px 9px;border:1px solid;border-radius:5px;font-size:11.5px;font-weight:700;text-transform:capitalize;white-space:nowrap}
  .verdict-tag{font-size:19px;font-weight:800;letter-spacing:0.01em}
  .verdict-pass{color:var(--pass)}
  .verdict-fail{color:var(--fail)}
  .verdict-error{color:#D97706}
  .pass-text{color:var(--pass);font-weight:600}

  /* ── Vulnerability matrix ── */
  .matrix-wrap{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  table.matrix{width:100%;border-collapse:collapse}
  table.matrix th{background:var(--surface-2);padding:12px 16px;text-align:left;font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--line)}
  table.matrix td{padding:14px 16px;font-size:13.5px;border-bottom:1px solid var(--line);vertical-align:middle}
  table.matrix tr:last-child td{border-bottom:none}
  table.matrix tr:hover td{background:var(--surface-2)}
  .mono-cls{font-family:ui-monospace,monospace;font-size:13px;font-weight:600}
  .rate-cell{display:flex;align-items:center;gap:8px}
  .rate-bar{flex:1;height:6px;background:var(--line);border-radius:3px;overflow:hidden;min-width:60px}
  .rate-fill{height:100%;border-radius:3px}
  .rate-num{font-size:12.5px;font-weight:600;color:var(--text-2);width:34px;text-align:right}

  /* ── Finding cards ── */
  .eval-detail{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:12px}
  .eval-summary{display:flex;align-items:center;justify-content:space-between;padding:17px 19px;gap:14px;flex-wrap:wrap}
  .eval-summary-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
  .eval-num{font-size:11.5px;font-family:ui-monospace,monospace;color:var(--muted-2);flex-shrink:0;width:24px}
  .eval-summary-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .eval-summary-name{font-size:18.5px;font-weight:700;color:var(--text)}
  .eval-summary-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .thread-ref{font-size:12.5px;color:var(--muted);font-family:ui-monospace,monospace}
  .eval-body{padding:22px 19px}
  .detail-section{margin-bottom:22px}
  .detail-section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-2);margin-bottom:10px}
  .detail-section-body{font-size:14.5px;color:var(--text-2);line-height:1.72;white-space:pre-wrap;word-break:break-word}
  .evidence-body{font-size:14.5px;color:#7f1d1d;line-height:1.72;white-space:pre-wrap;word-break:break-word;background:#FFF5F5;border:1px solid var(--fail-border);border-radius:8px;padding:14px 16px}
  .selfcheck{margin:0 0 22px;font-size:13.5px;color:var(--text-2);background:var(--surface-2);border:1px dashed var(--line-2);border-radius:8px;padding:12px 14px;line-height:1.65}
  .eval-meta-row{display:flex;flex-wrap:wrap;gap:40px;margin-bottom:18px}
  .eval-meta-col{display:flex;flex-direction:column;gap:6px}
  .eval-meta-col .meta-v-lg{font-size:22px;font-weight:700;color:var(--text);line-height:1}
  .eval-meta-col.standards-col{margin-left:20px}
  .eval-meta-col .meta-v-standards{font-size:13.5px;color:var(--text-2);line-height:1.5}
  .finding-meta-row{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px;align-items:center}
  .meta-pill{font-size:11.5px;color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:5px;padding:3px 10px}
  .corr-badge{font-size:11.5px;color:var(--pass);background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:5px;padding:3px 10px;font-weight:600}

  /* ── Transcript ── */
  .transcript-toggle{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;color:var(--muted);background:none;border:none;cursor:pointer;padding:15px 0 0;margin-top:2px;border-top:1px solid var(--line);width:100%}
  .transcript-toggle:hover{color:var(--text)}
  .transcript-toggle svg{transition:transform 0.2s}
  .transcript-wrap{display:none;margin-bottom:8px}
  .transcript-wrap.open{display:block}
  .transcript{border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .transcript-header{padding:11px 15px;background:var(--surface-2);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
  .tc-count{font-weight:400;color:var(--muted-2)}
  .transcript-body{position:relative;display:flex;align-items:flex-start;gap:18px;padding:15px 15px 15px 0;max-height:620px;overflow-y:auto;overscroll-behavior:contain}
  .turn-rail-wrap{position:sticky;top:4px;flex-shrink:0;align-self:flex-start}
  .turn-rail{display:flex;flex-direction:column;align-items:center;gap:17px;padding:4px 0 4px 14px;max-height:574px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none}
  .turn-rail::-webkit-scrollbar{display:none}
  /* Spans ~2 button pitches so the fade starts a button early and builds gradually; no opaque
     plateau and a capped peak, so the edge button stays readable instead of being erased. */
  .rail-fade{position:absolute;left:0;right:0;height:74px;pointer-events:none;opacity:0;transition:opacity .18s}
  .rail-fade.visible{opacity:1}
  .rail-fade-top{top:0;background:linear-gradient(to bottom,rgba(var(--surface-rgb),0.82) 0%,rgba(var(--surface-rgb),0.44) 34%,rgba(var(--surface-rgb),0.13) 66%,rgba(var(--surface-rgb),0) 100%)}
  .rail-fade-bottom{bottom:0;background:linear-gradient(to top,rgba(var(--surface-rgb),0.82) 0%,rgba(var(--surface-rgb),0.44) 34%,rgba(var(--surface-rgb),0.13) 66%,rgba(var(--surface-rgb),0) 100%)}
  /* flex:0 0 is load-bearing — without it the column squeezes every button toward its text
     height to fit max-height, instead of overflowing and scrolling. */
  .turn-step{position:relative;flex:0 0 26px;width:26px;height:26px;min-height:26px;border-radius:7px;border:1px solid var(--line-2);background:var(--surface);color:var(--muted);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
  .turn-step:hover{border-color:var(--muted-2);color:var(--text)}
  .turn-step.fail-turn{border-color:var(--fail);color:var(--fail);background:var(--fail-bg);font-weight:800}
  .turn-step.active{box-shadow:0 0 0 2px rgba(15,23,42,0.16)}
  .turn-step.fail-turn.active{box-shadow:0 0 0 2px rgba(220,38,38,0.3)}
  .turn-step:not(:first-child)::before{content:"";position:absolute;bottom:100%;left:50%;transform:translateX(-50%);width:1px;height:17px;background:var(--line-2)}
  .turn-content{flex:1;min-width:0}
  .turn{padding:0 0 28px}
  .turn:last-child{padding-bottom:0}
  .turn-heading{display:flex;align-items:center;gap:11px;margin-bottom:12px;flex-wrap:wrap}
  .turn-heading-label{font-size:11.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
  .turn-heading-line{flex:1;height:1px;background:var(--line);min-width:20px}
  .turn-heading-tags{display:flex;gap:6px;flex-wrap:wrap}
  .turn-tag{font-size:11px;font-weight:600;color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:4px;padding:2px 8px;font-family:ui-monospace,monospace}
  .turn-row{padding:2px 18px}
  .turn-row.attacker-row{padding-left:64px}
  .turn-row.agent-row{margin-top:12px}
  .turn-role{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:8px}
  .turn-role .turn-icon{display:inline-flex;align-items:center}
  .turn-row pre{margin:0;white-space:pre-wrap;word-break:break-word;font:14px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text-2)}
  .agent-bubble{display:inline-block;max-width:82%;background:var(--surface-2);border-radius:10px;padding:13px 16px}
  .agent-bubble.turn-highlight{background:var(--fail-bg);border:1px dashed var(--fail-border)}

  /* ── Attack tree ── */
  .tree-card{background:#0b1020;border:1px solid var(--line);border-radius:10px;padding:19px 21px;overflow-x:auto}
  .tree{color:#e2e8f0;font-size:13px;line-height:1.75;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}

  /* ── Recommendations + appendices ── */
  .rec-list{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:12px;font-size:14.5px;color:var(--text-2);line-height:1.72}
  .appendix{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:10px;overflow:hidden}
  .appendix>summary{padding:16px 19px;cursor:pointer;font-size:14.5px;font-weight:600;list-style:none;display:flex;align-items:center;gap:8px}
  .appendix>summary::-webkit-details-marker{display:none}
  .appendix>summary:hover{background:var(--surface-2)}
  .appendix>summary svg{margin-left:auto;color:var(--muted-2);transition:transform .2s}
  .appendix[open]>summary svg{transform:rotate(180deg)}
  .appendix-body{padding:0 19px 17px;font-size:13.5px;color:var(--text-2)}
  .inv-list{padding-left:18px;display:flex;flex-direction:column;gap:9px;line-height:1.65}
  table.kv{width:100%;border-collapse:collapse}
  table.kv td{padding:12px 0;font-size:13.5px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.65}
  table.kv tr:last-child td{border-bottom:none}
  .kv-k{font-weight:600;padding-right:18px;color:var(--text);width:250px}
  .decision{padding:10px 0;border-top:1px solid var(--line);line-height:1.62}
  .decision:first-child{border-top:none}
  .decision-action{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:4px;margin-right:7px;background:var(--surface-2);border:1px solid var(--line)}
  .decision-thread{margin-right:7px;color:var(--muted)}
  .decision-fork{color:#7c3aed}.decision-dispatch{color:#2563eb}.decision-stop{color:var(--fail)}.decision-pivot{color:#d97706}.decision-continue{color:var(--muted)}
  .no-findings{background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:10px;padding:20px;text-align:center;color:var(--pass);font-weight:600;font-size:14px}

  /* ── Footer ── */
  .report-footer{max-width:1080px;margin:48px auto 0;padding:20px 28px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:12.5px;color:var(--muted)}
  .footer-right{font-size:12.5px;color:var(--muted-2);font-family:ui-monospace,monospace}

  @media print{
    body{background:#fff;padding:0}
    .nav{display:none}
    .cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .scope-card,.eval-detail,.exec-strip,.matrix-wrap{break-inside:avoid;box-shadow:none}
    .transcript-body{max-height:none;overflow:visible}
    .turn-rail-wrap{position:static}
    .turn-rail{max-height:none;overflow:visible}
    .rail-fade{display:none}
  }
  @media(max-width:820px){
    .cover-meta{grid-template-columns:1fr}
    .exec-strip{flex-direction:column}
    .exec-strip-item{border-right:none;border-bottom:1px solid var(--line)}
    .exec-strip-item:last-child{border-bottom:none}
    .scope-grid{grid-template-columns:1fr}
    .eval-meta-row{gap:20px}
    .turn-rail-wrap{display:none}
    .transcript-body{padding-left:15px}
    .turn-row.attacker-row{padding-left:18px}
  }
</style>
</head>
<body>

<div class="cover">
  <div class="cover-inner">
    <div class="cover-top">
      <div>
        <div class="cover-title">Autonomous Hunt Assessment Report</div>
        <div class="cover-subtitle">${esc(r.objective)}</div>
      </div>
      ${OPFOR_LOGO_SVG}
    </div>
    <div class="cover-badges-row">
      <span class="badge-confidential">${LOCK_ICON} Confidential</span>
      <span class="badge-mode">Autonomous Hunt</span>
      <span class="reportid-chip">Report ID: <span class="mono">${esc(r.reportId.slice(0, 13))}</span>
        <button class="copy-btn" data-copy="${esc(r.reportId)}" title="Copy report ID">${COPY_ICON}</button>
      </span>
      <span class="cover-date">${esc(dateStr)}, ${esc(timeStr)}</span>
    </div>
    <div class="cover-meta">
      <div class="cover-meta-item"><div class="cover-meta-k">Target System</div><div class="cover-meta-v" title="${esc(r.target.name)} — ${esc(r.target.endpoint)}">${esc(truncate(r.target.name, 40))}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Objective Outcome</div><div class="cover-meta-v" style="text-transform:capitalize">${esc(outcomeLabel)}</div></div>
      <div class="cover-meta-item"><div class="cover-meta-k">Run Cost</div><div class="cover-meta-v">${r.totalCostUsd !== undefined ? "$" + r.totalCostUsd.toFixed(2) : "—"}</div></div>
    </div>
  </div>
</div>

<nav class="nav"><div class="nav-inner">
  ${nav.join("")}
  <span class="nav-verdict" style="background:${risk.color}14;color:${risk.color};border:1px solid ${risk.color}40">${verdict}</span>
</div></nav>

<div class="page">

  <div class="section" id="exec">
    <div class="section-header">
      <div class="section-num">${execNo}</div>
      <div class="section-title">Executive Summary</div>
    </div>
    <div class="exec-strip">
      <div class="exec-strip-item">
        <div class="exec-strip-label">Overall Verdict</div>
        <div class="exec-verdict-row">
          <div class="exec-verdict-text ${vulnerable ? "fail" : "pass"}">${verdict}</div>
          <div class="exec-risk" title="Overall risk status derived from confirmed-finding severities" style="color:${risk.color};border-color:${risk.color}66;background:${risk.color}14">${risk.label.toUpperCase()}</div>
        </div>
        <div class="sc-sub" style="text-transform:capitalize">Objective ${esc(outcomeLabel)}${r.truncated ? " · run truncated" : ""}</div>
      </div>
      <div class="exec-strip-item">
        <div class="exec-strip-label">Safety Score</div>
        ${gaugeSvg(safetyScore ?? 0, safetyScore === null ? "#94A3B8" : safetyColor(safetyScore))}
        <div class="gauge-value">${safetyScore === null ? "N/A" : `${safetyScore}%`}</div>
      </div>
      <div class="exec-strip-item">
        <div class="exec-strip-label">Attack Threads</div>
        <div class="sc-value">${r.summary.threads}</div>
        <div class="sc-dots">
          <div class="sc-dot-row"><span class="sc-dot" style="background:var(--fail)"></span>${r.summary.confirmed} confirmed</div>
          <div class="sc-dot-row"><span class="sc-dot" style="background:var(--pass)"></span>${r.summary.defended} defended</div>
          ${r.summary.errors > 0 ? `<div class="sc-dot-row"><span class="sc-dot" style="background:#D97706"></span>${r.summary.errors} errored</div>` : ""}
        </div>
      </div>
      <div class="exec-strip-item">
        <div class="exec-strip-label">Attack Success</div>
        <div class="sc-value" style="color:${r.summary.attackSuccessRate > 0 ? "var(--fail)" : "var(--pass)"}">${r.summary.attackSuccessRate}%</div>
        <div class="sc-sub">${durationMs !== undefined ? `${formatDuration(durationMs)} wall clock` : `${classes.length} class${classes.length === 1 ? "" : "es"} tested`}</div>
      </div>
    </div>
    ${vulnerable && sevSeg ? `<div class="sevbar-wrap"><div class="sevbar">${sevSeg}</div><div class="sev-legend">${sevLegend}</div></div>` : ""}
    <div class="summary-narrative">${narrative}</div>
  </div>

  <div class="section" id="scope">
    <div class="section-header">
      <div class="section-num">${scopeNo}</div>
      <div class="section-title">Assessment Scope</div>
    </div>
    <div class="scope-grid">
      <div class="scope-card">
        <div class="scope-card-title">Target</div>
        <div class="scope-row"><span class="scope-k">System</span><span class="scope-v">${esc(r.target.name)}</span></div>
        <div class="scope-row"><span class="scope-k">Endpoint</span><span class="scope-v mono">${esc(truncate(r.target.endpoint, 60))}</span></div>
        <div class="scope-row"><span class="scope-k">Vuln Classes Tested</span><span class="scope-v">${classes.length}</span></div>
        <div class="scope-row"><span class="scope-k">Recon Probes</span><span class="scope-v">${r.recon.probeCount}</span></div>
      </div>
      <div class="scope-card">
        <div class="scope-card-title">Attack Agents</div>
        <div class="scope-row"><span class="scope-k">Commander <span class="agent-role">plans &amp; synthesizes</span></span><span class="scope-v mono">${esc(r.commanderModel || "—")}</span></div>
        <div class="scope-row"><span class="scope-k">Operator <span class="agent-role">runs attack threads</span></span><span class="scope-v mono">${esc(r.operatorModel || "—")}</span></div>
        <div class="scope-row"><span class="scope-k">Scout <span class="agent-role">recon &amp; lead triage</span></span><span class="scope-v mono">${esc(r.scoutModel || "—")}</span></div>
        <div class="scope-row"><span class="scope-k">Verifier <span class="agent-role">independent self-check</span></span><span class="scope-v mono">${esc(r.verifierModel || r.commanderModel || "—")}</span></div>
      </div>
      <div class="scope-card">
        <div class="scope-card-title">Exploration</div>
        <div class="scope-row"><span class="scope-k">Attack Threads</span><span class="scope-v">${r.summary.threads}</span></div>
        <div class="scope-row"><span class="scope-k">Leads Flagged</span><span class="scope-v">${r.exploration.leadsFlagged}</span></div>
        <div class="scope-row"><span class="scope-k">Leads Expanded / Dismissed</span><span class="scope-v">${r.exploration.leadsSpawned} / ${r.exploration.leadsDismissed}</span></div>
        <div class="scope-row"><span class="scope-k">Max Depth Reached</span><span class="scope-v">${r.exploration.maxDepthReached}${r.exploration.maxDepthReached === 0 ? " (root wave only)" : ""}</span></div>
      </div>
      <div class="scope-card">
        <div class="scope-card-title">Run</div>
        <div class="scope-row"><span class="scope-k">Total Cost</span><span class="scope-v">${r.totalCostUsd !== undefined ? "$" + r.totalCostUsd.toFixed(2) : "—"}</span></div>
        <div class="scope-row"><span class="scope-k">Duration</span><span class="scope-v">${durationMs !== undefined ? formatDuration(durationMs) : "—"}</span></div>
        <div class="scope-row"><span class="scope-k">Truncated</span><span class="scope-v">${r.truncated ? esc(r.truncationReason ?? "Yes") : "No"}</span></div>
        <div class="scope-row"><span class="scope-k">Commander Synthesis</span><span class="scope-v ${r.synthesisComplete ? "pass-text" : ""}">${r.synthesisComplete ? "Complete" : "Not submitted"}</span></div>
      </div>
    </div>
  </div>

  <div class="section" id="recon">
    <div class="section-header">
      <div class="section-num">${reconNo}</div>
      <div class="section-title">Reconnaissance</div>
      <div class="section-subtitle">${r.recon.probeCount} benign probe${r.recon.probeCount === 1 ? "" : "s"}</div>
    </div>
    <div class="scope-card scope-full" style="margin-bottom:14px">
      <div class="scope-card-title">Fingerprint</div>
      <div class="scope-text">${esc(r.recon.fingerprint)}</div>
    </div>
    <div class="scope-grid">
      <div class="scope-card">
        <div class="scope-card-title">Observed Guardrails</div>
        ${r.recon.guardrails.length ? `<div class="chips">${r.recon.guardrails.map((g) => `<span class="chip">${esc(g)}</span>`).join("")}</div>` : '<div class="sc-sub">None recorded.</div>'}
      </div>
      <div class="scope-card">
        <div class="scope-card-title">Candidate Weak Points</div>
        ${r.recon.weakPoints.length ? `<div class="chips">${r.recon.weakPoints.map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</div>` : '<div class="sc-sub">None recorded.</div>'}
      </div>
    </div>
  </div>

  ${
    classesNo
      ? `<div class="section" id="classes">
    <div class="section-header">
      <div class="section-num">${classesNo}</div>
      <div class="section-title">Vulnerability Categories</div>
      <div class="section-subtitle">${classes.length} class${classes.length === 1 ? "" : "es"} tested</div>
    </div>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th>Vulnerability Class</th><th>Worst</th><th>Confirmed</th><th>Defended</th><th style="width:180px">Success Rate</th></tr></thead>
        <tbody>${classTable}</tbody>
      </table>
    </div>
  </div>`
      : ""
  }

  <div class="section" id="findings">
    <div class="section-header">
      <div class="section-num">${findingsNo}</div>
      <div class="section-title">Findings</div>
      <div class="section-subtitle">${fails.length} confirmed · ${defended.length} defended${errored.length ? ` · ${errored.length} errored` : ""}${fails.length ? ` · <span style="color:var(--fail);font-weight:700">red</span> rail marker = breach turn` : ""}</div>
    </div>
    ${ordered.length ? ordered.map((f, i) => renderFindingCard(f, i)).join("") : '<div class="no-findings">No attack threads were recorded for this run.</div>'}
  </div>

  ${treeNo ? renderAttackTree(r, treeNo) : ""}

  ${
    recsNo
      ? `<div class="section" id="recs">
    <div class="section-header"><div class="section-num">${recsNo}</div><div class="section-title">Recommendations</div></div>
    <div class="scope-card scope-full"><ol class="rec-list">${r.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
  </div>`
      : ""
  }

  ${
    appendixNo
      ? `<div class="section" id="appendix">
    <div class="section-header"><div class="section-num">${appendixNo}</div><div class="section-title">Appendices</div></div>
    ${patterns}${inventions}${strategies}${decisionLog}
  </div>`
      : ""
  }

</div>

<div class="report-footer">
  <div class="footer-left">Generated by Opfor · Autonomous Hunt · ${esc(dateStr)}</div>
  <div class="footer-right">${esc(r.reportId)}</div>
</div>

<script>
(function(){
  document.querySelectorAll('.copy-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      navigator.clipboard.writeText(btn.dataset.copy || '');
      var svg = btn.querySelector('svg');
      if (svg) svg.style.color = '#4ADE80';
    });
  });

  // The rail scrolls independently of the transcript, so on a long thread turns can be hidden
  // above and/or below its viewport. Fade whichever edge is currently hiding turns.
  function refreshRailFade(body){
    var rail = body.querySelector('.turn-rail');
    var wrap = body.querySelector('.turn-rail-wrap');
    if (!rail || !wrap) return;
    var top = wrap.querySelector('.rail-fade-top');
    var bottom = wrap.querySelector('.rail-fade-bottom');
    if (top) top.classList.toggle('visible', rail.scrollTop > 2);
    if (bottom) bottom.classList.toggle('visible', rail.scrollTop + rail.clientHeight < rail.scrollHeight - 2);
  }

  // Keep the scroll-spy's active step inside the rail's viewport, clear of the fade gradient.
  function revealStep(rail, step){
    if (!rail || !step) return;
    var pad = 26;
    var above = step.offsetTop - rail.offsetTop;
    var below = above + step.offsetHeight;
    if (above - pad < rail.scrollTop) rail.scrollTop = above - pad;
    else if (below + pad > rail.scrollTop + rail.clientHeight) rail.scrollTop = below + pad - rail.clientHeight;
  }

  document.querySelectorAll('.transcript-toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var wrap = btn.closest('.eval-body').querySelector('.transcript-wrap[data-for="' + btn.dataset.target + '"]');
      if(!wrap) return;
      var open = wrap.classList.toggle('open');
      btn.querySelector('.tt-label').textContent = open ? 'View less details' : 'View more details';
      btn.querySelector('svg').style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
      if (open) {
        requestAnimationFrame(function(){
          var flagged = wrap.querySelector('.turn-highlight');
          if (flagged) flagged.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var body = wrap.querySelector('.transcript-body');
          if (body) refreshRailFade(body);
        });
      }
    });
  });

  document.querySelectorAll('.transcript-body').forEach(function(body){
    var steps = body.querySelectorAll('.turn-step');
    if (!steps.length) return;
    var rail = body.querySelector('.turn-rail');
    var turns = body.querySelectorAll('.turn[id]');
    var inView = {};
    var setActive = function(id){
      steps.forEach(function(s){
        var on = s.dataset.turn === id;
        s.classList.toggle('active', on);
        if (on) revealStep(rail, s);
      });
    };
    steps.forEach(function(step){
      step.addEventListener('click', function(){
        var target = document.getElementById(step.dataset.turn);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        inView[entry.target.id] = entry.isIntersecting;
      });
      var topmost = null;
      turns.forEach(function(t){ if (!topmost && inView[t.id]) topmost = t.id; });
      if (topmost) setActive(topmost);
      refreshRailFade(body);
    }, { root: body, threshold: 0.4 });
    turns.forEach(function(t){ observer.observe(t); });
    if (rail) rail.addEventListener('scroll', function(){ refreshRailFade(body); });
    body.addEventListener('scroll', function(){ refreshRailFade(body); });
  });
})();
</script>
</body>
</html>`;
}
