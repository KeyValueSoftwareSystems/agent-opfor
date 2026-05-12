// ─────────────────────────────────────────────────────────────────
// Opfor red-team popup — vanilla JS implementation of the design.
// Drives idle / running / paused / done screens and the slide-in
// advanced panel. Talks to service_worker.js via the existing
// OPFOR_UI_RUN / RESUME / STOP / DISCARD_PAUSED message contracts.
// ─────────────────────────────────────────────────────────────────

const MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1",
  "gpt-5",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-3-7-sonnet-latest",
  "claude-haiku-4-5",
  "llama-3.1-70b",
  "llama-3.3-70b-versatile",
];

const $ = (id) => document.getElementById(id);

// ── State ───────────────────────────────────────────────────────
const state = {
  catalog: /** @type {null | { suites: any[]; evaluators: any[] }} */ (null),
  suiteId: "",
  selectedEvaluators: new Set(),
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  scrapeFromSite: true,
  agentDescription: "",
  maxTurns: 10,
  waitSec: 10,
  businessUseCase: "",
  judgeHint: "",
  saveTranscript: true,
  verbose: false,
  // Run state
  screen: /** @type {"idle"|"running"|"paused"|"done"} */ ("idle"),
  queue: /** @type {{id:string;name:string;sev:string}[]} */ ([]),
  evIdx: 0,
  results:
    /** @type {{id:string;name:string;sev:string;verdict:string;summary:string;raw:any}[]} */ ([]),
  running: false,
  cancelRequested: false,
  pauseRequested: false,
};

// ── Screen / status ────────────────────────────────────────────
const PILL_LABELS = { idle: "Ready", running: "Running", paused: "Paused", done: "Done" };

function setScreen(name) {
  state.screen = name;
  for (const s of ["idle", "running", "paused", "done"]) {
    const el = $("screen" + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.hidden = s !== name;
  }
  const pill = $("statusPill");
  pill.dataset.screen = name;
  $("statusPillText").textContent = PILL_LABELS[name] || "Ready";
  $("footer").dataset.screen = name;
  // Gear icon only useful on idle
  $("advancedBtn").style.display = name === "idle" ? "" : "none";
}

// ── Toggle (button with role=switch) ───────────────────────────
function bindToggle(btnId, getter, setter) {
  const btn = $(btnId);
  btn.setAttribute("aria-checked", String(getter()));
  btn.addEventListener("click", () => {
    setter(!getter());
    btn.setAttribute("aria-checked", String(getter()));
  });
}

// ── Custom dropdown ────────────────────────────────────────────
function buildDropdown(rootId, options, value, onChange) {
  const root = $(rootId);
  const button = root.querySelector(".dd-button");
  const labelEl = button.querySelector(".label");
  const menu = root.querySelector(".dd-menu");

  function render() {
    const cur = options.find((o) => o.value === value);
    labelEl.textContent = cur ? cur.label : "—";
    menu.innerHTML = "";
    for (const o of options) {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "dd-option";
      opt.setAttribute("role", "option");
      opt.setAttribute("aria-selected", String(o.value === value));
      const left = document.createElement("span");
      left.textContent = o.label;
      opt.appendChild(left);
      if (o.meta) {
        const m = document.createElement("span");
        m.className = "meta mono";
        m.textContent = o.meta;
        opt.appendChild(m);
      }
      opt.addEventListener("click", () => {
        value = o.value;
        root.dataset.open = "false";
        render();
        onChange(o.value);
      });
      menu.appendChild(opt);
    }
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    root.dataset.open = root.dataset.open === "true" ? "false" : "true";
  });

  document.addEventListener("mousedown", (e) => {
    if (!root.contains(e.target)) root.dataset.open = "false";
  });

  render();
  return {
    setValue(v) {
      value = v;
      render();
    },
    setOptions(next) {
      options = next;
      render();
    },
  };
}

// ── Evaluator list ─────────────────────────────────────────────
function renderEvaluatorList() {
  const suite = state.catalog?.suites.find((s) => s.id === state.suiteId);
  const list = $("evalsList");
  list.innerHTML = "";
  if (!suite) {
    $("evalsCount").textContent = "0/0";
    return;
  }
  const byId = new Map(state.catalog.evaluators.map((e) => [e.id, e]));
  const items = suite.evaluatorIds.map((id) => byId.get(id)).filter(Boolean);
  for (const ev of items) {
    const checked = state.selectedEvaluators.has(ev.id);
    const row = document.createElement("div");
    row.className = "eval-item";
    row.setAttribute("aria-checked", String(checked));
    row.innerHTML = `
      <div class="eval-check">${
        checked
          ? `<svg width="9" height="9" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="#0A0D14" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : ""
      }</div>
      <span class="eval-name"></span>
      <span class="sev mono" data-sev="${normalizeSev(ev.severity)}"></span>
    `;
    row.querySelector(".eval-name").textContent = ev.name;
    row.querySelector(".sev").textContent = shortSev(ev.severity);
    row.addEventListener("click", () => {
      if (state.selectedEvaluators.has(ev.id)) state.selectedEvaluators.delete(ev.id);
      else state.selectedEvaluators.add(ev.id);
      renderEvaluatorList();
      updateRunButton();
    });
    list.appendChild(row);
  }

  const allOn = items.every((e) => state.selectedEvaluators.has(e.id));
  const noneOn = state.selectedEvaluators.size === 0;
  const countEl = $("evalsCount");
  countEl.textContent = `${state.selectedEvaluators.size}/${items.length}`;
  countEl.dataset.zero = String(noneOn);
  updateEvalsSelectAll(allOn, noneOn);
}

function updateEvalsSelectAll(allOn, noneOn) {
  const el = $("evalsSelectAll");
  if (!el) return;
  if (allOn) {
    el.dataset.state = "all";
    el.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="#0A0D14" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (noneOn) {
    el.dataset.state = "none";
    el.innerHTML = "";
  } else {
    el.dataset.state = "some";
    el.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" stroke="#0A0D14" stroke-width="3.5" stroke-linecap="round"/></svg>`;
  }
}

function normalizeSev(s) {
  if (!s) return "low";
  const v = String(s).toLowerCase();
  if (v === "medium") return "med";
  return v;
}
function shortSev(s) {
  return normalizeSev(s);
}

// ── Run button enable/disable ──────────────────────────────────
function updateRunButton() {
  $("runBtn").disabled = state.selectedEvaluators.size === 0 || !state.suiteId || !state.catalog;
}

// ── Suite description + dropdown wiring ────────────────────────
let suiteDD, modelDD;
function setSuite(id) {
  state.suiteId = id;
  const suite = state.catalog?.suites.find((s) => s.id === id);
  $("suiteDescription").textContent = suite?.description || "";
  state.selectedEvaluators = new Set(suite ? suite.evaluatorIds : []);
  renderEvaluatorList();
  updateRunButton();
}

// ── Scrape toggle / agent description ──────────────────────────
async function refreshScrapeMeta() {
  const meta = $("scrapeMeta");
  const wrap = $("agentDescWrap");
  const ta = $("agentDescription");
  if (state.scrapeFromSite) {
    wrap.hidden = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = tab?.url ? new URL(tab.url).host : "current tab";
      meta.textContent = host || "current tab";
    } catch {
      meta.textContent = "current tab";
    }
  } else {
    wrap.hidden = false;
    meta.textContent = "manual description";
    autoSizeTextarea(ta);
  }
}

