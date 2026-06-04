/**
 * Generate a polished, print-optimized PDF from an Opfor report JSON.
 *
 * The HTML report is built for an interactive browser (collapsible sections,
 * "show more" buttons) and prints "everything in full" — which balloons to 100+
 * pages on large runs. This script instead produces a *triage* report tuned for
 * a human reader: page count scales with how much went wrong, not how much was
 * tested.
 *
 *   - Cover page + executive dashboard,
 *   - assessment scope,
 *   - a dense coverage matrix (one row per evaluator),
 *   - FINDINGS: only failed tests, expanded — escalation ladder + the
 *     judge-flagged decisive turn(s) in full + judge reasoning,
 *   - PASSED tests collapsed to one compact line each (no transcript).
 *
 * Transcript compression (keeps the proof, drops the bulk):
 *   - identical repeated responses are deduped ("same response as T1"),
 *   - the escalation ladder summarizes every turn in one line each,
 *   - only the top 1-2 decisive turns are shown verbatim (--turns to change),
 *   - agent responses are shown as an excerpt anchored on the judge's evidence
 *     quote (highlighted), not the full reply; attacker prompts are capped.
 *
 * Rendering uses the system Chrome/Chromium in headless mode (`--print-to-pdf`),
 * so there is no extra npm dependency to install.
 *
 * Usage:
 *   tsx scripts/generate-pdf-report.ts <report.json|dir> [output.pdf]
 *   tsx scripts/generate-pdf-report.ts <report.json> --turns=1 --max-chars=450  # tighter
 *   tsx scripts/generate-pdf-report.ts <report.json> --full        # complete transcripts
 *   tsx scripts/generate-pdf-report.ts <report.json> --html-only   # emit HTML, skip Chrome
 *
 * Flags:
 *   --turns=N      max decisive turns shown verbatim per failure (default 2)
 *   --max-chars=N  max chars of an agent response in a bubble (default 600)
 *   --full         legacy archival layout: every turn, every response, no caps
 *   --html-only    write HTML instead of PDF (print from a browser)
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Report JSON shape (persisted report; see core/src/report/types.ts) ──────

interface Judge {
  verdict: "PASS" | "FAIL" | "ERROR";
  score: number;
  confidence: number;
  evidence?: string;
  reasoning: string;
  failingTurns?: number[];
  errorMessage?: string;
}

interface Turn {
  kind?: string;
  turnIndex: number;
  prompt?: string;
  response?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  error?: string;
  judge?: Judge;
}

interface Attack {
  attackId: string;
  evaluatorId: string;
  patternName?: string;
  prompt?: string;
  response?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  error?: string;
  judge: Judge;
  turns?: Turn[];
}

interface Evaluator {
  evaluatorId: string;
  evaluatorName?: string;
  standards?: Record<string, string>;
  severity: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate?: number;
  attacks: Attack[];
}

interface Report {
  reportId: string;
  generatedAt: string;
  targetName: string;
  targetKind?: string;
  effort?: string;
  endpoint?: string;
  attackModel: string;
  judgeModel: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    safetyScore: number;
    attackSuccessRate: number;
  };
  evaluators: Evaluator[];
}

type Mode = "triage" | "full";

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SEV_HEX: Record<string, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#16A34A",
};
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function sevColor(sev: string): string {
  return SEV_HEX[sev.toLowerCase()] || "#64748B";
}

function safetyColor(score: number): string {
  if (score >= 70) return "#059669";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

function riskLevel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Low Risk", color: "#059669" };
  if (score >= 60) return { label: "Medium Risk", color: "#D97706" };
  if (score >= 40) return { label: "High Risk", color: "#DC2626" };
  return { label: "Critical Risk", color: "#991B1B" };
}

function formatStandards(standards?: Record<string, string>): string {
  if (!standards) return "";
  return Object.entries(standards)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

/** A response that is a JSON error blob reads better pretty-printed (full view). */
function prettifyResponse(raw: string): string {
  const text = raw?.trim() ?? "";
  if (!text) return "(empty response)";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* fall through to raw */
    }
  }
  return text;
}

/** One-line gist of arbitrary text (collapse whitespace, truncate). */
function gist(raw: string | undefined, n = 64): string {
  const o = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!o) return "—";
  return o.length > n ? `${o.slice(0, n)}…` : o;
}

/** Compact label for a response: "401 token_not_found_in_db" or a text gist. */
function summarizeResponse(raw?: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "(empty response)";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const err = (o.error as Record<string, unknown>) ?? o;
      const code = err.code ?? err.status;
      const type = typeof err.type === "string" ? err.type : undefined;
      const label = [code, type].filter(Boolean).join(" ");
      if (label) return label;
      if (typeof err.message === "string") return gist(err.message, 70);
    } catch {
      /* fall through */
    }
  }
  return gist(t, 70);
}

// ── Render config (set per run) ───────────────────────────────────────────────

interface RenderCfg {
  mode: Mode;
  agentCap: number; // max chars of an agent response shown verbatim (triage)
  attackerCap: number; // max chars of an attacker prompt shown verbatim (triage)
  maxDecisive: number; // max failing turns shown in full per failure (triage)
}
let CFG: RenderCfg = { mode: "triage", agentCap: 600, attackerCap: 320, maxDecisive: 2 };

const EVID_BEFORE = 160;
const EVID_AFTER = 360;

function normalizeQuote(s: string): string {
  return s
    .replace(/^\s*\[turn\s*\d+\]\s*/i, "")
    .replace(/^["“”'']+|["“”'']+$/g, "")
    .trim();
}

/** Clip to a char budget, breaking on a word boundary. */
function clip(text: string, cap: number): { body: string; hidden: number } {
  const t = text ?? "";
  if (t.length <= cap) return { body: t, hidden: 0 };
  let end = t.lastIndexOf(" ", cap);
  if (end < cap * 0.6) end = cap;
  return { body: t.slice(0, end).trimEnd(), hidden: t.length - end };
}

