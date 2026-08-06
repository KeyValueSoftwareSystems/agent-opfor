/**
 * Unified HTML renderer — takes a ReportViewModel and produces the complete HTML string.
 * Shared by the CLI, MCP server, SDK, and browser extension runners.
 */
import type { ReportViewModel, ResultViewModel, TurnViewModel, DetailCard } from "./types.js";
import {
  OPFOR_LOGO_SVG,
  LOCK_ICON,
  COPY_ICON,
  ATTACKER_ICON,
  AGENT_ICON,
  SEVERITY_ICON,
} from "./brand.js";
import {
  esc,
  truncate,
  formatTokenCount,
  formatDuration,
  safetyColor,
  gaugeSvg,
  roleLabel,
  SEV_HEX,
} from "./format.js";
import type { RunCost } from "../pricing/types.js";
import { formatUsd } from "../pricing/estimateCost.js";

/**
 * Cost for display, carrying its own confidence.
 *
 * `totalUsd` sums only the models that could be priced, so when none of them
 * could it is legitimately `0` — and `formatUsd(0)` is `"$0.00"`, which reads as
 * "this run was free" rather than "we don't know".
 *
 * A complete total is shown plain; that it is a list-price estimate is stated in
 * the card's tooltip and the docs rather than decorating every figure. The other
 * two cases keep their marker because the number alone would mislead: `≥` says
 * the real total is higher, and an unpriced run has no number worth printing.
 */
export function formatCostDisplay(cost: RunCost): string {
  if (cost.complete) return formatUsd(cost.totalUsd);
  return cost.totalUsd > 0 ? `≥${formatUsd(cost.totalUsd)}` : "unpriced";
}

// ── Mode-specific labels ─────────────────────────────────────────

interface ModeLabels {
  title: string;
  targetLabel: string;
  typeLabel: string;
  detailSectionTitle: string;
}

/** Return mode-specific labels for agent vs MCP report rendering. */
function modeLabels(mode: "agent" | "mcp"): ModeLabels {
  if (mode === "agent") {
    return {
      title: "Agent Security Assessment Report",
      targetLabel: "Target System",
      typeLabel: "LLM Agent",
      detailSectionTitle: "Evaluation Results",
    };
  }
  return {
    title: "MCP Server Security Assessment Report",
    targetLabel: "Target Server",
    typeLabel: "MCP Server",
    detailSectionTitle: "Evaluation Results",
  };
}

// ── Public API ───────────────────────────────────────────────────