function autoSizeTextarea(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}

// ── Advanced panel ─────────────────────────────────────────────
function openAdvanced() {
  $("advanced").dataset.open = "true";
}
function closeAdvanced() {
  $("advanced").dataset.open = "false";
}

function bindStepper(rangeId, valueLabelId, key, min, max) {
  const range = $(rangeId);
  const label = $(valueLabelId);
  const sync = () => {
    label.textContent = String(state[key]);
    range.value = String(state[key]);
  };
  range.addEventListener("input", () => {
    state[key] = clamp(Number(range.value) || min, min, max);
    sync();
    saveSettings();
  });
  sync();
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-step]");
  if (!t) return;
  const key = t.dataset.target;
  const step = Number(t.dataset.step);
  const range = $(key);
  if (!range) return;
  const next = clamp(Number(range.value) + step, Number(range.min), Number(range.max));
  state[key] = next;
  range.value = String(next);
  range.dispatchEvent(new Event("input"));
});

// ── Settings persistence ───────────────────────────────────────
const POPUP_SETTINGS_KEY = "opforPopupSettings";

async function loadSettings() {
  const stored = await chrome.storage.local.get([POPUP_SETTINGS_KEY, "opforLlmProfiles"]);
  const s = stored[POPUP_SETTINGS_KEY] || {};
  Object.assign(state, {
    scrapeFromSite: s.scrapeFromSite ?? true,
    agentDescription: s.agentDescription ?? "",
    maxTurns: clamp(Number(s.maxTurns) || 10, 1, 20),
    waitSec: clamp(Number(s.waitSec) || 10, 3, 30),
    businessUseCase: s.businessUseCase ?? "",
    judgeHint: s.judgeHint ?? "",
    saveTranscript: s.saveTranscript ?? true,
    verbose: s.verbose ?? false,
  });
  const profiles = stored.opforLlmProfiles;
  if (profiles?.attacker) {
    state.baseUrl = profiles.attacker.baseUrl || state.baseUrl;
    state.model = profiles.attacker.model || state.model;
    state.apiKey = profiles.attacker.apiKey || "";
  }
}

async function saveSettings() {
  await chrome.storage.local.set({
    [POPUP_SETTINGS_KEY]: {
      scrapeFromSite: state.scrapeFromSite,
      agentDescription: state.agentDescription,
      maxTurns: state.maxTurns,
      waitSec: state.waitSec,
      businessUseCase: state.businessUseCase,
      judgeHint: state.judgeHint,
      saveTranscript: state.saveTranscript,
      verbose: state.verbose,
    },
  });
}

async function saveModelAndKey() {
  // Single popup-driven config — same baseUrl/model/apiKey for all three roles.
  const baseUrl = (state.baseUrl || "").trim() || "https://api.openai.com/v1";
  const next = { v: 1, provider: "openai_compat" };
  for (const k of ["attacker", "judge", "reader"]) {
    next[k] = {
      baseUrl,
      model: state.model,
      apiKey: state.apiKey,
      enabled: true,
    };
  }
  await chrome.storage.local.set({ opforLlmProfiles: next });
}

// ── Catalog ────────────────────────────────────────────────────
async function loadCatalog() {
  const url = chrome.runtime.getURL("catalog.json");
  const r = await fetch(url);
  if (!r.ok)
    throw new Error(
      `catalog.json (${r.status}). Run: node src/extension/scripts/build-catalog.mjs`
    );
  state.catalog = await r.json();
  const opts = state.catalog.suites.map((s) => ({
    value: s.id,
    label: s.name,
    meta: `${s.evaluatorIds.length} evals`,
  }));
  suiteDD.setOptions(opts);
  const defaultSuite =
    state.catalog.suites.find((s) => s.id === "owasp-llm-top10")?.id ||
    state.catalog.suites[0]?.id ||
    "";
  suiteDD.setValue(defaultSuite);
  setSuite(defaultSuite);

  // For OWASP LLM Top 10, default to only "prompt-injection" selected.
  if (defaultSuite === "owasp-llm-top10") {
    state.selectedEvaluators = new Set(["prompt-injection"]);
    renderEvaluatorList();
    updateRunButton();
  }
}

// ── Paused-run banner sync ─────────────────────────────────────
async function checkPausedRun() {
  const { opforPausedRun } = await chrome.storage.local.get("opforPausedRun");
  if (!opforPausedRun?.plan?.inputSelector) return false;

  const evId = opforPausedRun.evaluatorId || opforPausedRun.evaluatorSnapshot?.id;
  const evName = opforPausedRun.evaluatorSnapshot?.name || evId || "—";
  const sev = normalizeSev(opforPausedRun.evaluatorSnapshot?.severity);

  // If popup was reopened on a paused run, reconstruct a minimal queue so
  // Resume can continue the paused evaluator.
  if (state.queue.length === 0) {
    state.suiteId = opforPausedRun.suiteId || state.suiteId;
    state.queue = [{ id: evId || "paused", name: evName, sev }];
    state.evIdx = 0;
    state.results = [];
  }

  $("pausedSuite").textContent = state.suiteId || "—";
  $("pausedEvaluator").textContent = evName;
  $("pausedModel").textContent = state.model;
  $("pausedSub").textContent = `evaluator paused · saved`;
  $("pausedElapsed").textContent = "—";
  setScreen("paused");
  return true;
}

// ── Running screen rendering ───────────────────────────────────
let runTickInterval = null;

function renderRunningHeader() {
  const total = state.queue.length;
  const idx = state.evIdx;
  $("runEvalIdx").textContent = String(Math.min(idx + 1, total));
  $("runEvalTotal").textContent = String(total);
  const overall = total ? ((idx + (state.subProgress || 0)) / total) * 100 : 0;
  $("runOverallPct").textContent = `${Math.round(overall)}%`;
  $("runOverallFill").style.width = `${overall}%`;
  if (state.currentPhase !== "locating") {
    const cur = state.queue[idx];
    $("runEvalName").textContent = cur?.name || "—";
  }
}

function renderRunStrip() {
  const strip = $("runStrip");
  strip.innerHTML = "";
  state.queue.forEach((ev, i) => {
    const result = state.results[i];
    const isCurrent = i === state.evIdx && !result;
    const stateAttr = result
      ? result.verdict === "PASS"
        ? "pass"
        : "fail"
      : isCurrent
        ? "current"
        : "pending";
    const chip = document.createElement("div");
    chip.className = "ev-strip-chip";
    chip.dataset.state = stateAttr;
    chip.title = ev.name;
    chip.innerHTML = `<div class="dot"></div><span class="id mono"></span>`;
    chip.querySelector(".id").textContent = ev.id;
    strip.appendChild(chip);
  });
}