function truncMark(hidden: number): string {
  return hidden > 0
    ? `<div class="trunc-mark">+${hidden.toLocaleString()} more characters</div>`
    : "";
}

function attackerBody(prompt: string | undefined, truncate: boolean): string {
  const text = prompt ?? "";
  if (!truncate) return `<pre class="bubble-body">${esc(text)}</pre>`;
  const { body, hidden } = clip(text, CFG.attackerCap);
  return `<pre class="bubble-body">${esc(body)}</pre>${truncMark(hidden)}`;
}

/**
 * Agent response body. In triage mode, anchor on the judge's evidence quote:
 * show that text highlighted with a little context, instead of the whole reply.
 * Falls back to head truncation when there is no usable evidence.
 */
function agentBody(
  response: string | undefined,
  error: string | undefined,
  truncate: boolean,
  evidence?: string
): string {
  const raw = response ?? error ?? "";
  if (!truncate) return `<pre class="bubble-body">${esc(prettifyResponse(raw))}</pre>`;

  // The judge quotes evidence with markdown stripped, so match on a markdown-
  // insensitive copy of the response and excerpt from that cleaned text.
  const cleaned = raw.replace(/[*`]/g, "");
  const ev = evidence && evidence !== "N/A" ? normalizeQuote(evidence).replace(/[*`]/g, "") : "";
  if (ev.length >= 16) {
    let idx = cleaned.indexOf(ev);
    let matchLen = ev.length;
    if (idx === -1) {
      const probe = ev.slice(0, 40);
      idx = cleaned.indexOf(probe);
      if (idx !== -1) matchLen = Math.min(ev.length, cleaned.length - idx);
    }
    if (idx !== -1) {
      const start = Math.max(0, idx - EVID_BEFORE);
      const end = Math.min(cleaned.length, idx + matchLen + EVID_AFTER);
      const pre = (start > 0 ? "… " : "") + cleaned.slice(start, idx);
      const mark = cleaned.slice(idx, idx + matchLen);
      const post = cleaned.slice(idx + matchLen, end) + (end < cleaned.length ? " …" : "");
      const hidden = start + (cleaned.length - end);
      return `<div class="excerpt-note">Excerpt · highlighted = judge evidence${hidden > 0 ? ` · ${hidden.toLocaleString()} chars hidden` : ""}</div><pre class="bubble-body">${esc(pre)}<mark class="ev">${esc(mark)}</mark>${esc(post)}</pre>`;
    }
  }
  const { body, hidden } = clip(prettifyResponse(raw), CFG.agentCap);
  return `<pre class="bubble-body">${esc(body)}</pre>${truncMark(hidden)}`;
}

// ── Turn / exchange rendering ─────────────────────────────────────────────────

function renderTurn(turn: Turn, truncate: boolean, evidence?: string): string {
  const v = turn.judge?.verdict;
  const vColor = v === "PASS" ? "var(--pass)" : v === "FAIL" ? "var(--fail)" : "#D97706";
  const vBg = v === "PASS" ? "var(--pass-bg)" : v === "FAIL" ? "var(--fail-bg)" : "#FEF3C7";
  const vBorder =
    v === "PASS" ? "var(--pass-border)" : v === "FAIL" ? "var(--fail-border)" : "#FDE68A";
  const verdictBadge = v
    ? `<span class="turn-verdict" style="color:${vColor};background:${vBg};border-color:${vBorder}">${v}${v !== "ERROR" ? ` · ${turn.judge?.score}/10` : ""}</span>`
    : "";

  return `
    <div class="turn">
      <div class="turn-head">
        <span class="turn-no">T${turn.turnIndex}</span>
        <span class="turn-title">Turn ${turn.turnIndex}</span>
        ${verdictBadge}
      </div>
      <div class="bubble attacker">
        <div class="bubble-label">Attacker</div>
        ${attackerBody(turn.prompt, truncate)}
      </div>
      <div class="bubble agent">
        <div class="bubble-label">Agent</div>
        ${agentBody(turn.response, turn.error, truncate, evidence)}
      </div>
      ${turn.judge?.reasoning ? `<div class="turn-reasoning">${esc(turn.judge.reasoning)}</div>` : ""}
    </div>`;
}

function renderSingleExchange(attack: Attack, truncate: boolean): string {
  return `
    <div class="turn">
      <div class="bubble attacker">
        <div class="bubble-label">Attacker Prompt</div>
        ${attackerBody(attack.prompt, truncate)}
      </div>
      <div class="bubble agent">
        <div class="bubble-label">Agent Response</div>
        ${agentBody(attack.response, attack.error, truncate, attack.judge.evidence)}
      </div>
    </div>`;
}

function judgeBox(j: Judge): string {
  const v = j.verdict;
  const cls = v === "PASS" ? "pass" : v === "ERROR" ? "error" : "fail";
  const color = v === "PASS" ? "var(--pass)" : v === "ERROR" ? "#92400E" : "var(--fail)";
  const meta = [
    `Score ${j.score}/10`,
    `Confidence ${j.confidence}%`,
    j.evidence && j.evidence !== "N/A" ? `Evidence: ${esc(j.evidence)}` : "",
    v === "FAIL" && j.failingTurns?.length
      ? `Failing turn${j.failingTurns.length === 1 ? "" : "s"}: ${j.failingTurns.join(", ")}`
      : "",
  ].filter(Boolean);
  return `<div class="judge-box ${cls}">
      <div class="judge-head">
        <span class="judge-verdict" style="color:${color}">Judge verdict: ${v}</span>
        <span class="judge-meta">${meta.join(" · ")}</span>
      </div>
      <div class="judge-reasoning">${esc(j.reasoning || j.errorMessage || "")}</div>
    </div>`;
}