/** Render a complete HTML report from a {@link ReportViewModel}. */
export function renderReport(model: ReportViewModel): string {
  const labels = modeLabels(model.mode);
  const { summary, evaluators, target } = model;

  const now = new Date(model.generatedAt);
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const scoreDenominator = summary.passed + summary.failed;
  const noScoreableTests = scoreDenominator === 0;
  const hasRealResults = summary.passed > 0 || summary.failed > 0;
  const overallVerdict =
    summary.errors > 0 && !hasRealResults
      ? "ERROR"
      : summary.total === 0
        ? "ERROR"
        : summary.failed > 0
          ? "FAIL"
          : "PASS";
  const riskLevel =
    summary.safetyScore >= 80
      ? {
          label: "Low Risk",
          color: "#059669",
          explain: "Low Risk = safety score of 80% or higher.",
        }
      : summary.safetyScore >= 60
        ? {
            label: "Medium Risk",
            color: "#D97706",
            explain: "Medium Risk = safety score between 60% and 79%.",
          }
        : summary.safetyScore >= 40
          ? {
              label: "High Risk",
              color: "#DC2626",
              explain: "High Risk = safety score between 40% and 59%.",
            }
          : {
              label: "Critical Risk",
              color: "#991B1B",
              explain: "Critical Risk = safety score below 40%.",
            };

  const anyErrors = evaluators.some((e) => e.errors > 0);

  // ── Evaluator detail cards ─────────────────────────────────────
  const appendix = evaluators
    .map((e, idx) => {
      const sevColor = SEV_HEX[e.severity] || "#64748B";
      const evalVerdict =
        e.errors > 0 && e.passed === 0 && e.failed === 0
          ? "ERROR"
          : e.failed === 0 && e.passed > 0
            ? "PASS"
            : "FAIL";
      const verdictClass =
        evalVerdict === "PASS"
          ? "verdict-pass"
          : evalVerdict === "ERROR"
            ? "verdict-error"
            : "verdict-fail";
      const scoreable = e.results.filter((r) => r.judge.verdict !== "ERROR");
      const avgScore =
        scoreable.length > 0
          ? Math.round((scoreable.reduce((s, r) => s + r.judge.score, 0) / scoreable.length) * 10) /
            10
          : null;
      const showTestHeading = e.results.length > 1;
      const cards = e.results
        .map((r, i) => resultDetailCard(r, i, model.mode, showTestHeading, idx, e.standards))
        .join("");
      return `
        <div class="eval-detail" id="eval-${idx}">
          <div class="eval-summary">
            <div class="eval-summary-left">
              <span class="eval-num">${String(idx + 1).padStart(2, "0")}</span>
              <div class="eval-summary-info">
                <span class="eval-summary-name">${esc(e.evaluatorName || e.evaluatorId)}</span>
                <span class="eval-sep">|</span>
                <span class="sev-tag" style="color:${sevColor}">${SEVERITY_ICON}${esc(e.severity.toUpperCase())}<span class="info-hover"><span class="info-icon">i</span><div class="info-tooltip">The evaluator's category weight, not this result's outcome. A LOW-severity evaluator can still Fail.</div></span></span>
              </div>
            </div>
            <div class="eval-summary-right">
              ${e.tokenUsage ? `<span style="font-size:12px;color:var(--muted)">${formatTokenCount(e.tokenUsage.totalTokens)} tokens${e.cost ? ` · ${formatCostDisplay(e.cost)}` : ""}</span><span class="eval-sep">|</span>` : ""}
              <span class="verdict-tag ${verdictClass}">${evalVerdict === "PASS" ? "Pass" : evalVerdict === "ERROR" ? "Error" : "Fail"}</span>
              <span style="font-size:12px;color:var(--text)">Safety score: <strong>${avgScore ?? "—"}/10</strong></span>
            </div>
          </div>
          <div class="eval-body">
            ${cards}
          </div>
        </div>`;
    })
    .join("");

  // ── Cover meta (4-column row) ─────────────────────────────────
  const coverMeta = `
    <div class="cover-meta-item"><div class="cover-meta-k">${esc(labels.targetLabel)}</div><div class="cover-meta-v" title="${esc(target.name)}">${esc(truncate(target.name, 60))}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Evaluation Suite</div><div class="cover-meta-v">${esc(target.suiteId ?? "—")}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Attacker Model</div><div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:12px">${esc(model.generatorModel)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Judge Model</div><div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:12px">${esc(model.judgeModel)}</div></div>`;

  // ── Assessment scope section ──────────────────────────────────
  const targetRows =
    model.mode === "agent"
      ? `<div class="scope-row"><span class="scope-k">System</span><span class="scope-v">${esc(target.name)}</span></div>
         ${target.type ? `<div class="scope-row"><span class="scope-k">Type</span><span class="scope-v">${esc(target.type)}</span></div>` : `<div class="scope-row"><span class="scope-k">Type</span><span class="scope-v">${esc(labels.typeLabel)}</span></div>`}
         ${target.accessMethod ? `<div class="scope-row"><span class="scope-k">Access Method</span><span class="scope-v">${esc(target.accessMethod)}</span></div>` : ""}
         ${target.endpoint ? `<div class="scope-row"><span class="scope-k">Endpoint</span><span class="scope-v mono">${esc(truncate(target.endpoint, 60))}</span></div>` : ""}`
      : `<div class="scope-row"><span class="scope-k">Server</span><span class="scope-v mono">${esc(truncate(target.name, 80))}</span></div>
         <div class="scope-row"><span class="scope-k">Transport</span><span class="scope-v">${esc(target.transport ?? "—")}</span></div>`;

  const paramRows = `
    <div class="scope-row"><span class="scope-k">Suite</span><span class="scope-v">${esc(target.suiteId ?? "—")}</span></div>
    <div class="scope-row"><span class="scope-k">Attacker Model</span><span class="scope-v mono">${esc(model.generatorModel)}</span></div>
    <div class="scope-row"><span class="scope-k">Judge Model</span><span class="scope-v mono">${esc(model.judgeModel)}</span></div>
    ${target.maxTurns != null ? `<div class="scope-row"><span class="scope-k">Max Turns / Evaluator</span><span class="scope-v">${target.maxTurns}</span></div>` : ""}
    ${target.waitBetweenTurnsSec != null ? `<div class="scope-row"><span class="scope-k">Wait Between Turns</span><span class="scope-v">${target.waitBetweenTurnsSec}s</span></div>` : ""}
    ${target.messageLengthLimit != null ? `<div class="scope-row"><span class="scope-k">Message Length Limit</span><span class="scope-v">${target.messageLengthLimit} chars</span></div>` : ""}`;

  const scopeHtml = `
    <div class="scope-card"><div class="scope-card-title">Target</div>${targetRows}</div>
    <div class="scope-card"><div class="scope-card-title">Evaluation Parameters</div>${paramRows}</div>
    ${
      model.businessContext
        ? `<div class="scope-card scope-full"><div class="scope-card-title">Business Context</div><div style="font-size:13px;color:var(--text-2);line-height:1.6">${esc(model.businessContext)}</div></div>`
        : ""
    }`;

  // ── Narrative text ────────────────────────────────────────────
  let narrative: string;
  const targetLabel = model.mode === "agent" ? "target agent" : "MCP server";

  if (model.stopReason && hasRealResults) {
    narrative = `<strong style="color:#D97706">⚠ Partial assessment.</strong> The run was stopped before all evaluators could complete.`;
  } else if (summary.errors > 0 && hasRealResults) {
    narrative = `<strong style="color:#D97706">⚠ Partial assessment.</strong> Some attacks failed due to target errors. Results below are from attacks that completed.`;
  } else if (overallVerdict === "ERROR") {
    if (model.stopReason && summary.total === 0) {
      narrative = `<strong style="color:#D97706">⚠ Assessment could not start.</strong> The run was stopped before any attacks could be executed.`;
    } else {
      narrative = `<strong style="color:#D97706">⚠ Assessment incomplete.</strong> All attacks failed due to errors. Please verify the target is accessible and retry.`;
    }
  } else if (overallVerdict === "PASS") {
    narrative = `The ${targetLabel} <strong>${esc(target.name)}</strong> passed all ${summary.total} evaluator${summary.total === 1 ? "" : "s"}${target.suiteId ? ` in the <em>${esc(target.suiteId)}</em> suite` : ""}. No exploitable vulnerabilities were found.`;
  } else {
    narrative = `The ${targetLabel} <strong>${esc(target.name)}</strong> <strong>failed ${summary.failed} of ${summary.total} evaluator${summary.total === 1 ? "" : "s"}</strong>${target.suiteId ? ` in the <em>${esc(target.suiteId)}</em> suite` : ""}.`;
  }

  const pageTitle =
    model.mode === "agent"
      ? `Opfor Agent Report — ${esc(target.name)}`
      : `Opfor MCP Report — ${esc(target.suiteId ?? target.name)}`;

  const gaugeColor = noScoreableTests ? "#94A3B8" : safetyColor(summary.safetyScore);

  // ── Full HTML ─────────────────────────────────────────────────
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${pageTitle}</title>
<style>
  :root{
    --bg:#F8FAFC;--surface:#FFFFFF;--surface-2:#F1F5F9;
    --text:#0F172A;--text-2:#334155;--muted:#64748B;--muted-2:#94A3B8;
    --line:#E2E8F0;--line-2:#CBD5E1;
    --pass:#059669;--pass-bg:#D1FAE5;--pass-border:#6EE7B7;
    --fail:#DC2626;--fail-bg:#FEE2E2;--fail-border:#FCA5A5;
    --accent:#FF4D4F;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{background:var(--bg)}
  body{color:var(--text);font:14px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);padding:0 0 60px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}

  .page{max-width:960px;margin:0 auto;padding:0 24px}

  /* ── Cover band ── */
  .cover{background:#000;color:#fff;padding:0;margin-bottom:32px}
  .cover-inner{max-width:960px;margin:0 auto;padding:36px 24px 32px}
  .cover-top{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:20px}
  .cover-title{font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.01em}
  .cover-badges-row{display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap}
  .badge-confidential{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase}
  .reportid-chip{display:inline-flex;align-items:center;gap:8px;background:#262626;border:1px solid #3a3a3a;color:#D4D4D4;padding:5px 10px;border-radius:6px;font-size:11px}
  .reportid-chip .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff}
  .copy-btn{background:none;border:none;color:#9CA3AF;cursor:pointer;padding:2px;display:flex;align-items:center;border-radius:3px}
  .copy-btn:hover{color:#fff;background:rgba(255,255,255,0.1)}
  .cover-date{font-size:12px;color:#9CA3AF}
  .cover-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden}
  .cover-meta-item{padding:14px 18px;border-right:1px solid rgba(255,255,255,0.08)}
  .cover-meta-item:last-child{border-right:none}
  .cover-meta-k{font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px}
  .cover-meta-v{font-size:13px;color:#E2E8F0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* ── Section header ── */
  .section{margin-bottom:32px}
  .section-header{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--line)}
  .section-num{width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .section-title{font-size:15px;font-weight:600;color:var(--text);letter-spacing:-0.01em}
  .section-subtitle{font-size:12px;color:var(--muted);margin-left:auto}

  /* ── Executive summary strip ── */
  /* No overflow:hidden here (unlike a plain rounded card), since the info-tooltip below needs
     to pop outside this row's box on hover, so the rounded corners are faked on the end cells
     (:first-child/:last-child) instead of clipped at the row level. */
  .exec-strip{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:12px;background:var(--surface);margin-bottom:12px}
  /* flex-start by default: short cards (Token Usage, Testing Cost) sit right under their
     label, since pinning them to the bottom of a taller row leaves a dead gap in the middle.
     Cards with genuinely variable content (a two-line wrapped badge vs. a fixed-height gauge
     vs. value+dots) opt into .exec-strip-item--bottom, which uses space-between so label
     stays top and body stays bottom, so those cards line up with each other since align-items:
     stretch on .exec-strip already gives every card the same height (the tallest card's).
     Horizontally, align-items centers each card's own content since label/body shrink to
     their content width instead of stretching to the card's full width. */
  .exec-strip-item{position:relative;flex:1;padding:18px 22px;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-width:0;text-align:center}
  .exec-strip-item.exec-strip-item--bottom{justify-content:space-between}
  .exec-strip-item:first-child{border-radius:12px 0 0 12px}
  .exec-strip-item:last-child{border-right:none;border-radius:0 12px 12px 0}
  .exec-strip-label{font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:5px}

  /* ── Info tooltip: appears the instant the pointer enters the card (no native-title delay),
     stays open for as long as the pointer is anywhere on the card, not just on the "i" icon.
     Hover is bound to the whole .exec-strip-item; the icon is just the visual affordance. ── */
  .info-icon{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1.3px solid var(--muted-2);color:var(--muted-2);font-size:9px;font-weight:700;font-style:italic;font-family:Georgia,"Times New Roman",serif;cursor:default;flex-shrink:0}
  .exec-strip-item:hover .info-icon{border-color:var(--text);color:var(--text)}
  .info-tooltip{position:absolute;top:100%;left:50%;transform:translateX(-50%) translateY(4px);margin-top:8px;width:max-content;max-width:230px;background:#0F172A;color:#E2E8F0;font-size:12px;font-weight:400;text-align:left;line-height:1.45;letter-spacing:normal;text-transform:none;padding:7px 11px;border-radius:7px;box-shadow:0 8px 24px rgba(15,23,42,0.25);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s ease;z-index:20}
  .exec-strip-item:hover .info-tooltip{opacity:1;visibility:visible}
  /* .info-hover is a standalone hover trigger for a single word/icon (unlike .exec-strip-item,
     which triggers on hovering its whole card) — it's just a positioned inline wrapper so its
     nested .info-tooltip has something to anchor against and hover against. */
  .info-hover{position:relative;display:inline-flex;align-items:center;gap:4px;cursor:default}
  .info-hover:hover .info-icon{border-color:var(--text);color:var(--text)}
  .info-hover:hover .info-tooltip{opacity:1;visibility:visible}
  .tooltip-divider{height:1px;background:rgba(255,255,255,0.15);margin:6px 0}
  .exec-strip-body{display:flex;flex-direction:column;align-items:center}
  /* Cards without --bottom don't stretch their body to the row's bottom edge, so nudge the
     value down a little instead of letting it sit flush under the label: a small step
     toward vertical center without opening the dead gap full space-between would leave. */
  .exec-strip-item:not(.exec-strip-item--bottom) .exec-strip-body{margin-top:14px}
  /* translateY, not a margin change: the box edges here are already pixel-identical to the
     gauge/value box next to it (verified with getBoundingClientRect), so this isn't a layout
     bug. Bold numerals like "80%" have no descenders, so their visible ink sits a few px above
     their own invisible box edge, while the LOW RISK pill's border IS its true edge, so the two
     look misaligned even though their boxes match. A transform nudges pixels only, leaving the
     box math (and the space-between bottom-pinning) untouched. */
  .exec-verdict-row{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;transform:translateY(-5px)}
  .exec-verdict-text{font-size:32px;font-weight:800;letter-spacing:0.02em;line-height:1}
  .exec-verdict-text.pass{color:var(--pass)}
  .exec-verdict-text.fail{color:var(--fail)}
  .exec-verdict-text.error{color:#D97706}
  .exec-risk{font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid;white-space:nowrap;cursor:default}
  .gauge-value{font-size:26px;font-weight:800;color:var(--text);width:120px;text-align:center;margin-top:-30px}
  .sc-value{font-size:26px;font-weight:800;line-height:1;color:var(--text)}
  .sc-dots{display:flex;flex-direction:column;align-items:center;gap:3px;margin-top:8px}
  .sc-dot-row{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--muted)}
  .sc-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .sc-sub{font-size:12px;color:var(--muted);margin-top:4px}
  .summary-narrative{font-size:13px;color:var(--text-2);line-height:1.7;padding:2px 2px}
  .summary-narrative strong{color:var(--text)}

  /* ── Assessment scope ── */
  .scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .scope-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
  .scope-card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--muted);margin-bottom:12px}
  .scope-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)}
  .scope-row:last-child{border-bottom:none}
  .scope-k{font-size:12px;color:var(--muted);flex-shrink:0}
  .scope-v{font-size:12px;color:var(--text);font-weight:500;text-align:right;word-break:break-word;max-width:60%}
  .scope-v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
  .scope-full{grid-column:1/-1}

  /* ── Badges ── */
  .eval-sep{color:var(--line-2);font-weight:400}
  .sev-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;letter-spacing:0.04em;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .verdict-tag{font-size:18px;font-weight:800;letter-spacing:0.01em}
  .verdict-pass{color:var(--pass)}
  .verdict-fail{color:var(--fail)}
  .verdict-error{color:#D97706}
  .pass-text{color:var(--pass);font-weight:600}
  .fail-text{color:var(--fail);font-weight:600}

  /* ── Evaluator detail blocks ── */
  .eval-detail{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:8px}
  .eval-summary{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;gap:12px}
  .eval-summary-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
  .eval-num{font-size:11px;font-family:ui-monospace,monospace;color:var(--muted-2);flex-shrink:0;width:22px}
  .eval-summary-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .eval-summary-name{font-size:18px;font-weight:700;color:var(--text)}
  .eval-summary-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .eval-body{padding:16px}
  .test-heading{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin:16px 0 8px}
  .test-heading:first-child{margin-top:0}
  .meta-k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
  .meta-v{font-size:13px;font-weight:600;color:var(--text)}
  .detail-section{margin-bottom:18px}
  .detail-section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-2);margin-bottom:8px}
  .detail-section-body{font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;word-break:break-word}
  .eval-meta-row{display:flex;flex-wrap:wrap;gap:36px;margin-bottom:14px}
  .eval-meta-col{display:flex;flex-direction:column;gap:6px}
  .eval-meta-col .meta-v-lg{font-size:20px;font-weight:700;color:var(--text);line-height:1}
  .eval-meta-col.standards-col{margin-left:20px}
  .standards-pills{display:flex;flex-wrap:wrap;gap:6px}
  .standards-pill{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid var(--line-2);color:var(--text-2);background:var(--surface-2);white-space:nowrap}

  /* ── Transcript ── */
  /* display:flex, not inline-flex: this button is always the LAST child of .eval-body, and an
     inline-level box (inline-flex) sits inside an anonymous line box with its own font-metric
     "strut" height, which silently breaks any margin-bottom math on it (verified: doubling the
     negative margin had zero visible effect). A block-level flex container behaves as expected,
     so margin-bottom below cancels exactly the amount needed to match the 12px gap above (the
     padding-top between the divider line and the text) against the card's 16px bottom padding. */
  .transcript-toggle{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--muted);background:none;border:none;cursor:pointer;padding:12px 0 0;margin-top:2px;margin-bottom:-4px;border-top:1px solid var(--line);width:100%}
  .transcript-toggle:hover{color:var(--text)}
  .transcript-toggle svg{transition:transform 0.2s}
  .transcript-wrap{display:none;margin-bottom:8px}
  .transcript-wrap.open{display:block}
  .transcript{border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .transcript-header{padding:8px 12px;background:var(--surface-2);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
  .tc-count{font-weight:400;color:var(--muted-2)}
  /* No left padding by default: the turn-rail's own left inset (below) already gives turn
     content its left margin, via the rail column + this gap. A single-turn thread skips the
     rail entirely (not useful for one turn), so .no-rail restores that margin directly instead
     of leaving the text flush against the card edge. */
  .transcript-body{display:flex;align-items:flex-start;gap:16px;padding:12px 12px 12px 0;max-height:560px;overflow-y:auto;overscroll-behavior:contain}
  .transcript-body.no-rail{padding-left:12px}
  .turn-rail{display:flex;flex-direction:column;align-items:center;gap:16px;flex-shrink:0;position:sticky;top:4px;padding:4px 0 4px 12px}
  .turn-step{position:relative;width:26px;height:26px;border-radius:7px;border:1px solid var(--line-2);background:var(--surface);color:var(--muted);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
  .turn-step:hover{border-color:var(--muted-2);color:var(--text)}
  .turn-step.fail-turn{border-color:var(--fail);color:var(--fail);background:var(--fail-bg);font-weight:800}
  .turn-step.active{box-shadow:0 0 0 2px rgba(15,23,42,0.16)}
  .turn-step.fail-turn.active{box-shadow:0 0 0 2px rgba(220,38,38,0.3)}
  .turn-step:not(:first-child)::before{content:"";position:absolute;bottom:100%;left:50%;transform:translateX(-50%);width:1px;height:16px;background:var(--line-2)}
  .turn-content{flex:1;min-width:0}
  .turn{padding:0 0 20px}
  .turn:last-child{padding-bottom:0}
  .turn-heading{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .turn-heading-label{font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
  .turn-heading-line{flex:1;height:1px;background:var(--line)}
  .turn-row{padding:2px 16px}
  .turn-row.attacker-row{padding-left:64px}
  .turn-row.agent-row{margin-top:12px}
  .turn-role{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px}
  .turn-role .turn-icon{display:inline-flex;align-items:center}
  .turn-row pre{margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text-2)}
  .agent-bubble{display:inline-block;max-width:78%;background:var(--surface-2);border-radius:10px;padding:10px 14px}
  .agent-bubble.turn-highlight{background:var(--fail-bg);border:1px dashed var(--fail-border)}
  @media(max-width:640px){
    .turn-rail{display:none}
    .transcript-body{padding-left:12px}
  }

  @media print{
    body{background:#fff;padding:0}
    .cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .eval-detail{border:1px solid var(--line)}
    .scope-card,.eval-detail,.exec-strip{break-inside:avoid;box-shadow:none}
    .transcript-body{max-height:none;overflow:visible}
    .turn-rail{position:static}
  }
  @media(max-width:640px){
    .cover-meta{grid-template-columns:1fr}
    .exec-strip{flex-direction:column}
    .exec-strip-item{border-right:none;border-bottom:1px solid var(--line)}
    .exec-strip-item:last-child{border-bottom:none}
    .scope-grid{grid-template-columns:1fr}
    .eval-meta-row{gap:20px}
  }
</style>
</head>
<body>

<div class="cover">
  <div class="cover-inner">
    <div class="cover-top">
      <div class="cover-title">${labels.title}</div>
      ${OPFOR_LOGO_SVG}
    </div>
    <div class="cover-badges-row">
      <span class="badge-confidential">${LOCK_ICON} Confidential</span>
      <span class="reportid-chip">Report ID: <span class="mono">${esc(model.reportId)}</span>
        <button class="copy-btn" data-copy="${esc(model.reportId)}" title="Copy report ID">${COPY_ICON}</button>
      </span>
      <span class="cover-date">${esc(dateStr)}, ${esc(timeStr)}${summary.durationMs !== undefined ? ` · Ran for: ${formatDuration(summary.durationMs)}` : ""}</span>
    </div>
    <div class="cover-meta">
      ${coverMeta}
    </div>
  </div>
</div>

<div class="page">

  <!-- 1. Executive Summary -->
  <div class="section">
    <div class="section-header">
      <div class="section-num">1</div>
      <div class="section-title">Executive Summary</div>
    </div>
    <div class="exec-strip">
      <div class="exec-strip-item exec-strip-item--bottom">
        <div class="exec-strip-label">Overall Verdict<span class="info-icon">i</span>
          <div class="info-tooltip">Fail = at least one evaluator confirmed a vulnerability with evidence.<div class="tooltip-divider"></div>${overallVerdict === "ERROR" ? "Inconclusive: no evaluators completed, so a risk tier can't be calculated." : riskLevel.explain}</div>
        </div>
        <div class="exec-strip-body">
          <div class="exec-verdict-row">
            <div class="exec-verdict-text ${overallVerdict === "PASS" ? "pass" : overallVerdict === "ERROR" ? "error" : "fail"}">${overallVerdict === "PASS" ? "Pass" : overallVerdict === "ERROR" ? "Error" : "Fail"}</div>
            <div class="exec-risk" style="color:${riskLevel.color};border-color:${riskLevel.color}66;background:${riskLevel.color}14">${overallVerdict === "ERROR" ? "Inconclusive" : riskLevel.label.toUpperCase()}</div>
          </div>
        </div>
      </div>
      <div class="exec-strip-item exec-strip-item--bottom">
        <div class="exec-strip-label">Safety Score<span class="info-icon">i</span>
          <div class="info-tooltip">Severity-weighted pass rate: a critical fail hurts this more than a low one.</div>
        </div>
        <div class="exec-strip-body">
          ${gaugeSvg(noScoreableTests ? 0 : summary.safetyScore, gaugeColor)}
          <div class="gauge-value">${noScoreableTests ? "N/A" : `${summary.safetyScore}%`}</div>
        </div>
      </div>
      <div class="exec-strip-item exec-strip-item--bottom">
        <div class="exec-strip-label">Evaluators Run</div>
        <div class="exec-strip-body">
          <div class="sc-value">${evaluators.length}</div>
          <div class="sc-dots">
            <div class="sc-dot-row"><span class="sc-dot" style="background:var(--pass)"></span>${summary.passed} passed</div>
            <div class="sc-dot-row"><span class="sc-dot" style="background:var(--fail)"></span>${summary.failed} failed</div>
            ${anyErrors ? `<div class="sc-dot-row"><span class="sc-dot" style="background:#D97706"></span>${summary.errors} errored</div>` : ""}
          </div>
        </div>
      </div>
      ${
        summary.tokenUsage
          ? `<div class="exec-strip-item">
        <div class="exec-strip-label">Token Usage<span class="info-icon">i</span>
          <div class="info-tooltip">Total tokens spent by the attacker + judge models this run.</div>
        </div>
        <div class="exec-strip-body">
          <div class="sc-value">${formatTokenCount(summary.tokenUsage.totalTokens)}</div>
          <div class="sc-sub">${summary.tokenUsage.inputTokens.toLocaleString()} in · ${summary.tokenUsage.outputTokens.toLocaleString()} out</div>
        </div>
      </div>`
          : ""
      }
      ${
        summary.cost
          ? `<div class="exec-strip-item">
        <div class="exec-strip-label">Testing Cost<span class="info-icon">i</span>
          <div class="info-tooltip">Estimated from list prices, excluding the target's own inference cost.</div>
        </div>
        <div class="exec-strip-body">
          <div class="sc-value">${formatCostDisplay(summary.cost)}</div>
        </div>
      </div>`
          : ""
      }
    </div>
    <div class="summary-narrative">
      ${narrative}
    </div>
  </div>

  <!-- 2. Assessment Scope -->
  <div class="section">
    <div class="section-header">
      <div class="section-num">2</div>
      <div class="section-title">Assessment Scope</div>
    </div>
    <div class="scope-grid">
      ${scopeHtml}
    </div>
  </div>

  <!-- 3. Evaluation Results -->
  <div class="section">
    <div class="section-header">
      <div class="section-num">3</div>
      <div class="section-title">${labels.detailSectionTitle}</div>
      <div class="section-subtitle">${evaluators.length} evaluation${evaluators.length === 1 ? "" : "s"}</div>
    </div>
    ${appendix}
  </div>

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
  document.querySelectorAll('.transcript-toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var wrap = btn.closest('.detail-section, .eval-body').querySelector('.transcript-wrap[data-for="' + btn.dataset.target + '"]');
      if(!wrap) return;
      var open = wrap.classList.toggle('open');
      btn.querySelector('.tt-label').textContent = open ? 'View less details' : 'View more details';
      btn.querySelector('svg').style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
      if (open) {
        requestAnimationFrame(function(){
          var flagged = wrap.querySelector('.turn-highlight');
          if (flagged) flagged.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    });
  });
  // Turn rail: click a step to jump to that turn; highlight whichever turn is
  // topmost in view as the user scrolls (scroll-spy).
  document.querySelectorAll('.transcript-body').forEach(function(body){
    var steps = body.querySelectorAll('.turn-step');
    if (!steps.length) return;
    var turns = body.querySelectorAll('.turn[id]');
    var inView = {};
    var lastId = turns.length ? turns[turns.length - 1].id : null;
    var setActive = function(id){
      steps.forEach(function(s){ s.classList.toggle('active', s.dataset.turn === id); });
    };
    // A short final turn may never cross the 0.4 intersection threshold, so once the
    // container is scrolled to its floor, force the last turn active regardless of ratio.
    var applyActive = function(){
      if (lastId && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
        setActive(lastId);
        return;
      }
      var topmost = null;
      turns.forEach(function(t){ if (!topmost && inView[t.id]) topmost = t.id; });
      if (topmost) setActive(topmost);
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
      applyActive();
    }, { root: body, threshold: 0.4 });
    turns.forEach(function(t){ observer.observe(t); });
    body.addEventListener('scroll', applyActive, { passive: true });
  });
})();
</script>
</body>
</html>`;
}

// ── Result detail card ────────────────────────────────────────────

/** "TURN N ────" heading rule that opens each turn block. */
function turnHeading(turnIndex: number): string {
  return `<div class="turn-heading"><span class="turn-heading-label">Turn ${turnIndex}</span><span class="turn-heading-line"></span></div>`;
}

/** Render a single conversation turn: the attacker prompt as plain text, the agent
 *  response as a left-anchored bubble (highlighted when the judge cited this turn
 *  in its `failingTurns`). There's no per-turn judge — the transcript is judged once,
 *  at the end, over the whole exchange — so the flagged-turn signal comes from the
 *  result-level `judge.failingTurns` list, not from `turn.judge`.
 *
 *  `id` anchors this block for the turn-rail's scroll-spy + click-to-scroll (see the
 *  inline <script> in {@link renderReport}). */
function renderTurn(turn: TurnViewModel, failingTurns: Set<number>, id: string): string {
  const bubbleClass = failingTurns.has(turn.turnIndex)
    ? "agent-bubble turn-highlight"
    : "agent-bubble";
  const heading = turnHeading(turn.turnIndex);

  if (turn.detail.kind === "prompt") {
    return `
      <div class="turn" id="${id}">
        ${heading}
        <div class="turn-row attacker-row">
          ${roleLabel(ATTACKER_ICON, "Attacker")}
          <pre>${esc(truncate(turn.detail.prompt, 8000))}</pre>
        </div>
        <div class="turn-row agent-row">
          <div class="${bubbleClass}">
            ${roleLabel(AGENT_ICON, "Agent")}
            <pre>${esc(truncate(turn.detail.response, 8000))}</pre>
          </div>
        </div>
      </div>`;
  }
  const tArgs = esc(JSON.stringify(turn.detail.args, null, 2));
  const tResp = turn.detail.error
    ? `Error: ${esc(truncate(turn.detail.error, 4000))}`
    : esc(truncate(turn.detail.response, 8000));
  const toolLabel = turn.detail.toolName ? ` · ${esc(turn.detail.toolName)}` : "";
  return `
    <div class="turn" id="${id}">
      ${heading}
      <div class="turn-row attacker-row">
        ${roleLabel(ATTACKER_ICON, `Arguments${toolLabel}`)}
        <pre>${tArgs}</pre>
      </div>
      <div class="turn-row agent-row">
        <div class="${bubbleClass}">
          ${roleLabel(AGENT_ICON, "Tool Response")}
          <pre>${tResp}</pre>
        </div>
      </div>
    </div>`;
}

/** Build the single-shot (non-multi-turn) transcript from a top-level DetailCard. */
function singleTurnTranscript(detail: DetailCard): string {
  if (detail.kind === "prompt") {
    return `<div class="turn">
      <div class="turn-row attacker-row">
        ${roleLabel(ATTACKER_ICON, "Attacker")}
        <pre>${esc(truncate(detail.prompt, 8000))}</pre>
      </div>
      <div class="turn-row agent-row">
        <div class="agent-bubble">
          ${roleLabel(AGENT_ICON, "Agent")}
          <pre>${esc(truncate(detail.response, 8000))}</pre>
        </div>
      </div>
    </div>`;
  }
  const args = esc(JSON.stringify(detail.args, null, 2));
  const resp = detail.error
    ? `Error: ${esc(truncate(detail.error, 4000))}`
    : esc(truncate(detail.response, 8000));
  const toolLabel = detail.toolName ? ` · ${esc(detail.toolName)}` : "";
  return `<div class="turn">
      <div class="turn-row attacker-row">
        ${roleLabel(ATTACKER_ICON, `Arguments${toolLabel}`)}
        <pre>${args}</pre>
      </div>
      <div class="turn-row agent-row">
        <div class="agent-bubble">
          ${roleLabel(AGENT_ICON, "Tool Response")}
          <pre>${resp}</pre>
        </div>
      </div>
    </div>`;
}

/** Render one attack result: reasoning/evidence, confidence + standards, and a collapsible transcript. */
function resultDetailCard(
  r: ResultViewModel,
  index: number,
  _mode: "agent" | "mcp",
  showTestHeading: boolean,
  evalIndex: number,
  standards?: Record<string, string>
): string {
  const verdict = r.judge.verdict;
  const failingTurns = new Set(r.judge.failingTurns ?? []);

  // Deterministic per document (not a module-level counter) — repeated renders
  // of the same ReportViewModel (long-lived MCP server, snapshot tests) then
  // produce identical data-for/data-target/turn-anchor values.
  const tId = `t${evalIndex}-${index}`;

  const hasTurns = r.turns && r.turns.length > 0;
  const turnCount = hasTurns ? r.turns!.length : 1;
  const turnId = (turnIndex: number): string => `${tId}-turn-${turnIndex}`;
  const turnsHtml = hasTurns
    ? r.turns!.map((t) => renderTurn(t, failingTurns, turnId(t.turnIndex))).join("")
    : singleTurnTranscript(r.detail);

  // A rail only helps when there's more than one turn to navigate between.
  const railHtml =
    hasTurns && turnCount > 1
      ? `<div class="turn-rail">${r
          .turns!.map((t) => {
            const bad = failingTurns.has(t.turnIndex);
            return `<button class="turn-step${bad ? " fail-turn" : ""}" data-turn="${turnId(t.turnIndex)}" title="Jump to turn ${t.turnIndex}${bad ? " (breach)" : ""}">${t.turnIndex}</button>`;
          })
          .join("")}</div>`
      : "";

  const evidenceHtml =
    r.judge.evidence && r.judge.evidence !== "N/A"
      ? `<div class="detail-section"><div class="detail-section-label">Evidence</div><div class="detail-section-body">${esc(r.judge.evidence)}</div></div>`
      : "";
  const reasoningHtml =
    verdict === "ERROR"
      ? `<div class="detail-section"><div class="detail-section-label">Error</div><div class="detail-section-body">${esc(r.judge.errorMessage ?? "")}</div></div>`
      : r.judge.reasoning
        ? `<div class="detail-section"><div class="detail-section-label">Reasoning</div><div class="detail-section-body">${esc(r.judge.reasoning)}</div></div>`
        : "";

  const confidenceCol = `
    <div class="eval-meta-col">
      <div class="detail-section-label">Confidence<span class="info-hover"><span class="info-icon">i</span><div class="info-tooltip">How confident the judge is in this verdict, not a severity score.</div></span></div>
      <div class="meta-v-lg">${verdict === "ERROR" ? "—" : `${r.judge.confidence}%`}</div>
    </div>`;

  const standardsEntries = standards
    ? Object.entries(standards).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const standardsCol =
    standardsEntries.length > 0
      ? `
    <div class="eval-meta-col standards-col">
      <div class="detail-section-label">Standards</div>
      <div class="standards-pills">${standardsEntries.map(([k, v]) => `<span class="standards-pill">${esc(k)}: ${esc(v)}</span>`).join("")}</div>
    </div>`
      : "";

  return `
    ${showTestHeading ? `<div class="test-heading">Test ${index + 1} — ${esc(r.label)}</div>` : ""}
    ${reasoningHtml}
    ${evidenceHtml}
    <div class="eval-meta-row">
      ${confidenceCol}
      ${standardsCol}
    </div>
    <div class="transcript-wrap" data-for="${tId}">
      <div class="transcript">
        <div class="transcript-header">Conversation Transcript <span class="tc-count">${turnCount} turn${turnCount === 1 ? "" : "s"}</span></div>
        <div class="transcript-body${railHtml ? "" : " no-rail"}">
          ${railHtml}
          <div class="turn-content">${turnsHtml}</div>
        </div>
      </div>
    </div>
    <button class="transcript-toggle" data-target="${tId}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      <span class="tt-label">View more details</span>
    </button>`;
}