const LOCATE_HINTS = [
  "Loading page DOM",
  "Scanning iframes & shadow roots",
  "Matching widget signatures",
  "Detected: chat widget",
  "Probing message input",
  "Confirming send handler",
  "Ready to attack",
];
let locateHintInterval = null;
function startLocateHintLoop() {
  stopLocateHintLoop();
  let i = 0;
  const locateText = $("runLocateText");
  if (locateText) locateText.textContent = LOCATE_HINTS[i];
  locateHintInterval = setInterval(() => {
    if (state.currentPhase !== "locating") {
      stopLocateHintLoop();
      return;
    }
    i = (i + 1) % LOCATE_HINTS.length;
    if (locateText) locateText.textContent = LOCATE_HINTS[i];
  }, 900);
}
function stopLocateHintLoop() {
  if (locateHintInterval) clearInterval(locateHintInterval);
  locateHintInterval = null;
}

function setPhase(phase) {
  state.currentPhase = phase;
  $("runJudgeRow").hidden = phase !== "judging";
  $("runLocateRow").hidden = phase !== "locating";
  $("runTurnTrack").hidden = phase === "locating";
  $("runBubbles").hidden = phase !== "running";
  const phaseEl = $("runPhaseText");
  if (phase === "locating") {
    $("runEvalName").textContent = "Detecting chat widget";
    $("runTurnLabel").textContent = "init";
    phaseEl.textContent = "Scanning DOM";
    phaseEl.classList.remove("shimmer");
    startLocateHintLoop();
  } else {
    stopLocateHintLoop();
    if (phase === "judging") {
      phaseEl.textContent = "Evaluating Transcript";
      phaseEl.classList.remove("shimmer");
      $("runTurnLabel").textContent = "judge";
      const cur = state.queue[state.evIdx];
      if (cur) $("runEvalName").textContent = cur.name;
    } else if (phase === "running") {
      phaseEl.textContent = "Adversarial Turn";
      phaseEl.classList.add("shimmer");
      const cur = state.queue[state.evIdx];
      if (cur) $("runEvalName").textContent = cur.name;
    } else {
      phaseEl.textContent = "";
      phaseEl.classList.remove("shimmer");
    }
  }
}

function setTurnProgress(turn) {
  const total = state.maxTurns || 10;
  const pct = Math.min(100, (turn / total) * 100);
  $("runTurnFill").style.width = `${pct}%`;
  if (state.currentPhase !== "locating") {
    $("runTurnLabel").textContent =
      `${String(turn).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
  }
  state.subProgress = turn / total;
  renderRunningHeader();
}

// Latest in-flight turn pair, populated by progress events. Reset per evaluator.
let latestTurn = { round: 0, user: "", assistant: "" };

function renderBubbles() {
  const box = $("runBubbles");
  box.innerHTML = "";
  if (!latestTurn.user && !latestTurn.assistant) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (latestTurn.user) {
    const a = document.createElement("div");
    a.className = "bubble";
    a.dataset.who = "attacker";
    a.innerHTML = `<div class="kicker">// attacker</div><div class="body"></div>`;
    a.querySelector(".body").textContent = latestTurn.user;
    box.appendChild(a);
  }
  const g = document.createElement("div");
  g.className = "bubble";
  g.dataset.who = "agent";
  g.innerHTML = `<div class="kicker">// agent</div><div class="body"></div>`;
  const body = g.querySelector(".body");
  if (latestTurn.assistant) {
    body.textContent = latestTurn.assistant;
  } else {
    body.textContent = "";
    body.dataset.pending = "true";
  }
  box.appendChild(g);
}

function resetBubbles() {
  latestTurn = { round: 0, user: "", assistant: "" };
  $("runBubbles").innerHTML = "";
  $("runBubbles").hidden = true;
}

let progressActive = false;

function handleProgress(message) {
  if (state.screen !== "running") return;
  progressActive = true;
  stopCosmeticTicker();
  if (message.kind === "phase") {
    setPhase(message.phase);
    if (message.phase === "running") setTurnProgress(0);
    if (message.phase === "locating") {
      resetBubbles();
      setTurnProgress(0);
    }
  } else if (message.kind === "turn") {
    setPhase("running");
    if (message.round !== latestTurn.round) {
      latestTurn = { round: message.round, user: "", assistant: "" };
    }
    if (message.role === "user") {
      latestTurn.user = String(message.content || "");
    } else if (message.role === "assistant") {
      latestTurn.assistant = String(message.content || "");
      setTurnProgress(message.round);
    }
    renderBubbles();
  }
}

function startCosmeticTicker() {
  // Fallback animation while real progress events haven't arrived yet.
  // Stays in the locating state until either: a phase=running progress event
  // (preferred), or — if the popup never receives one — the cosmetic timer
  // can still advance turn progress once we've left locating.
  stopCosmeticTicker();
  setPhase("locating");
  setTurnProgress(0);
  let turn = 0;
  let startedAt = null;
  const totalMs = Math.max(4000, state.maxTurns * state.waitSec * 1000);
  runTickInterval = setInterval(() => {
    if (state.cancelRequested || state.pauseRequested) return;
    if (state.currentPhase !== "running") return;
    if (startedAt == null) startedAt = Date.now();
    const elapsed = Date.now() - startedAt;
    const ratio = Math.min(0.95, elapsed / totalMs);
    const desired = Math.floor(ratio * state.maxTurns);
    if (desired > turn) {
      turn = desired;
      setTurnProgress(turn);
    }
  }, 400);
}

function stopCosmeticTicker() {
  if (runTickInterval) clearInterval(runTickInterval);
  runTickInterval = null;
}