/** Legacy full card: every turn in full. Used only with --full. */
function renderAttackFull(attack: Attack, index: number): string {
  const v = attack.judge.verdict;
  const cardClass = v === "PASS" ? "pass" : v === "ERROR" ? "error" : "fail";
  const hasTurns = !!attack.turns && attack.turns.length > 0;
  const body = hasTurns
    ? `<div class="convo-label">Conversation — ${attack.turns!.length} turn${attack.turns!.length === 1 ? "" : "s"}</div>${attack.turns!.map((t) => renderTurn(t, false)).join("")}`
    : renderSingleExchange(attack, false);
  return `
    <div class="attack-card ${cardClass}">
      <div class="attack-head">
        <span class="attack-title">Test ${index + 1} · ${esc(attack.patternName || attack.evaluatorId)}</span>
        <span class="verdict-tag verdict-${v.toLowerCase()}">${v}</span>
      </div>
      <div class="attack-id">${esc(attack.attackId)}</div>
      ${body}
      ${judgeBox(attack.judge)}
    </div>`;
}

// ── Triage rendering ──────────────────────────────────────────────────────────

/** Decisive turns = judge-flagged failing turns, else the last turn. */
function decisiveTurnIndices(attack: Attack): number[] {
  const turns = attack.turns ?? [];
  if (attack.judge.failingTurns?.length) return attack.judge.failingTurns;
  if (turns.length) return [turns[turns.length - 1].turnIndex];
  return [];
}

/** Compact escalation ladder: one line per turn, deduping repeated responses. */
function renderLadder(turns: Turn[], failing: number[]): string {
  const seen = new Map<string, number>();
  const rows = turns
    .map((t) => {
      const sig = (t.response ?? t.error ?? "").trim();
      const isFail = failing.includes(t.turnIndex);
      let outcome: string;
      const first = sig ? seen.get(sig) : undefined;
      if (sig && first !== undefined) {
        outcome = `same response as T${first}`;
      } else {
        if (sig) seen.set(sig, t.turnIndex);
        outcome = summarizeResponse(t.response ?? t.error);
      }
      return `<div class="ladder-row${isFail ? " fail" : ""}">
        <span class="ladder-turn">T${t.turnIndex}</span>
        <span class="ladder-atk">${esc(gist(t.prompt, 70))}</span>
        <span class="ladder-arrow">→</span>
        <span class="ladder-out">${esc(outcome)}</span>
        ${isFail ? `<span class="ladder-flag">✗</span>` : ""}
      </div>`;
    })
    .join("");
  return `<div class="ladder"><div class="ladder-cap">Escalation ladder · ${turns.length} turns</div>${rows}</div>`;
}

/** Expanded failure card: ladder + the top decisive turn(s) verbatim + judge reasoning. */
function renderFinding(attack: Attack, evaluator: Evaluator, rank: number): string {
  const c = sevColor(evaluator.severity);
  const turns = attack.turns ?? [];
  const j = attack.judge;
  const failing = decisiveTurnIndices(attack);

  // Which turn does the judge's evidence quote belong to?
  const evMatch = (j.evidence ?? "").match(/\[turn\s*(\d+)\]/i);
  const evTurn = evMatch ? Number(evMatch[1]) : undefined;
  const evForTurn = (idx: number): string | undefined => {
    if (!j.evidence || j.evidence === "N/A") return undefined;
    if (evTurn === undefined) return j.evidence; // no marker → let the matcher anchor where it fits
    return evTurn === idx ? j.evidence : undefined;
  };

  // Pick the most informative failing turns: evidence turn, then the last one, then the rest.
  const priority: number[] = [];
  if (evTurn !== undefined && failing.includes(evTurn)) priority.push(evTurn);
  const lastFail = failing[failing.length - 1];
  if (lastFail !== undefined && !priority.includes(lastFail)) priority.push(lastFail);
  for (const ti of failing) if (!priority.includes(ti)) priority.push(ti);
  const shownIdx = priority.slice(0, CFG.maxDecisive).sort((a, b) => a - b);
  const shownTurns = turns.filter((t) => shownIdx.includes(t.turnIndex));
  const hiddenFailing = failing.length - shownTurns.length;

  const decisiveLabel = turns.length
    ? `<div class="fc-decisive-label">Key exchange${shownTurns.length > 1 ? "s" : ""}${shownIdx.length ? ` · turn${shownIdx.length > 1 ? "s" : ""} ${shownIdx.join(", ")}` : ""}${hiddenFailing > 0 ? ` <span class="fc-more">(+${hiddenFailing} more failing turn${hiddenFailing > 1 ? "s" : ""} — see ladder above)</span>` : ""}</div>`
    : "";

  return `
    <div class="finding-card">
      <div class="finding-card-head">
        <span class="fc-rank">#${rank}</span>
        <span class="fc-name">${esc(attack.patternName || evaluator.evaluatorName || evaluator.evaluatorId)}</span>
        <span class="sev-tag" style="background:${c}18;color:${c};border-color:${c}44">${esc(evaluator.severity)}</span>
        <span class="fc-eval">${esc(evaluator.evaluatorName || evaluator.evaluatorId)}</span>
        <span class="verdict-tag verdict-fail">FAIL · ${j.score}/10</span>
      </div>
      ${turns.length ? renderLadder(turns, failing) : ""}
      ${decisiveLabel}
      ${turns.length ? shownTurns.map((t) => renderTurn(t, true, evForTurn(t.turnIndex))).join("") : renderSingleExchange(attack, true)}
      ${judgeBox(j)}
    </div>`;
}

// ── HTML document ─────────────────────────────────────────────────────────────

function renderHtml(report: Report): string {
  const mode = CFG.mode;
  const { summary } = report;
  const now = new Date(report.generatedAt);
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const scoreDenominator = summary.passed + summary.failed;
  const noScoreableTests = scoreDenominator === 0;
  const overallVerdict = summary.failed === 0 && summary.total > 0 ? "PASS" : "FAIL";
  const risk = riskLevel(summary.safetyScore);
  const evalsFailed = report.evaluators.filter((e) => e.failed > 0).length;
  const anyErrors = report.evaluators.some((e) => e.errors > 0);

  // ── Collect failures, passes, errors ──────────────────────────────
  interface Row {
    evaluator: Evaluator;
    attack: Attack;
  }
  const failures: Row[] = [];
  const passes: Row[] = [];
  const errored: Row[] = [];
  let criticalCount = 0;
  let highCount = 0;
  for (const e of report.evaluators) {
    for (const a of e.attacks) {
      if (a.judge.verdict === "FAIL") {
        failures.push({ evaluator: e, attack: a });
        if (e.severity.toLowerCase() === "critical") criticalCount++;
        else if (e.severity.toLowerCase() === "high") highCount++;
      } else if (a.judge.verdict === "ERROR") {
        errored.push({ evaluator: e, attack: a });
      } else {
        passes.push({ evaluator: e, attack: a });
      }
    }
  }
  // Worst first: by severity, then lowest score (most severe breach).
  failures.sort(
    (a, b) =>
      (SEV_RANK[a.evaluator.severity.toLowerCase()] ?? 9) -
        (SEV_RANK[b.evaluator.severity.toLowerCase()] ?? 9) ||
      a.attack.judge.score - b.attack.judge.score
  );

  // ── Coverage matrix rows ──────────────────────────────────────────
  const matrixRows = report.evaluators
    .map((e, idx) => {
      const c = sevColor(e.severity);
      const passDenom = e.passed + e.failed;
      const passRate = passDenom > 0 ? Math.round((e.passed / passDenom) * 100) : 0;
      const scoreable = e.attacks.filter((a) => a.judge.verdict !== "ERROR");
      const avg = scoreable.length
        ? (scoreable.reduce((s, a) => s + a.judge.score, 0) / scoreable.length).toFixed(1)
        : "—";
      const verdictPass = e.failed === 0 && e.passed > 0;
      const barColor = verdictPass ? "#059669" : "#DC2626";
      return `<tr>
        <td class="td-num">${String(idx + 1).padStart(2, "0")}</td>
        <td><span class="eval-name">${esc(e.evaluatorName || e.evaluatorId)}</span>${e.standards && Object.keys(e.standards).length ? `<br><span class="eval-std">${esc(formatStandards(e.standards))}</span>` : ""}</td>
        <td><span class="sev-tag" style="background:${c}18;color:${c};border-color:${c}44">${esc(e.severity)}</span></td>
        <td><span class="verdict-tag ${verdictPass ? "verdict-pass" : "verdict-fail"}">${verdictPass ? "PASS" : "FAIL"}</span></td>
        <td>${e.total}</td>
        <td style="color:#059669;font-weight:600">${e.passed}</td>
        <td style="color:#DC2626;font-weight:600">${e.failed}</td>
        ${anyErrors ? `<td style="color:#D97706;font-weight:600">${e.errors > 0 ? e.errors : "—"}</td>` : ""}
        <td><div class="rate-cell"><span>${passRate}%</span><span class="rate-bar"><span class="rate-bar-fill" style="width:${passRate}%;background:${barColor}"></span></span></div></td>
        <td class="td-score">${avg !== "—" ? `${avg}<span style="color:#94A3B8">/10</span>` : "—"}</td>
      </tr>`;
    })
    .join("");

  // ── Findings (failures) ───────────────────────────────────────────
  const findingsHtml = failures.length
    ? failures.map((r, i) => renderFinding(r.attack, r.evaluator, i + 1)).join("")
    : `<div class="no-findings">No failed tests — agent defended every evaluated attack pattern.</div>`;

  // ── Passed / errored compact table ────────────────────────────────
  const compactRows = [...passes, ...errored]
    .map((r) => {
      const j = r.attack.judge;
      const isErr = j.verdict === "ERROR";
      return `<tr>
        <td><span class="verdict-tag ${isErr ? "verdict-error" : "verdict-pass"}">${isErr ? "ERR" : "PASS"}</span></td>
        <td class="pt-eval">${esc(r.evaluator.evaluatorName || r.evaluator.evaluatorId)}</td>
        <td>${esc(r.attack.patternName || "—")}</td>
        <td class="td-score">${isErr ? "—" : `${j.score}/10`}</td>
        <td class="pt-take">${esc(gist(j.reasoning || j.errorMessage, 150))}</td>
      </tr>`;
    })
    .join("");
  const compactTitle =
    errored.length > 0
      ? `Passed & Non-scoring Tests (${passes.length + errored.length})`
      : `Passed Tests (${passes.length})`;

  const narrative =
    overallVerdict === "PASS"
      ? `The target agent <strong>${esc(report.targetName)}</strong> <strong>passed all ${summary.total} test${summary.total === 1 ? "" : "s"}</strong> across ${report.evaluators.length} evaluator${report.evaluators.length === 1 ? "" : "s"}. No exploitable vulnerabilities were surfaced under adversarial pressure.`
      : `The target agent <strong>${esc(report.targetName)}</strong> <strong>failed ${summary.failed} of ${summary.total} test${summary.total === 1 ? "" : "s"}</strong> (${summary.attackSuccessRate}% attack success rate) across ${report.evaluators.length} evaluator${report.evaluators.length === 1 ? "" : "s"}.${criticalCount > 0 ? ` <strong style="color:#DC2626">${criticalCount} critical finding${criticalCount === 1 ? "" : "s"}</strong> require immediate remediation.` : ""} See Findings below, ordered worst-first.`;

  // ── Detail section: triage (findings + passed) or full transcripts ──
  let detailSections: string;
  if (mode === "full") {
    detailSections = report.evaluators
      .map((e, idx) => {
        const c = sevColor(e.severity);
        const verdictPass = e.failed === 0 && e.passed > 0;
        return `
          <div class="eval-section">
            <div class="eval-section-head">
              <span class="eval-section-num">${String(idx + 1).padStart(2, "0")}</span>
              <span class="eval-section-name">${esc(e.evaluatorName || e.evaluatorId)}</span>
              <span class="sev-tag" style="background:${c}18;color:${c};border-color:${c}44">${esc(e.severity)}</span>
              <span class="eval-section-stat">${e.passed}/${e.total - e.errors} passed</span>
              <span class="verdict-tag ${verdictPass ? "verdict-pass" : "verdict-fail"}">${verdictPass ? "PASS" : "FAIL"}</span>
            </div>
            ${e.attacks.map((a, i) => renderAttackFull(a, i)).join("")}
          </div>`;
      })
      .join("");
    detailSections = `
      <div class="section">
        <div class="section-header">
          <div class="section-num">4</div>
          <div class="section-title">Full Transcripts</div>
          <div class="section-subtitle">complete — every turn</div>
        </div>
        ${detailSections}
      </div>`;
  } else {
    detailSections = `
      <div class="section">
        <div class="section-header">
          <div class="section-num">4</div>
          <div class="section-title">Findings — Failed Tests</div>
          ${failures.length ? `<div class="section-subtitle">${failures.length} failure${failures.length === 1 ? "" : "s"} · worst first</div>` : ""}
        </div>
        ${findingsHtml}
      </div>
      ${
        passes.length + errored.length > 0
          ? `<div class="section">
              <div class="section-header">
                <div class="section-num">5</div>
                <div class="section-title">${compactTitle}</div>
                <div class="section-subtitle">collapsed — transcripts omitted</div>
              </div>
              <div class="passed-table-wrap">
                <table class="passed">
                  <thead><tr><th>Verdict</th><th>Evaluator</th><th>Pattern</th><th>Score</th><th>Judge takeaway</th></tr></thead>
                  <tbody>${compactRows}</tbody>
                </table>
              </div>
            </div>`
          : ""
      }`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Opfor Security Assessment — ${esc(report.targetName)}</title>
<style>
  :root{
    --bg:#FFFFFF;--surface:#FFFFFF;--surface-2:#F1F5F9;
    --text:#0F172A;--text-2:#334155;--muted:#64748B;--muted-2:#94A3B8;
    --line:#E2E8F0;--line-2:#CBD5E1;
    --pass:#059669;--pass-bg:#D1FAE5;--pass-border:#6EE7B7;
    --fail:#DC2626;--fail-bg:#FEE2E2;--fail-border:#FCA5A5;
    --accent:#f5ad5c;
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{background:#fff}
  body{color:var(--text);font:12px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}

  @page{size:A4;margin:15mm 14mm 16mm}
  @page:first{margin:0}

  pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

  /* ── Cover (full first page) ── */
  .cover{background:#0F172A;color:#fff;min-height:297mm;padding:36mm 22mm;page-break-after:always;display:flex;flex-direction:column}
  .cover-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:60mm}
  .cover-brand{display:flex;align-items:center;gap:12px}
  .cover-brand-icon{width:44px;height:44px;background:linear-gradient(135deg,#f5ad5c,#c47a2a);border-radius:10px;display:flex;align-items:center;justify-content:center}
  .cover-brand-name{font-size:18px;font-weight:700;letter-spacing:0.04em}
  .cover-brand-sub{font-size:11px;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-top:2px}
  .cover-classification{padding:5px 14px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#CBD5E1}
  .cover-eyebrow{font-size:12px;color:var(--accent);letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:14px}
  .cover-title{font-size:38px;font-weight:800;letter-spacing:-0.02em;line-height:1.1;margin-bottom:14px}
  .cover-target{font-size:18px;color:#E2E8F0;margin-bottom:6px}
  .cover-sub{font-size:13px;color:#94A3B8;margin-bottom:40px}
  .cover-verdict{display:inline-flex;align-items:center;gap:14px;padding:16px 22px;border-radius:12px;margin-bottom:auto}
  .cover-verdict.pass{background:rgba(5,150,105,0.16);border:1px solid rgba(110,231,183,0.4)}
  .cover-verdict.fail{background:rgba(220,38,38,0.16);border:1px solid rgba(252,165,165,0.4)}
  .cover-verdict-big{font-size:30px;font-weight:800;letter-spacing:0.05em}
  .cover-verdict.pass .cover-verdict-big{color:#6EE7B7}
  .cover-verdict.fail .cover-verdict-big{color:#FCA5A5}
  .cover-verdict-side{font-size:12px;color:#CBD5E1;line-height:1.5}
  .cover-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border:1px solid rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;margin-top:36px}
  .cover-meta-item{padding:14px 18px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08)}
  .cover-meta-item:nth-child(2n){border-right:none}
  .cover-meta-k{font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px}
  .cover-meta-v{font-size:13px;color:#E2E8F0;font-weight:500;word-break:break-word}
  .cover-meta-v.mono{font-family:ui-monospace,monospace;font-size:11px}

  /* ── Sections ── */
  .section{margin-bottom:22px}
  .section-header{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:9px;border-bottom:2px solid var(--line)}
  .section-num{width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .section-title{font-size:16px;font-weight:700;letter-spacing:-0.01em}
  .section-subtitle{font-size:11px;color:var(--muted);margin-left:auto}

  /* ── Executive summary ── */
  .exec-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-radius:12px;border:1px solid;margin-bottom:12px;break-inside:avoid}
  .exec-banner.pass{border-color:var(--pass-border);background:var(--pass-bg)}
  .exec-banner.fail{border-color:var(--fail-border);background:var(--fail-bg)}
  .exec-verdict-label{font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
  .exec-verdict-text{font-size:26px;font-weight:800;letter-spacing:0.04em;line-height:1}
  .exec-banner.pass .exec-verdict-text{color:var(--pass)}
  .exec-banner.fail .exec-verdict-text{color:var(--fail)}
  .exec-risk{font-size:12px;font-weight:600;padding:5px 14px;border-radius:999px;border:1px solid}
  .exec-banner.pass .exec-risk{background:#fff;color:var(--pass);border-color:var(--pass-border)}
  .exec-banner.fail .exec-risk{background:#fff;color:var(--fail);border-color:var(--fail-border)}
  .summary-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .stat-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:13px 15px;break-inside:avoid}
  .sc-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px}
  .sc-value{font-size:22px;font-weight:800;line-height:1}
  .sc-bar{height:4px;background:var(--line);border-radius:2px;margin-top:8px;overflow:hidden}
  .sc-bar-fill{height:100%;border-radius:2px}
  .sc-sub{font-size:10px;color:var(--muted);margin-top:5px}
  .summary-narrative{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-top:12px;font-size:12.5px;color:var(--text-2);line-height:1.7;break-inside:avoid}
  .summary-narrative strong{color:var(--text)}

  /* ── Scope ── */
  .scope-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .scope-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;break-inside:avoid}
  .scope-card-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--muted);margin-bottom:10px}
  .scope-row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)}
  .scope-row:last-child{border-bottom:none}
  .scope-k{font-size:12px;color:var(--muted)}
  .scope-v{font-size:12px;color:var(--text);font-weight:500;text-align:right;word-break:break-word;max-width:62%}
  .scope-v.mono{font-family:ui-monospace,monospace;font-size:11px}

  /* ── Coverage matrix ── */
  .results-table-wrap{border:1px solid var(--line);border-radius:10px;overflow:hidden}
  table.results{width:100%;border-collapse:collapse}
  table.results th{background:var(--surface-2);padding:9px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--line)}
  table.results td{padding:9px 12px;font-size:12px;border-bottom:1px solid var(--line);vertical-align:middle}
  table.results tr:last-child td{border-bottom:none}
  .td-num{color:var(--muted-2);font-size:11px;font-family:ui-monospace,monospace}
  .td-score{font-weight:600}
  .eval-name{font-weight:600}
  .eval-std{font-size:10px;color:var(--muted)}
  .rate-cell{display:flex;align-items:center;gap:6px}
  .rate-bar{display:inline-block;width:42px;height:5px;background:var(--line);border-radius:3px;overflow:hidden}
  .rate-bar-fill{display:block;height:100%;border-radius:3px}

  /* ── Badges ── */
  .sev-tag{display:inline-block;padding:2px 8px;border:1px solid;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap}
  .verdict-tag{display:inline-block;padding:2px 9px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em}
  .verdict-pass{background:var(--pass-bg);color:var(--pass);border:1px solid var(--pass-border)}
  .verdict-fail{background:var(--fail-bg);color:var(--fail);border:1px solid var(--fail-border)}
  .verdict-error{background:#FEF3C7;color:#92400E;border:1px solid #FDE68A}

  /* ── Findings (failed tests) ── */
  .no-findings{background:var(--pass-bg);border:1px solid var(--pass-border);border-radius:10px;padding:16px;text-align:center;color:var(--pass);font-weight:600;font-size:13px}
  .finding-card{border:1px solid var(--fail-border);border-left:4px solid var(--fail);border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:14px}
  .finding-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .fc-rank{font-family:ui-monospace,monospace;font-size:12px;color:var(--fail);font-weight:700}
  .fc-name{font-size:13px;font-weight:700}
  .fc-eval{font-size:11px;color:var(--muted)}
  .finding-card-head .verdict-tag{margin-left:auto}
  .fc-decisive-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--fail);margin:4px 0 8px}

  /* ── Escalation ladder ── */
  .ladder{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:10px}
  .ladder-cap{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);padding:5px 10px;background:var(--surface-2);border-bottom:1px solid var(--line)}
  .ladder-row{display:flex;align-items:baseline;gap:8px;padding:5px 10px;font-size:11px;border-bottom:1px solid var(--line);break-inside:avoid}
  .ladder-row:last-child{border-bottom:none}
  .ladder-row.fail{background:var(--fail-bg)}
  .ladder-turn{font-family:ui-monospace,monospace;font-size:10px;color:var(--muted-2);flex-shrink:0;width:24px}
  .ladder-atk{color:var(--text-2);flex:1 1 50%;min-width:0}
  .ladder-arrow{color:var(--muted-2);flex-shrink:0}
  .ladder-out{color:var(--muted);font-family:ui-monospace,monospace;font-size:10px;flex:1 1 40%;min-width:0}
  .ladder-row.fail .ladder-out{color:var(--fail);font-weight:600}
  .ladder-flag{color:var(--fail);font-weight:800;flex-shrink:0}

  /* ── Passed compact table ── */
  .passed-table-wrap{border:1px solid var(--line);border-radius:10px;overflow:hidden}
  table.passed{width:100%;border-collapse:collapse}
  table.passed th{background:var(--surface-2);padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--line)}
  table.passed td{padding:8px 12px;font-size:11px;border-bottom:1px solid var(--line);vertical-align:top}
  table.passed tr:last-child td{border-bottom:none}
  .pt-eval{font-weight:600}
  .pt-take{color:var(--muted)}

  /* ── Full-mode evaluator sections / attack cards ── */
  .eval-section{margin-bottom:18px}
  .eval-section-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;margin-bottom:10px;break-after:avoid}
  .eval-section-num{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted-2)}
  .eval-section-name{font-size:14px;font-weight:700}
  .eval-section-stat{font-size:11px;color:var(--muted);margin-left:auto}
  .attack-card{border:1px solid var(--line);border-left:4px solid var(--line-2);border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:12px}
  .attack-card.pass{border-left-color:var(--pass)}
  .attack-card.fail{border-left-color:var(--fail)}
  .attack-card.error{border-left-color:#F59E0B;background:#FFFDF5}
  .attack-head{display:flex;align-items:center;gap:8px;margin-bottom:2px}
  .attack-title{font-size:13px;font-weight:700}
  .attack-head .verdict-tag{margin-left:auto}
  .attack-id{font-size:10px;color:var(--muted-2);font-family:ui-monospace,monospace;margin-bottom:10px}
  .convo-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:8px}

  /* ── Turns / chat bubbles ── */
  .turn{margin-bottom:10px}
  .turn-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .turn-no{font-family:ui-monospace,monospace;font-size:10px;color:var(--muted-2);background:var(--surface-2);border:1px solid var(--line);padding:1px 6px;border-radius:4px}
  .turn-title{font-size:11px;font-weight:600;color:var(--text-2)}
  .turn-verdict{margin-left:auto;font-size:10px;font-weight:700;padding:1px 8px;border-radius:3px;border:1px solid}
  .bubble{border-radius:8px;padding:9px 12px;margin-bottom:6px}
  .bubble-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px}
  .bubble-body{font-size:11px;line-height:1.55;color:var(--text)}
  mark.ev{background:#FEF08A;color:inherit;padding:0 2px;border-radius:2px;font-weight:600;-webkit-box-decoration-break:clone;box-decoration-break:clone}
  .excerpt-note{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:5px}
  .trunc-mark{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted-2);margin-top:5px}
  .fc-more{font-weight:600;color:var(--muted);text-transform:none;letter-spacing:0}
  .bubble.attacker{background:#FFF7ED;border:1px solid #FED7AA;border-left:3px solid var(--accent)}
  .bubble.attacker .bubble-label{color:#C2620E}
  .bubble.agent{background:var(--surface-2);border:1px solid var(--line);border-left:3px solid var(--line-2)}
  .bubble.agent .bubble-label{color:var(--muted)}
  .turn-reasoning{font-size:10.5px;color:var(--muted);font-style:italic;line-height:1.5;padding:6px 10px;background:var(--surface-2);border-radius:6px;border:1px solid var(--line)}

  /* ── Judge box ── */
  .judge-box{margin-top:8px;padding:10px 12px;border-radius:8px;border:1px solid;break-inside:avoid}
  .judge-box.pass{background:var(--pass-bg);border-color:var(--pass-border)}
  .judge-box.fail{background:var(--fail-bg);border-color:var(--fail-border)}
  .judge-box.error{background:#FFFBEB;border-color:#FDE68A}
  .judge-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:5px}
  .judge-verdict{font-size:12px;font-weight:800}
  .judge-meta{font-size:11px;color:var(--text-2)}
  .judge-reasoning{font-size:11.5px;color:var(--text-2);line-height:1.6}

  /* ── Footer ── */
  .footer{margin-top:28px;padding-top:14px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
  .footer-right{font-family:ui-monospace,monospace;color:var(--muted-2)}
</style>
</head>
<body>

<div class="cover">
  <div class="cover-top">
    <div class="cover-brand">
      <div class="cover-brand-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>
      </div>
      <div>
        <div class="cover-brand-name">Opfor</div>
        <div class="cover-brand-sub">Agent Red-team</div>
      </div>
    </div>
    <div class="cover-classification">Confidential</div>
  </div>

  <div class="cover-eyebrow">LLM Agent Security Assessment</div>
  <div class="cover-title">Adversarial Evaluation Report</div>
  <div class="cover-target">${esc(report.targetName)}</div>
  <div class="cover-sub">Automated red-team evaluation · opfor v0.2 · ${esc(dateStr)}</div>

  <div class="cover-verdict ${overallVerdict === "PASS" ? "pass" : "fail"}">
    <div>
      <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Overall Verdict</div>
      <div class="cover-verdict-big">${overallVerdict}</div>
    </div>
    <div class="cover-verdict-side">
      ${noScoreableTests ? "No scoreable tests" : `Safety score <strong>${summary.safetyScore}%</strong>`}<br>
      ${summary.passed}/${summary.total} tests passed · ${risk.label}
    </div>
  </div>

  <div class="cover-meta">
    <div class="cover-meta-item"><div class="cover-meta-k">Target System</div><div class="cover-meta-v">${esc(report.targetName)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Assessment Date</div><div class="cover-meta-v">${esc(dateStr)}, ${esc(timeStr)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Attack Model</div><div class="cover-meta-v mono">${esc(report.attackModel)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Judge Model</div><div class="cover-meta-v mono">${esc(report.judgeModel)}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Effort</div><div class="cover-meta-v">${esc(report.effort ?? "—")}</div></div>
    <div class="cover-meta-item"><div class="cover-meta-k">Report ID</div><div class="cover-meta-v mono">${esc(report.reportId)}</div></div>
  </div>
</div>

<!-- 1. Executive Summary -->
<div class="section">
  <div class="section-header">
    <div class="section-num">1</div>
    <div class="section-title">Executive Summary</div>
  </div>
  <div class="exec-banner ${overallVerdict === "PASS" ? "pass" : "fail"}">
    <div>
      <div class="exec-verdict-label">Overall Verdict</div>
      <div class="exec-verdict-text">${overallVerdict}</div>
    </div>
    <div class="exec-risk">${risk.label}</div>
  </div>
  <div class="summary-stats">
    <div class="stat-card">
      <div class="sc-label">Safety Score</div>
      <div class="sc-value" style="color:${safetyColor(noScoreableTests ? 0 : summary.safetyScore)}">${noScoreableTests ? "N/A" : `${summary.safetyScore}%`}</div>
      ${noScoreableTests ? "" : `<div class="sc-bar"><div class="sc-bar-fill" style="width:${summary.safetyScore}%;background:${safetyColor(summary.safetyScore)}"></div></div>`}
      <div class="sc-sub">${noScoreableTests ? "No scoreable tests" : `${summary.passed} of ${scoreDenominator} defended`}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Attack Success Rate</div>
      <div class="sc-value" style="color:${summary.attackSuccessRate > 0 ? "#DC2626" : "#059669"}">${noScoreableTests ? "N/A" : `${summary.attackSuccessRate}%`}</div>
      ${noScoreableTests ? "" : `<div class="sc-bar"><div class="sc-bar-fill" style="width:${summary.attackSuccessRate}%;background:${summary.attackSuccessRate > 0 ? "#DC2626" : "#059669"}"></div></div>`}
      <div class="sc-sub">${summary.failed} breached defenses</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Tests Passed</div>
      <div class="sc-value" style="color:#059669">${summary.passed}</div>
      <div class="sc-sub">of ${summary.total} total</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Evaluators Failed</div>
      <div class="sc-value" style="color:${evalsFailed > 0 ? "#DC2626" : "#059669"}">${evalsFailed}</div>
      <div class="sc-sub">${criticalCount} critical · ${highCount} high</div>
    </div>
  </div>
  <div class="summary-narrative">${narrative}</div>
</div>

<!-- 2. Assessment Scope -->
<div class="section">
  <div class="section-header">
    <div class="section-num">2</div>
    <div class="section-title">Assessment Scope</div>
  </div>
  <div class="scope-grid">
    <div class="scope-card">
      <div class="scope-card-title">Target</div>
      <div class="scope-row"><span class="scope-k">System</span><span class="scope-v">${esc(report.targetName)}</span></div>
      <div class="scope-row"><span class="scope-k">Type</span><span class="scope-v">${esc(report.targetKind ?? "agent")}</span></div>
      ${report.endpoint ? `<div class="scope-row"><span class="scope-k">Endpoint</span><span class="scope-v mono">${esc(report.endpoint)}</span></div>` : ""}
      <div class="scope-row"><span class="scope-k">Effort</span><span class="scope-v">${esc(report.effort ?? "—")}</span></div>
    </div>
    <div class="scope-card">
      <div class="scope-card-title">Evaluation Parameters</div>
      <div class="scope-row"><span class="scope-k">Evaluators</span><span class="scope-v">${report.evaluators.length}</span></div>
      <div class="scope-row"><span class="scope-k">Total Tests</span><span class="scope-v">${summary.total}</span></div>
      <div class="scope-row"><span class="scope-k">Attack Model</span><span class="scope-v mono">${esc(report.attackModel)}</span></div>
      <div class="scope-row"><span class="scope-k">Judge Model</span><span class="scope-v mono">${esc(report.judgeModel)}</span></div>
    </div>
  </div>
</div>

<!-- 3. Coverage Matrix -->
<div class="section">
  <div class="section-header">
    <div class="section-num">3</div>
    <div class="section-title">Coverage Matrix</div>
    <div class="section-subtitle">${report.evaluators.length} evaluator${report.evaluators.length === 1 ? "" : "s"} · ${summary.total} test${summary.total === 1 ? "" : "s"}</div>
  </div>
  <div class="results-table-wrap">
    <table class="results">
      <thead><tr>
        <th>#</th><th>Evaluator</th><th>Severity</th><th>Verdict</th><th>Tests</th><th>Pass</th><th>Fail</th>${anyErrors ? "<th>Err</th>" : ""}<th>Rate</th><th>Avg</th>
      </tr></thead>
      <tbody>${matrixRows}</tbody>
    </table>
  </div>
</div>

${detailSections}

<div class="footer">
  <div>Generated by Opfor v0.2 · ${esc(dateStr)}${mode === "full" ? " · full transcript" : ""}</div>
  <div class="footer-right">${esc(report.reportId)}</div>
</div>

</body>
</html>`;
}

// ── Chrome discovery & PDF rendering ──────────────────────────────────────────

function findChrome(): string | null {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH;
  const candidates = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"];
  for (const c of candidates) {
    const which = spawnSync("which", [c], { encoding: "utf8" });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  for (const p of [
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

function renderPdf(chrome: string, htmlPath: string, pdfPath: string): void {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=10000",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ];
  let res = spawnSync(chrome, args, { encoding: "utf8" });
  if (res.status !== 0 && !existsSync(pdfPath)) {
    const legacy = [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--print-to-pdf-no-header",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ];
    res = spawnSync(chrome, legacy, { encoding: "utf8" });
  }
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Chrome failed to produce a PDF.\n${res.stderr || res.stdout || "(no output)"}`
    );
  }
}

// ── Input resolution ──────────────────────────────────────────────────────────

function resolveJsonPath(input: string): string {
  let p = path.resolve(input);
  if (!existsSync(p)) throw new Error(`Path not found: ${input}`);
  if (statSync(p).isDirectory()) {
    const jsons = readdirSync(p).filter((f) => f.endsWith(".json"));
    const reportJson = jsons.find((f) => f.endsWith("-report.json")) ?? jsons[0];
    if (!reportJson) throw new Error(`No report JSON found in directory: ${input}`);
    p = path.join(p, reportJson);
  }
  return p;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function intFlag(argv: string[], name: string): number | undefined {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  if (!hit) return undefined;
  const n = parseInt(hit.split("=")[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const htmlOnly = argv.includes("--html-only");
  const mode: Mode = argv.includes("--full") ? "full" : "triage";
  const positionals = argv.filter((a) => !a.startsWith("--"));

  const agentCap = intFlag(argv, "--max-chars") ?? 600;
  CFG = {
    mode,
    agentCap,
    attackerCap: Math.min(agentCap, 320),
    maxDecisive: intFlag(argv, "--turns") ?? 2,
  };

  if (positionals.length === 0) {
    console.error(
      "Usage: tsx scripts/generate-pdf-report.ts <report.json|dir> [output.pdf]\n" +
        "  [--full] [--max-chars=N] [--turns=N] [--html-only]"
    );
    process.exit(1);
  }

  const jsonPath = resolveJsonPath(positionals[0]);
  const report = JSON.parse(readFileSync(jsonPath, "utf8")) as Report;
  if (!report.evaluators || !report.summary) {
    throw new Error(`File does not look like an Opfor report: ${jsonPath}`);
  }

  const defaultBase = jsonPath.replace(/\.json$/, "");
  const html = renderHtml(report);

  if (htmlOnly) {
    const htmlOut = positionals[1] ?? `${defaultBase}.pdf.html`;
    writeFileSync(htmlOut, html, "utf8");
    console.log(`✓ HTML written: ${htmlOut}`);
    return;
  }

  const pdfOut = path.resolve(positionals[1] ?? `${defaultBase}.pdf`);
  const chrome = findChrome();
  if (!chrome) {
    throw new Error(
      "No Chrome/Chromium binary found. Install Chrome or set CHROME_PATH.\n" +
        "Tip: run with --html-only to emit HTML and print to PDF from your browser instead."
    );
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "opfor-pdf-"));
  const htmlTmp = path.join(tmp, "report.html");
  try {
    writeFileSync(htmlTmp, html, "utf8");
    renderPdf(chrome, htmlTmp, pdfOut);
    console.log(`✓ PDF written: ${pdfOut} (${mode} mode)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
}