// ── Done screen rendering ──────────────────────────────────────
function renderDone() {
  const failed = state.results.filter((r) => r.verdict === "FAIL");
  const passed = state.results.filter((r) => r.verdict === "PASS");
  const verdict = failed.length === 0 && state.results.length > 0 ? "PASS" : "FAIL";

  const card = $("verdictCard");
  card.dataset.verdict = verdict;
  $("verdictText").textContent = verdict;

  // Verdict icon: check on PASS, shield on FAIL
  $("verdictIcon").innerHTML =
    verdict === "PASS"
      ? `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

  $("verdictSummary").textContent =
    verdict === "PASS"
      ? `Agent passed all ${state.results.length} evaluators in this suite. No vulnerabilities surfaced under the configured turn budget.`
      : `Agent failed ${failed.length} of ${state.results.length} evaluators. ${
          failed.length === 1 ? "One vulnerability" : "Multiple vulnerabilities"
        } surfaced under sustained adversarial pressure.`;

  $("statPassed").textContent = String(passed.length);
  $("statFailed").textContent = String(failed.length);
  $("statTotal").textContent = String(state.results.length);

  $("resultsCountLabel").textContent = `Evaluators · ${state.results.length}`;
  const list = $("resultsList");
  list.innerHTML = "";
  for (const r of state.results) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.dataset.verdict = r.verdict;
    row.innerHTML = `
      <div class="dot"></div>
      <span class="name"></span>
      <span class="result-pill mono" data-verdict="${r.verdict}">${r.verdict}</span>
    `;
    row.querySelector(".name").textContent = r.name;
    list.appendChild(row);
  }
}

// ── Report generation (per skills/opfor-run/report-schema.md) ──
function severityFull(s) {
  const v = String(s || "").toLowerCase();
  if (v === "med" || v === "medium") return "medium";
  if (v === "critical" || v === "high" || v === "low") return v;
  return "low";
}
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_HEX = { critical: "#DC2626", high: "#EA580C", medium: "#EAB308", low: "#16A34A" };

function scoreFor(record) {
  const raw = record.raw?.judgment?.score ?? record.raw?.score;
  if (Number.isFinite(raw)) return clamp(Math.round(Number(raw)), 0, 10);
  if (record.verdict === "PASS") return 0;
  const sev = severityFull(record.sev);
  return sev === "critical" ? 9 : sev === "high" ? 7 : sev === "medium" ? 5 : 3;
}

function evidenceFor(record) {
  const j = record.raw?.judgment || {};
  const findings = Array.isArray(j.findings) ? j.findings : [];
  const first = findings[0];
  const text =
    (typeof first === "string" && first) || first?.evidence || first?.quote || j.evidence || "";
  if (!text) return "N/A";
  return text.length > 200 ? text.slice(0, 200) + "…" : text;
}

function buildReport() {
  const total = state.results.length;
  const passed = state.results.filter((r) => r.verdict === "PASS").length;
  const failed = total - passed;
  const safetyScore = total ? Math.round((passed / total) * 100) : 0;
  const attackSuccessRate = total ? Math.round((failed / total) * 100) : 0;

  const evaluatorResults = state.results.map((r) => {
    const score = scoreFor(r);
    const sev = severityFull(r.sev);
    return {
      id: r.id,
      name: r.name,
      severity: sev,
      totalTests: 1,
      passed: r.verdict === "PASS" ? 1 : 0,
      failed: r.verdict === "FAIL" ? 1 : 0,
      passRate: r.verdict === "PASS" ? 100 : 0,
      failRate: r.verdict === "FAIL" ? 100 : 0,
      avgScore: score,
      testResults: [
        {
          testNumber: 1,
          pattern: r.name,
          verdict: r.verdict,
          score,
          confidence: clamp(Math.round(Number(r.raw?.judgment?.confidence ?? 90)), 0, 100),
          evidence: evidenceFor(r),
          reasoning: r.summary || "—",
        },
      ],
      raw: r.raw,
    };
  });

  evaluatorResults.sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.avgScore - a.avgScore
  );

  const failedRecords = state.results.filter((r) => r.verdict === "FAIL");
  const findings = (sev) =>
    failedRecords
      .filter((r) => severityFull(r.sev) === sev)
      .map((r) => ({
        evaluator: r.name,
        evaluatorId: r.id,
        testNumber: 1,
        score: scoreFor(r),
        description: r.summary || "—",
      }))
      .sort((a, b) => b.score - a.score)
      .map((f, i) => ({ rank: i + 1, ...f }));

  const criticalFindings = findings("critical");
  const highFindings = findings("high");
  const evalsWithFailures = new Set(failedRecords.map((r) => r.id)).size;

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const reportId = `opfor-${state.suiteId || "run"}-${stamp}`;

  const targetUrl =
    state.results[0]?.raw?.siteUrl ||
    state.results[0]?.raw?.frameUrl ||
    (state.scrapeFromSite ? "active tab" : "manual description");

  return {
    metadata: {
      reportId,
      configId: state.suiteId || "run",
      framework: "opfor v0.2",
      generated: now.toISOString(),
      duration: "—",
      llmJudge: state.model,
    },
    target: {
      name: targetUrl,
      type: "chatbot",
      targetType: "http-endpoint",
      endpoint: targetUrl,
      model: state.model,
      assessmentDate: now.toISOString(),
    },
    applicationContext: {
      purpose: state.businessUseCase || "—",
      userTypes: [],
      sensitiveData: [],
      dangerousActions: [],
      forbiddenTopics: [],
    },
    summary: {
      totalEvaluators: total,
      totalTests: total,
      passed,
      failed,
      safetyScore,
      attackSuccessRate,
      cleanRules: passed,
      evaluationsFailed: evalsWithFailures,
      criticalFindings: criticalFindings.length,
      highFindings: highFindings.length,
    },
    evaluatorResults,
    criticalFindings,
    highFindings,
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function safetyColor(score) {
  if (score >= 70) return "#10B981";
  if (score >= 50) return "#EAB308";
  return "#EF4444";
}

function sevDot(sev) {
  return { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" }[sev] || "⚪";
}

function generateHtmlReport(report) {
  const { metadata, target, summary, evaluatorResults, criticalFindings, highFindings } = report;
  const passPct = summary.totalTests ? Math.round((summary.passed / summary.totalTests) * 360) : 0;
  const failPct = 360 - passPct;

  const cards = `
    <div class="cards">
      <div class="card" style="--accent:${safetyColor(summary.safetyScore)}">
        <div class="card-label">Safety Score</div>
        <div class="card-value" style="color:${safetyColor(summary.safetyScore)}">${summary.safetyScore}%</div>
        <div class="bar"><div class="bar-fill" style="width:${summary.safetyScore}%; background:${safetyColor(summary.safetyScore)}"></div></div>
      </div>
      <div class="card">
        <div class="card-label">Evaluations Failed</div>
        <div class="card-value" style="color:#EF4444">${summary.evaluationsFailed} <span class="card-sub">(${
          summary.totalEvaluators
            ? Math.round((summary.evaluationsFailed / summary.totalEvaluators) * 100)
            : 0
        }%)</span></div>
      </div>
      <div class="card">
        <div class="card-label">Attack Success Rate</div>
        <div class="card-value" style="color:#EF4444">${summary.attackSuccessRate}%</div>
      </div>
      <div class="card">
        <div class="card-label">Clean Rules</div>
        <div class="card-value" style="color:#10B981">${summary.cleanRules}</div>
      </div>
    </div>`;

  const tableRows = evaluatorResults
    .map(
      (e) => `
        <tr>
          <td><span class="sev-badge" style="background:${SEV_HEX[e.severity]}1A;color:${SEV_HEX[e.severity]};border-color:${SEV_HEX[e.severity]}55">${sevDot(
            e.severity
          )} ${escapeHtml(e.severity)}</span> ${escapeHtml(e.name)}</td>
          <td>${e.totalTests}</td>
          <td style="color:#10B981">${e.passed}</td>
          <td style="color:#EF4444">${e.failed}</td>
          <td>${e.passRate}%</td>
          <td>${e.avgScore.toFixed(1)}/10</td>
        </tr>`
    )
    .join("");

  const findingsList = (title, list) =>
    list.length === 0
      ? ""
      : `<section class="findings">
        <h3>${escapeHtml(title)} <span class="muted">(${list.length} total)</span></h3>
        <ol>
          ${list
            .map(
              (f) =>
                `<li><strong>${escapeHtml(f.evaluator)}</strong> — Test #${f.testNumber} — Score ${f.score}/10 — ${escapeHtml(
                  truncate(f.description, 220)
                )}</li>`
            )
            .join("")}
        </ol>
      </section>`;

  // Service worker returns BOTH `transcript` ([{role,content}, ...]) and
  // `turns` (turnLog: [{round, userMessage, assistantPreview, ...}]). Prefer
  // the transcript array since it carries full assistant responses; fall back
  // to turnLog when transcript is missing or empty.
  const turnsForReport = (raw) => {
    const tr = Array.isArray(raw?.transcript) ? raw.transcript : [];
    if (tr.length) {
      const pairs = [];
      for (let i = 0; i < tr.length; i += 2) {
        const u = tr[i]?.role === "user" ? String(tr[i].content || "") : "";
        const next = tr[i + 1];
        const a = next && next.role === "assistant" ? String(next.content || "") : "";
        if (u || a) pairs.push({ user: u, assistant: a });
      }
      if (pairs.length) return pairs;
    }
    const tl = Array.isArray(raw?.turns) ? raw.turns : [];
    return tl.map((t) => ({
      user: String(
        t.userMessage || t.user || t.attacker || (t.role === "user" ? t.content : "") || ""
      ),
      assistant: String(
        t.assistantPreview ||
          t.bot ||
          t.agent ||
          t.assistant ||
          (t.role === "assistant" ? t.content : "") ||
          ""
      ),
    }));
  };

  const appendix = evaluatorResults
    .map((e) => {
      const turns = turnsForReport(e.raw);
      const transcript =
        state.saveTranscript && turns.length
          ? `<div class="transcript">${turns
              .map(
                (t, i) => `
              <div class="turn">
                <div class="turn-label">Turn ${i + 1} · attacker</div>
                <pre>${escapeHtml(truncate(t.user, 4000))}</pre>
                <div class="turn-label">Turn ${i + 1} · agent</div>
                <pre>${escapeHtml(truncate(t.assistant, 4000))}</pre>
              </div>`
              )
              .join("")}</div>`
          : "";
      const tr = e.testResults[0] || {};
      return `
        <details class="evaluator-block">
          <summary>
            <span class="sev-badge" style="background:${SEV_HEX[e.severity]}1A;color:${SEV_HEX[e.severity]};border-color:${SEV_HEX[e.severity]}55">${sevDot(
              e.severity
            )} ${escapeHtml(e.severity)}</span>
            ${escapeHtml(e.name)}
            <span class="verdict-pill" data-v="${tr.verdict}">${tr.verdict}</span>
          </summary>
          <div class="block-body">
            <table class="meta-table">
              <tr><th>Verdict</th><td>${tr.verdict}</td></tr>
              <tr><th>Score</th><td>${tr.score}/10</td></tr>
              <tr><th>Confidence</th><td>${tr.confidence}%</td></tr>
              <tr><th>Pattern</th><td>${escapeHtml(tr.pattern || "—")}</td></tr>
              <tr><th>Evidence</th><td>${escapeHtml(tr.evidence || "N/A")}</td></tr>
              <tr><th>Reasoning</th><td>${escapeHtml(tr.reasoning || "—")}</td></tr>
            </table>
            ${transcript}
          </div>
        </details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Opfor Report — ${escapeHtml(target.name)}</title>
<style>
  :root { --bg:#0F172A; --panel:#FFFFFF; --text:#0F172A; --muted:#64748B; --line:#E2E8F0; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#F8FAFC;color:var(--text);font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .container{max-width:1100px;margin:0 auto;padding:32px 24px}
  header.report-head{background:linear-gradient(135deg,#1E293B 0%,#0F172A 100%);color:#fff;border-radius:12px;padding:24px;margin-bottom:24px}
  header.report-head h1{margin:0 0 6px;font-size:22px}
  header.report-head .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px 24px;margin-top:14px;font-size:13px;color:#CBD5E1}
  header.report-head .meta b{color:#fff;font-weight:600}
  header.report-head .pill{display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,0.1);font-size:11px;letter-spacing:0.06em;text-transform:uppercase}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,0.03)}
  .card-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}
  .card-value{font-size:32px;font-weight:700;line-height:1}
  .card-sub{font-size:14px;font-weight:500;color:var(--muted)}
  .bar{height:6px;background:#E2E8F0;border-radius:3px;margin-top:10px;overflow:hidden}
  .bar-fill{height:100%}
  section.suite{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:24px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center}
  .suite h2{margin:0 0 4px;font-size:16px}
  .suite p{margin:0;color:var(--muted)}
  .donut{width:120px;height:120px;border-radius:50%;background:conic-gradient(#10B981 0 ${passPct}deg,#EF4444 ${passPct}deg 360deg);display:flex;align-items:center;justify-content:center;position:relative}
  .donut::after{content:"";position:absolute;inset:14px;background:#fff;border-radius:50%}
  .donut-text{position:relative;text-align:center}
  .donut-text b{font-size:20px}
  .donut-text span{font-size:11px;color:var(--muted);display:block}
  table.results{width:100%;background:#fff;border:1px solid var(--line);border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;margin-bottom:24px}
  table.results th,table.results td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--line);font-size:13px}
  table.results th{background:#F1F5F9;font-weight:600;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:0.06em}
  table.results tr:nth-child(even) td{background:#F8FAFC}
  table.results tr:last-child td{border-bottom:none}
  .sev-badge{display:inline-block;padding:2px 8px;border:1px solid;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.04em;margin-right:6px}
  section.findings{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
  section.findings h3{margin:0 0 10px;font-size:15px}
  section.findings ol{margin:0;padding-left:20px}
  section.findings li{margin-bottom:8px;line-height:1.5}
  .muted{color:var(--muted);font-weight:400;font-size:13px}
  details.evaluator-block{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
  details.evaluator-block > summary{padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;font-weight:600}
  details.evaluator-block .verdict-pill{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:0.06em;padding:2px 8px;border-radius:4px}
  details.evaluator-block .verdict-pill[data-v="PASS"]{background:#D1FAE5;color:#047857}
  details.evaluator-block .verdict-pill[data-v="FAIL"]{background:#FEE2E2;color:#B91C1C}
  details.evaluator-block .block-body{padding:0 16px 16px;border-top:1px solid var(--line)}
  table.meta-table{width:100%;border-collapse:collapse;margin-top:14px}
  table.meta-table th{text-align:left;color:var(--muted);font-weight:500;width:120px;padding:6px 0;vertical-align:top;font-size:12px}
  table.meta-table td{padding:6px 0;font-size:13px}
  .transcript{margin-top:14px;display:flex;flex-direction:column;gap:6px}
  .transcript .turn{background:#F8FAFC;border:1px solid var(--line);border-radius:8px;padding:12px}
  .transcript .turn-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
  .transcript pre{margin:0 0 10px;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  h2.section-h{font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin:28px 0 12px}
  @media print{
    body{background:#fff}
    header.report-head{background:#0F172A;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .card,table.results,section.findings,details.evaluator-block{break-inside:avoid;box-shadow:none}
    details.evaluator-block{border:1px solid var(--line)}
    details.evaluator-block[open] > summary{page-break-after:avoid}
  }
  @media (max-width:640px){
    .container{padding:16px}
    section.suite{grid-template-columns:1fr}
    .donut{margin:0 auto}
    table.results{display:block;overflow-x:auto;white-space:nowrap}
  }
</style>
</head>
<body>
  <div class="container">
    <header class="report-head">
      <span class="pill">${escapeHtml(metadata.framework)}</span>
      <h1>Opfor Red-team Report</h1>
      <div class="meta">
        <div><b>Run ID</b><br>${escapeHtml(metadata.reportId)}</div>
        <div><b>Suite</b><br>${escapeHtml(metadata.configId)}</div>
        <div><b>Target</b><br>${escapeHtml(target.name)}</div>
        <div><b>Model</b><br>${escapeHtml(target.model)}</div>
        <div><b>Generated</b><br>${escapeHtml(new Date(metadata.generated).toLocaleString())}</div>
        <div><b>Results</b><br>${summary.passed}/${summary.totalTests} passed</div>
      </div>
    </header>

    ${cards}

    <section class="suite">
      <div>
        <h2>${escapeHtml(metadata.configId)}</h2>
        <p>${summary.totalEvaluators} evaluator${summary.totalEvaluators === 1 ? "" : "s"} · ${summary.totalTests} test${
          summary.totalTests === 1 ? "" : "s"
        } · <span style="color:#10B981">${summary.passed} passed</span> · <span style="color:#EF4444">${summary.failed} failed</span></p>
      </div>
      <div class="donut" aria-label="Pass/fail breakdown">
        <div class="donut-text"><b>${summary.safetyScore}%</b><span>safety</span></div>
      </div>
    </section>

    <h2 class="section-h">Detailed Results</h2>
    <table class="results">
      <thead>
        <tr>
          <th>Evaluator</th><th>Tests</th><th>Passed</th><th>Failed</th><th>Pass Rate</th><th>Avg Score</th>
        </tr>
      </thead>
      <tbody>${tableRows || `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">No evaluators executed.</td></tr>`}</tbody>
    </table>

    ${findingsList("Critical Findings", criticalFindings)}
    ${findingsList("High Findings", highFindings)}

    <h2 class="section-h">Full Test Cases and Responses</h2>
    ${appendix}
  </div>
</body>
</html>`;
}

async function downloadReport() {
  // If state.results is empty (popup was reopened after run), recover from storage.
  if (!state.results.length) {
    try {
      const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
      if (opforLastResult?.judgment) {
        const verdict =
          String(opforLastResult.judgment.verdict || "FAIL").toUpperCase() === "PASS"
            ? "PASS"
            : "FAIL";
        const partialNote = opforLastResult.partial ? " (partial run)" : "";
        state.results = [
          {
            id: opforLastResult.evaluatorId || "unknown",
            name: opforLastResult.evaluatorName || "Evaluator",
            sev: normalizeSev(opforLastResult.severity),
            verdict,
            summary: (opforLastResult.judgment.summary || "") + partialNote,
            raw: opforLastResult,
          },
        ];
      } else if (opforLastResult) {
        // No judgment available — show transcript info if we have it
        const turnCount = opforLastResult.transcript?.length || 0;
        state.results = [
          {
            id: opforLastResult.evaluatorId || "unknown",
            name: opforLastResult.evaluatorName || "Evaluator",
            sev: normalizeSev(opforLastResult.severity),
            verdict: "FAIL",
            summary: opforLastResult.errorMessage
              ? `Run failed after ${Math.floor(turnCount / 2)} turns: ${opforLastResult.errorMessage}`
              : `Run ended with ${Math.floor(turnCount / 2)} turns but no judgment was produced.`,
            raw: opforLastResult,
          },
        ];
      }
    } catch {}
  }
  const report = buildReport();
  const html = generateHtmlReport(report);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.metadata.reportId}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Run loop ───────────────────────────────────────────────────
async function runOneEvaluator(ev, { resume = false } = {}) {
  resetBubbles();
  progressActive = false;
  startCosmeticTicker();
  const payload = resume
    ? { type: "OPFOR_UI_RESUME" }
    : {
        type: "OPFOR_UI_RUN",
        suiteId: state.suiteId,
        evaluatorId: ev.id,
        maxRounds: state.maxTurns,
        waitMs: state.waitSec * 1000,
      };
  setPhase("locating");
  let result;
  try {
    result = await chrome.runtime.sendMessage(payload);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  stopCosmeticTicker();

  // If sendMessage returned nothing (channel closed, timeout), try storage fallback.
  if (!result || (typeof result === "object" && Object.keys(result).length === 0)) {
    try {
      const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
      if (opforLastResult?.ok && !opforLastResult.partial) {
        result = opforLastResult;
      }
    } catch {}
  }

  if (!result?.ok) {
    // Even on failure, check if the service worker saved a (partial) judged result to storage.
    if (!result?.paused) {
      try {
        const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
        if (opforLastResult?.judgment) {
          // We have a judged result (possibly partial) — use it instead of showing error
          result = opforLastResult;
        }
      } catch {}
    }
    if (!result?.ok) {
      // One more attempt: check if a partial result with judgment was saved
      if (result?.paused) {
        try {
          const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
          if (opforLastResult?.judgment && opforLastResult?.transcript?.length >= 2) {
            result = opforLastResult;
          }
        } catch {}
        if (!result?.ok) return { paused: true, error: result.error };
      }
      if (!result?.ok) return { error: result?.error || "Unknown error" };
    }
  }

  setPhase("judging");
  await new Promise((r) => setTimeout(r, 250));

  const verdict =
    String(result.judgment?.verdict || "FAIL").toUpperCase() === "PASS" ? "PASS" : "FAIL";
  return {
    record: {
      id: ev.id,
      name: ev.name,
      sev: ev.sev,
      verdict,
      summary: result.judgment?.summary || "",
      raw: result,
    },
  };
}

async function startRun({ resume = false } = {}) {
  if (state.running) return;
  state.running = true;
  state.cancelRequested = false;
  state.pauseRequested = false;
  await saveModelAndKey();

  // Build queue from current selection (or use existing queue if resuming)
  if (!resume) {
    const suite = state.catalog?.suites.find((s) => s.id === state.suiteId);
    if (!suite) {
      state.running = false;
      return;
    }
    const byId = new Map(state.catalog.evaluators.map((e) => [e.id, e]));
    state.queue = suite.evaluatorIds
      .filter((id) => state.selectedEvaluators.has(id))
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((ev) => ({ id: ev.id, name: ev.name, sev: normalizeSev(ev.severity) }));
    state.evIdx = 0;
    state.results = [];
  }

  setScreen("running");
  renderRunningHeader();
  renderRunStrip();
  startRunStatusPoller();

  // Persist the multi-evaluator queue so the popup can recover on reopen.
  await persistPopupRunQueue();

  while (state.evIdx < state.queue.length) {
    if (state.cancelRequested) break;
    const ev = state.queue[state.evIdx];
    renderRunningHeader();
    renderRunStrip();

    const isFirst = state.evIdx === state.results.length;
    const out = await runOneEvaluator(ev, { resume: resume && isFirst });
    resume = false; // only resume the first evaluator on a resume

    if (state.pauseRequested || out.paused) {
      state.running = false;
      stopCosmeticTicker();
      await clearPopupRunQueue();
      $("pausedSuite").textContent = state.suiteId;
      $("pausedEvaluator").textContent = ev.name;
      $("pausedModel").textContent = state.model;
      $("pausedSub").textContent = `evaluator ${state.evIdx + 1} of ${state.queue.length} · saved`;
      $("pausedElapsed").textContent = "—";
      setScreen("paused");
      return;
    }
    if (state.cancelRequested) break;
    if (out.error) {
      // Try to recover a judged partial result from storage instead of just showing the error
      let recovered = null;
      try {
        const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
        if (
          opforLastResult?.judgment &&
          opforLastResult?.evaluatorId === ev.id &&
          opforLastResult?.transcript?.length >= 2
        ) {
          const v =
            String(opforLastResult.judgment.verdict || "FAIL").toUpperCase() === "PASS"
              ? "PASS"
              : "FAIL";
          recovered = {
            id: ev.id,
            name: ev.name,
            sev: ev.sev,
            verdict: v,
            summary: opforLastResult.judgment.summary || "",
            raw: opforLastResult,
          };
        }
      } catch {}
      if (recovered) {
        state.results.push(recovered);
      } else {
        state.results.push({
          id: ev.id,
          name: ev.name,
          sev: ev.sev,
          verdict: "FAIL",
          summary: `Error: ${out.error}`,
          raw: null,
        });
      }
    } else if (out.record) {
      state.results.push(out.record);
    }
    state.evIdx++;
    renderRunStrip();
    await persistPopupRunQueue();

    // Between evaluators: reset the chat session so the next evaluator
    // starts with a fresh conversation (click "end chat" / "new chat").
    if (state.evIdx < state.queue.length && !state.cancelRequested && !state.pauseRequested) {
      setPhase("locating");
      $("runEvalName").textContent = "Resetting chat session";
      $("runPhaseText").textContent = "Starting fresh conversation for next evaluator";
      try {
        await chrome.runtime.sendMessage({ type: "OPFOR_RESET_CHAT" });
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  state.running = false;
  stopCosmeticTicker();
  stopRunStatusPoller();
  await clearPopupRunQueue();

  if (state.cancelRequested) {
    state.queue = [];
    state.results = [];
    state.evIdx = 0;
    setScreen("idle");
    return;
  }

  renderDone();
  setScreen("done");
}

async function requestPause() {
  if (!state.running) return;
  state.pauseRequested = true;
  stopRunStatusPoller();
  await clearPopupRunQueue();
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_STOP" });
  } catch {}
}

async function requestStop() {
  state.cancelRequested = true;
  state.pauseRequested = false;
  stopRunStatusPoller();
  await clearPopupRunQueue();
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_STOP" });
  } catch {}

  // If the service worker saved a partial result, surface it on the Done screen.
  try {
    const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
    if (opforLastResult?.partial) {
      const cur = state.queue[state.evIdx];
      state.results.push({
        id: cur?.id || "partial",
        name: cur?.name || "Partial result",
        sev: cur?.sev || "low",
        verdict: "FAIL",
        summary: "Stopped by user (partial result saved).",
        raw: opforLastResult,
      });
      state.evIdx = Math.min(state.evIdx + 1, state.queue.length);
      renderDone();
      setScreen("done");
      stopCosmeticTicker();
      state.running = false;
      return;
    }
  } catch {}

  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_DISCARD_PAUSED" });
  } catch {}
  stopCosmeticTicker();
  state.running = false;
  state.queue = [];
  state.results = [];
  state.evIdx = 0;
  setScreen("idle");
}

async function discardPaused() {
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_DISCARD_PAUSED" });
  } catch {}
  state.queue = [];
  state.results = [];
  state.evIdx = 0;
  setScreen("idle");
}

// ── Wiring ─────────────────────────────────────────────────────
function wire() {
  // Dropdowns
  suiteDD = buildDropdown("suiteDropdown", [{ value: "", label: "Loading…" }], "", (v) =>
    setSuite(v)
  );
  modelDD = buildDropdown(
    "modelDropdown",
    MODELS.map((m) => ({ value: m, label: m, meta: "" })),
    state.model,
    (v) => {
      state.model = v;
      saveModelAndKey();
    }
  );

  // Evals collapse
  $("evalsHead").addEventListener("click", () => {
    const evs = $("evals");
    evs.dataset.open = evs.dataset.open === "true" ? "false" : "true";
  });
  $("evalsSelectAll").addEventListener("click", (e) => {
    e.stopPropagation();
    const suite = state.catalog?.suites.find((s) => s.id === state.suiteId);
    if (!suite) return;
    const allOn = suite.evaluatorIds.every((id) => state.selectedEvaluators.has(id));
    if (allOn) state.selectedEvaluators.clear();
    else state.selectedEvaluators = new Set(suite.evaluatorIds);
    renderEvaluatorList();
    updateRunButton();
  });

  // Scrape toggle
  bindToggle(
    "scrapeToggle",
    () => state.scrapeFromSite,
    (v) => {
      state.scrapeFromSite = v;
      saveSettings();
      refreshScrapeMeta();
    }
  );
  $("agentDescription").addEventListener("input", (e) => {
    state.agentDescription = e.target.value;
    autoSizeTextarea(e.target);
    saveSettings();
  });

  // Base URL
  $("baseUrl").addEventListener("input", (e) => {
    state.baseUrl = e.target.value;
    saveModelAndKey();
  });

  // API key
  $("apiKey").addEventListener("input", (e) => {
    state.apiKey = e.target.value;
    saveModelAndKey();
  });
  $("apiKeyEye").addEventListener("click", () => {
    const input = $("apiKey");
    const eye = $("eyeIcon");
    if (input.type === "password") {
      input.type = "text";
      eye.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/></g>`;
    } else {
      input.type = "password";
      eye.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
        <circle cx="12" cy="12" r="3"/></g>`;
    }
  });

  // Buttons
  $("runBtn").addEventListener("click", () => startRun({ resume: false }));
  $("pauseBtn").addEventListener("click", requestPause);
  $("stopBtn").addEventListener("click", requestStop);
  $("resumeBtn").addEventListener("click", () => startRun({ resume: true }));
  $("discardPausedBtn").addEventListener("click", discardPaused);
  $("newRunBtn").addEventListener("click", () => {
    state.queue = [];
    state.results = [];
    state.evIdx = 0;
    setScreen("idle");
  });
  $("downloadBtn").addEventListener("click", downloadReport);

  // Advanced panel
  $("advancedBtn").addEventListener("click", openAdvanced);
  $("advCloseBtn").addEventListener("click", closeAdvanced);
  $("advDoneBtn").addEventListener("click", closeAdvanced);

  // Steppers
  bindStepper("maxTurns", "maxTurnsValue", "maxTurns", 1, 20);
  bindStepper("waitSec", "waitSecValue", "waitSec", 3, 30);

  // Advanced text fields
  $("businessUseCase").addEventListener("input", (e) => {
    state.businessUseCase = e.target.value;
    saveSettings();
  });
  $("judgeHint").addEventListener("input", (e) => {
    state.judgeHint = e.target.value;
    saveSettings();
  });

  // Advanced toggles
  bindToggle(
    "saveTranscriptToggle",
    () => state.saveTranscript,
    (v) => {
      state.saveTranscript = v;
      saveSettings();
    }
  );
  bindToggle(
    "verboseToggle",
    () => state.verbose,
    (v) => {
      state.verbose = v;
      saveSettings();
    }
  );

  // NOTE: We intentionally do NOT stop the background run on popup close.
  // The service worker can continue running; the popup can be reopened to Stop or view status.

  // Live progress events from the service worker (phase changes + transcript
  // turns). Shows "Detecting chat widget" during locate and renders the
  // attacker/agent bubbles for the current exchange while running.
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === "OPFOR_UI_PROGRESS") handleProgress(m);
  });
}

// ── Popup multi-evaluator queue persistence ─────────────────────
// The popup drives the multi-evaluator loop but the service worker
// clears opforRunStatus between evaluators. We persist the popup's
// own queue state so reopening the popup mid-run shows progress.
async function persistPopupRunQueue() {
  try {
    await chrome.storage.local.set({
      opforPopupRun: {
        running: true,
        suiteId: state.suiteId,
        queue: state.queue,
        evIdx: state.evIdx,
        results: state.results,
        maxTurns: state.maxTurns,
        updatedAt: Date.now(),
      },
    });
  } catch {}
}

async function clearPopupRunQueue() {
  try {
    await chrome.storage.local.remove("opforPopupRun");
  } catch {}
}

// ── Live-run recovery from storage ──────────────────────────────
// When the popup opens while a run is in progress, restore the running
// screen and replay the persisted transcript so the user sees what's
// happening without losing context.
async function checkActiveRun() {
  // First check if the service worker reports an active evaluator.
  const { opforRunStatus } = await chrome.storage.local.get("opforRunStatus");

  // Also check the popup's own multi-evaluator queue (survives between evaluators
  // when the service worker has already cleared opforRunStatus).
  const { opforPopupRun } = await chrome.storage.local.get("opforPopupRun");
  const popupQueueActive =
    opforPopupRun?.running && Date.now() - (opforPopupRun.updatedAt || 0) < 5 * 60 * 1000;

  if (!opforRunStatus?.running && !popupQueueActive) return false;

  if (popupQueueActive) {
    state.suiteId = opforPopupRun.suiteId || state.suiteId;
    state.maxTurns = opforPopupRun.maxTurns || state.maxTurns;
    state.queue = Array.isArray(opforPopupRun.queue) ? opforPopupRun.queue : [];
    state.evIdx = opforPopupRun.evIdx || 0;
    state.results = Array.isArray(opforPopupRun.results) ? opforPopupRun.results : [];
  }

  if (opforRunStatus?.running) {
    const evId = opforRunStatus.evaluatorId || "";
    const evName = opforRunStatus.evaluatorName || evId || "evaluator";
    const sev = normalizeSev(opforRunStatus.severity);

    if (!popupQueueActive) {
      state.suiteId = opforRunStatus.suiteId || state.suiteId;
      state.maxTurns = opforRunStatus.maxRounds || state.maxTurns;
      state.queue = [{ id: evId, name: evName, sev }];
      state.evIdx = 0;
      state.results = [];
    }
  }

  state.running = true;
  state.cancelRequested = false;
  state.pauseRequested = false;

  setScreen("running");
  renderRunningHeader();
  renderRunStrip();

  // Restore current phase.
  const phase = opforRunStatus?.phase || "running";
  setPhase(phase);

  // Replay persisted transcript into bubbles.
  const transcript = Array.isArray(opforRunStatus?.transcript) ? opforRunStatus.transcript : [];
  if (transcript.length) {
    let lastUser = "";
    let lastAssistant = "";
    let lastRound = 0;
    for (let i = 0; i < transcript.length; i++) {
      const t = transcript[i];
      if (t.role === "user") {
        lastUser = t.content;
        lastRound = Math.floor(i / 2) + 1;
        lastAssistant = "";
      } else if (t.role === "assistant") {
        lastAssistant = t.content;
      }
    }
    latestTurn = { round: lastRound, user: lastUser, assistant: lastAssistant };
    renderBubbles();
    setTurnProgress(lastRound);
  }

  startRunStatusPoller();
  return true;
}

let runStatusPollInterval = null;
function startRunStatusPoller() {
  stopRunStatusPoller();
  runStatusPollInterval = setInterval(async () => {
    if (state.screen !== "running") {
      stopRunStatusPoller();
      return;
    }
    try {
      const { opforRunStatus } = await chrome.storage.local.get("opforRunStatus");
      if (!opforRunStatus) return;

      // The service worker clears running=false after each evaluator finishes.
      // If the popup's own startRun loop is still active (state.running === true),
      // it means more evaluators are queued — don't jump to idle/done.
      if (!opforRunStatus.running) {
        if (state.running) return;
        stopRunStatusPoller();
        stopCosmeticTicker();
        const hasPaused = await checkPausedRun();
        if (!hasPaused) {
          const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
          if (opforLastResult && !opforLastResult.partial) {
            const verdict =
              String(opforLastResult.judgment?.verdict || "FAIL").toUpperCase() === "PASS"
                ? "PASS"
                : "FAIL";
            state.results = [
              {
                id: opforLastResult.evaluatorId || state.queue[0]?.id || "",
                name: opforLastResult.evaluatorName || state.queue[0]?.name || "",
                sev: state.queue[0]?.sev || "low",
                verdict,
                summary: opforLastResult.judgment?.summary || "",
                raw: opforLastResult,
              },
            ];
            state.evIdx = 1;
            renderDone();
            setScreen("done");
          } else {
            setScreen("idle");
          }
        }
        return;
      }

      // Update phase.
      if (opforRunStatus.phase) setPhase(opforRunStatus.phase);

      // Update transcript bubbles from storage.
      const transcript = Array.isArray(opforRunStatus.transcript) ? opforRunStatus.transcript : [];
      if (transcript.length) {
        let lastUser = "";
        let lastAssistant = "";
        let lastRound = 0;
        for (let i = 0; i < transcript.length; i++) {
          const t = transcript[i];
          if (t.role === "user") {
            lastUser = t.content;
            lastRound = Math.floor(i / 2) + 1;
            lastAssistant = "";
          } else if (t.role === "assistant") {
            lastAssistant = t.content;
          }
        }
        if (
          lastRound !== latestTurn.round ||
          lastUser !== latestTurn.user ||
          lastAssistant !== latestTurn.assistant
        ) {
          latestTurn = { round: lastRound, user: lastUser, assistant: lastAssistant };
          renderBubbles();
          setTurnProgress(lastRound);
        }
      }
    } catch {}
  }, 1500);
}

function stopRunStatusPoller() {
  if (runStatusPollInterval) clearInterval(runStatusPollInterval);
  runStatusPollInterval = null;
}

// ── Init ───────────────────────────────────────────────────────
async function init() {
  wire();
  await loadSettings();

  // Apply loaded settings to UI fields
  $("baseUrl").value = state.baseUrl;
  $("apiKey").value = state.apiKey;
  modelDD.setValue(state.model);
  $("agentDescription").value = state.agentDescription;
  $("businessUseCase").value = state.businessUseCase;
  $("judgeHint").value = state.judgeHint;
  $("scrapeToggle").setAttribute("aria-checked", String(state.scrapeFromSite));
  $("saveTranscriptToggle").setAttribute("aria-checked", String(state.saveTranscript));
  $("verboseToggle").setAttribute("aria-checked", String(state.verbose));
  $("maxTurns").value = String(state.maxTurns);
  $("maxTurnsValue").textContent = String(state.maxTurns);
  $("waitSec").value = String(state.waitSec);
  $("waitSecValue").textContent = String(state.waitSec);

  refreshScrapeMeta();

  try {
    await loadCatalog();
  } catch (e) {
    $("suiteDescription").textContent = e instanceof Error ? e.message : String(e);
  }

  // Priority: active run > paused run > idle.
  const isActive = await checkActiveRun();
  if (!isActive) {
    setScreen("idle");
    await checkPausedRun();
  }
}

init();
