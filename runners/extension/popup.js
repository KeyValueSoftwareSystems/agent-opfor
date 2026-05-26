// ─────────────────────────────────────────────────────────────────
// Opfor red-team popup — vanilla JS implementation of the design.
// Drives idle / running / paused / done screens and the slide-in
// advanced panel. Talks to service_worker.js via the existing
// OPFOR_UI_RUN / RESUME / STOP / DISCARD_PAUSED message contracts.
// ─────────────────────────────────────────────────────────────────

import { PROVIDERS } from "./providers.js";

const PROVIDER_OPTIONS = [
  { value: PROVIDERS.OPENAI, label: "OpenAI" },
  { value: PROVIDERS.ANTHROPIC, label: "Anthropic" },
  { value: PROVIDERS.GOOGLE, label: "Google (Gemini)" },
  { value: PROVIDERS.GROQ, label: "Groq" },
  { value: PROVIDERS.DEEPSEEK, label: "DeepSeek" },
  { value: PROVIDERS.AZURE, label: "Azure OpenAI" },
  { value: PROVIDERS.OPENAI_COMPATIBLE, label: "Custom (OpenAI-compatible)" },
];

const MODELS_BY_PROVIDER = {
  [PROVIDERS.OPENAI]: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-5"],
  [PROVIDERS.ANTHROPIC]: [
    "claude-haiku-4-5",
    "claude-sonnet-4-5",
    "claude-opus-4-5",
    "claude-3-7-sonnet-latest",
  ],
  [PROVIDERS.GOOGLE]: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  [PROVIDERS.GROQ]: ["llama-3.3-70b-versatile", "llama-3.1-70b"],
  [PROVIDERS.DEEPSEEK]: ["deepseek-chat", "deepseek-reasoner"],
  [PROVIDERS.AZURE]: [],
  [PROVIDERS.OPENAI_COMPATIBLE]: [],
};

const PROVIDER_DEFAULT_MODELS = {
  [PROVIDERS.OPENAI]: "gpt-4o-mini",
  [PROVIDERS.ANTHROPIC]: "claude-sonnet-4-5",
  [PROVIDERS.GOOGLE]: "gemini-2.0-flash",
  [PROVIDERS.GROQ]: "llama-3.3-70b-versatile",
  [PROVIDERS.DEEPSEEK]: "deepseek-chat",
  [PROVIDERS.AZURE]: "",
  [PROVIDERS.OPENAI_COMPATIBLE]: "",
};

/** Providers that require a user-supplied baseUrl. */
const PROVIDERS_NEEDING_BASE_URL = new Set([PROVIDERS.AZURE, PROVIDERS.OPENAI_COMPATIBLE]);

/** Providers whose models are fetched dynamically from a known endpoint. */
const SIMPLE_PROVIDER_FETCH_CONFIG = {
  [PROVIDERS.OPENAI]: {
    url: () => "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) =>
      (json.data ?? [])
        .map((m) => m.id)
        .filter((id) => id?.startsWith("gpt-") || id?.startsWith("o"))
        .sort(),
  },
  [PROVIDERS.ANTHROPIC]: {
    url: () => "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    parse: (json) => (json.data ?? []).map((m) => m.id).filter(Boolean),
  },
  [PROVIDERS.GOOGLE]: {
    url: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: () => ({}),
    parse: (json) =>
      (json.models ?? [])
        .map((m) => m.name?.replace("models/", ""))
        .filter((id) => id?.startsWith("gemini")),
  },
  [PROVIDERS.GROQ]: {
    url: () => "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) =>
      (json.data ?? [])
        .map((m) => m.id)
        .filter(Boolean)
        .sort(),
  },
  [PROVIDERS.DEEPSEEK]: {
    url: () => "https://api.deepseek.com/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) => (json.data ?? []).map((m) => m.id).filter(Boolean),
  },
};

const $ = (id) => document.getElementById(id);

// ── State ───────────────────────────────────────────────────────
const state = {
  catalog: /** @type {null | { suites: any[]; evaluators: any[] }} */ (null),
  suiteId: "",
  selectedEvaluators: new Set(),
  provider: PROVIDERS.OPENAI,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  scrapeFromSite: true,
  agentDescription: "",
  maxTurns: 10,
  waitSec: 10,
  messageCharLimit: 500,
  attackObjective: "",
  businessUseCase: "",
  judgeHint: "",
  // Run state
  screen: /** @type {"idle"|"running"|"paused"|"done"|"history"} */ ("idle"),
  queue: /** @type {{id:string;name:string;sev:string}[]} */ ([]),
  evIdx: 0,
  results:
    /** @type {{id:string;name:string;sev:string;verdict:string;summary:string;raw:any}[]} */ ([]),
  lastReport: /** @type {any | null} */ (null),
  running: false,
  cancelRequested: false,
  pauseRequested: false,
  targetTabId: /** @type {number|null} */ (null),
  keepAlivePort: /** @type {chrome.runtime.Port|null} */ (null),
};

// ── Screen / status ────────────────────────────────────────────

const PILL_LABELS = {
  idle: "Ready",
  running: "Running",
  paused: "Paused",
  done: "Done",
  awaitUser: "Action needed",
  history: "History",
};

/** Map screen names to status-pill data-screen tokens (CSS variants). */
function pillScreenToken(name) {
  if (name === "awaitUser") return "paused";
  if (name === "history") return "idle";
  return name;
}

function syncNav() {
  const historyBtn = $("historyBtn");
  if (historyBtn) {
    historyBtn.disabled = state.screen === "running";
  }
}

function setScreen(name) {
  state.screen = name;
  for (const s of ["idle", "running", "paused", "done", "awaitUser"]) {
    const elId =
      s === "awaitUser" ? "screenAwaitUser" : "screen" + s.charAt(0).toUpperCase() + s.slice(1);
    const el = $(elId);
    if (el) el.hidden = s !== name;
  }
  const pill = $("statusPill");
  if (pill) {
    pill.dataset.screen = pillScreenToken(name);
    const pillText = $("statusPillText");
    if (pillText) pillText.textContent = PILL_LABELS[name] || "Ready";
  }
  $("footer").dataset.screen = name;
  // Gear icon only useful on idle
  $("advancedBtn").style.display = name === "idle" ? "" : "none";
  const runBar = $("runBtnWrap");
  if (runBar) runBar.hidden = name !== "idle";
  const bodyEl = document.querySelector(".body");
  if (bodyEl) bodyEl.style.overflowY = name === "running" ? "hidden" : "";
  syncNav();
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
function buildDropdown(
  rootId,
  options,
  value,
  onChange,
  { onOpen, searchable = false, inlineSearch = false } = {}
) {
  const root = $(rootId);
  const button = root.querySelector(".dd-button");
  const labelEl = button.querySelector(".label");
  const chevEl = button.querySelector(".chev");
  const spinnerEl = button.querySelector(".dd-loading-spinner");
  const menu = root.querySelector(".dd-menu");

  let searchInput = null;
  let filterText = "";
  const SEARCH_THRESHOLD = 10;

  function shouldShowSearch() {
    return !inlineSearch && (searchable || options.length > SEARCH_THRESHOLD);
  }

  function setLabel(text) {
    if (inlineSearch) labelEl.value = text;
    else labelEl.textContent = text;
  }

  function renderOptions(filtered) {
    const listContainer = menu.querySelector(".dd-options-list") || menu;
    listContainer.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dd-no-results";
      empty.textContent = "No matches";
      listContainer.appendChild(empty);
      return;
    }
    for (const o of filtered) {
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
        filterText = "";
        root.dataset.open = "false";
        render();
        onChange(o.value);
      });
      listContainer.appendChild(opt);
    }
  }

  function getFiltered() {
    if (!filterText) return options;
    const q = filterText.toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }

  function render() {
    const cur = options.find((o) => o.value === value);
    setLabel(cur ? cur.label : "");
    menu.innerHTML = "";
    filterText = "";

    if (shouldShowSearch()) {
      const searchWrap = document.createElement("div");
      searchWrap.className = "dd-search-wrap";
      searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "dd-search";
      searchInput.placeholder = "Search models…";
      searchInput.addEventListener("input", (e) => {
        filterText = e.target.value;
        renderOptions(getFiltered());
      });
      searchInput.addEventListener("mousedown", (e) => e.stopPropagation());
      searchWrap.appendChild(searchInput);
      menu.appendChild(searchWrap);
    }

    const listContainer = document.createElement("div");
    listContainer.className = "dd-options-list";
    menu.appendChild(listContainer);

    renderOptions(options);
  }

  if (inlineSearch) {
    labelEl.addEventListener("input", () => {
      filterText = labelEl.value;
      if (root.dataset.open !== "true") root.dataset.open = "true";
      renderOptions(getFiltered());
    });
    button.addEventListener("click", () => {
      if (labelEl.disabled) return;
      if (root.dataset.open !== "true") {
        root.dataset.open = "true";
        scrollBodyToBottom();
        if (onOpen) onOpen();
        setTimeout(() => labelEl.select(), 0);
      }
    });
  } else {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (button.disabled) return;
      const opening = root.dataset.open !== "true";
      root.dataset.open = opening ? "true" : "false";
      if (opening) scrollBodyToBottom();
      if (opening) {
        if (onOpen) onOpen();
        setTimeout(() => {
          if (searchInput && shouldShowSearch()) searchInput.focus();
        }, 0);
      }
    });
  }

  document.addEventListener("mousedown", (e) => {
    if (!root.contains(e.target)) {
      if (inlineSearch && root.dataset.open === "true") {
        const cur = options.find((o) => o.value === value);
        setLabel(cur ? cur.label : "");
        filterText = "";
        renderOptions(options);
      }
      root.dataset.open = "false";
    }
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
    setLoading(isLoading) {
      if (inlineSearch) labelEl.disabled = isLoading;
      else button.disabled = isLoading;
      if (spinnerEl) spinnerEl.style.display = isLoading ? "" : "none";
      if (chevEl) chevEl.style.display = isLoading ? "none" : "";
      if (isLoading) {
        setLabel("Loading models…");
        root.dataset.open = "false";
      } else {
        render();
      }
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
      saveSettings();
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
  const missingKey = !state.apiKey.trim();
  const missingEvals = state.selectedEvaluators.size === 0;
  const missingSuite = !state.suiteId || !state.catalog;
  const missingDesc = !state.scrapeFromSite && !state.agentDescription.trim();
  $("runBtn").disabled = missingKey || missingEvals || missingSuite || missingDesc;
}

// ── Suite description + dropdown wiring ────────────────────────
let suiteDD, modelDD, providerDD;

/**
 * @param {string} id
 * @param {{ selectedIds?: string[] | null }} [opts]
 */
function setSuite(id, { selectedIds = undefined } = {}) {
  state.suiteId = id;
  const suite = state.catalog?.suites.find((s) => s.id === id);
  $("suiteDescription").textContent = suite?.description || "";
  const validIds = new Set(suite?.evaluatorIds || []);
  if (selectedIds !== undefined && selectedIds !== null) {
    state.selectedEvaluators = new Set(selectedIds.filter((eid) => validIds.has(eid)));
  } else {
    state.selectedEvaluators = new Set(suite && id !== "all-evaluators" ? suite.evaluatorIds : []);
  }
  renderEvaluatorList();
  updateRunButton();
  saveSettings();
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
    messageCharLimit: clamp(Math.round((Number(s.messageCharLimit) || 500) / 50) * 50, 100, 1500),
    attackObjective: s.attackObjective ?? "",
    businessUseCase: s.businessUseCase ?? "",
    judgeHint: s.judgeHint ?? "",
    suiteId: typeof s.suiteId === "string" ? s.suiteId : "",
    _persistedEvaluatorIds: Array.isArray(s.selectedEvaluatorIds)
      ? s.selectedEvaluatorIds.filter((id) => typeof id === "string" && id)
      : null,
  });
  const profiles = stored.opforLlmProfiles;
  if (profiles?.attacker) {
    state.provider = profiles.attacker.provider || state.provider;
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
      messageCharLimit: state.messageCharLimit,
      attackObjective: state.attackObjective,
      businessUseCase: state.businessUseCase,
      judgeHint: state.judgeHint,
      suiteId: state.suiteId || "",
      selectedEvaluatorIds: [...state.selectedEvaluators],
    },
  });
}

async function saveModelAndKey() {
  // Single popup-driven config — same provider/model/apiKey for all three roles.
  const baseUrl = (state.baseUrl || "").trim() || "https://api.openai.com/v1";
  const next = { v: 1 };
  for (const k of ["attacker", "judge", "reader"]) {
    next[k] = {
      provider: state.provider,
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

  state.catalog.suites.push({
    id: "all-evaluators",
    name: "All Evaluators",
    description: "Every evaluator across every suite — pick any subset to run.",
    evaluatorIds: state.catalog.evaluators.map((e) => e.id),
  });

  const opts = state.catalog.suites.map((s) => ({
    value: s.id,
    label: s.name,
    meta:
      s.id === "all-evaluators"
        ? `${s.evaluatorIds.length} evals · all suites`
        : `${s.evaluatorIds.length} evals`,
  }));
  suiteDD.setOptions(opts);

  const suiteExists = (sid) => state.catalog.suites.some((s) => s.id === sid);
  const defaultSuite =
    state.catalog.suites.find((s) => s.id === "owasp-llm-top10")?.id ||
    state.catalog.suites[0]?.id ||
    "";
  const persistedSuite = state.suiteId && suiteExists(state.suiteId) ? state.suiteId : "";
  const suiteToUse = persistedSuite || defaultSuite;
  const persistedEvals = state._persistedEvaluatorIds;
  delete state._persistedEvaluatorIds;

  suiteDD.setValue(suiteToUse);

  if (persistedSuite === suiteToUse && persistedEvals != null) {
    setSuite(suiteToUse, { selectedIds: persistedEvals });
  } else {
    setSuite(suiteToUse);
    if (suiteToUse === "owasp-llm-top10" && !persistedSuite) {
      state.selectedEvaluators = new Set(["prompt-injection"]);
      renderEvaluatorList();
      updateRunButton();
      saveSettings();
    }
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

/** Scroll the adversarial-turn transcript pane to show the latest content. */
function scrollBubblesToLatest(box) {
  if (!box || box.hidden) return;
  const scroll = () => {
    box.scrollTop = box.scrollHeight;
  };
  requestAnimationFrame(() => requestAnimationFrame(scroll));
}

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
  scrollBubblesToLatest(box);
}

function resetBubbles() {
  latestTurn = { round: 0, user: "", assistant: "" };
  $("runBubbles").innerHTML = "";
  $("runBubbles").hidden = true;
}

let progressActive = false;

function handleProgress(message) {
  if (state.screen !== "running" && state.screen !== "awaitUser") return;
  progressActive = true;
  // Only stop the cosmetic ticker when real turn data arrives — not on phase
  // events, which fire early (before attack generation completes).
  if (message.kind === "turn") stopCosmeticTicker();
  if (message.kind === "phase") {
    if (message.phase === "await_user") {
      state.awaitUserError = message.error || "Could not find chat widget";
      $("awaitUserError").textContent = state.awaitUserError;
      const cur = state.queue[state.evIdx];
      $("awaitUserEvaluator").textContent = cur?.name || "—";
      setScreen("awaitUser");
      return;
    }
    if (state.screen === "awaitUser") {
      setScreen("running");
    }
    setPhase(message.phase);
    if (message.phase === "running") setTurnProgress(0);
    if (message.phase === "locating") {
      resetBubbles();
      setTurnProgress(0);
      if (message.locateMessage) {
        const locateText = $("runLocateText");
        if (locateText) locateText.textContent = message.locateMessage;
      }
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

// ── Report generation (per skills/opfor-execute/report-schema.md) ──
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
  if (score >= 70) return "#059669";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

function sevDot(sev) {
  return { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" }[sev] || "⚪";
}

function generateHtmlReport(report) {
  const { metadata, target, summary, evaluatorResults, criticalFindings, highFindings } = report;
  const passPct = summary.totalTests ? Math.round((summary.passed / summary.totalTests) * 360) : 0;
  const overallVerdict = summary.failed === 0 && summary.totalTests > 0 ? "PASS" : "FAIL";
  const riskLevel =
    summary.safetyScore >= 80
      ? { label: "Low Risk", color: "#059669", bg: "#D1FAE5", border: "#6EE7B7" }
      : summary.safetyScore >= 60
        ? { label: "Medium Risk", color: "#D97706", bg: "#FEF3C7", border: "#FCD34D" }
        : summary.safetyScore >= 40
          ? { label: "High Risk", color: "#DC2626", bg: "#FEE2E2", border: "#FCA5A5" }
          : { label: "Critical Risk", color: "#991B1B", bg: "#FEE2E2", border: "#EF4444" };
  const genDate = new Date(metadata.generated);
  const dateStr = genDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = genDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  // ── Turns helper ───────────────────────────────────────────────
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

  // ── Evaluator details ──────────────────────────────────────────
  const appendix = evaluatorResults
    .map((e, idx) => {
      const turns = turnsForReport(e.raw);
      const tr = e.testResults[0] || {};
      const sevColor = SEV_HEX[e.severity] || "#64748B";
      const verdictPass = tr.verdict === "PASS";
      const transcript = turns.length
        ? `<div class="transcript">
              <div class="transcript-header">Conversation Transcript <span class="tc-count">${turns.length} turn${turns.length === 1 ? "" : "s"}</span></div>
              ${turns
                .map(
                  (t, i) => `
                <div class="turn">
                  <div class="turn-row">
                    <div class="turn-role attacker-role">Attacker · Turn ${i + 1}</div>
                    <pre>${escapeHtml(truncate(t.user, 4000))}</pre>
                  </div>
                  <div class="turn-row">
                    <div class="turn-role agent-role">Agent · Turn ${i + 1}</div>
                    <pre>${escapeHtml(truncate(t.assistant, 4000))}</pre>
                  </div>
                </div>`
                )
                .join("")}
            </div>`
        : "";
      return `
        <details class="eval-detail" id="eval-${idx}">
          <summary>
            <div class="eval-summary-left">
              <span class="eval-num">${String(idx + 1).padStart(2, "0")}</span>
              <div class="eval-summary-info">
                <span class="eval-summary-name">${escapeHtml(e.name)}</span>
                <span class="sev-tag" style="background:${sevColor}18;color:${sevColor};border-color:${sevColor}44">${escapeHtml(e.severity)}</span>
              </div>
            </div>
            <div class="eval-summary-right">
              <span class="score-badge">${tr.score ?? "—"}<span class="score-denom">/10</span></span>
              <span class="verdict-tag ${verdictPass ? "verdict-pass" : "verdict-fail"}">${tr.verdict || "—"}</span>
              <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </summary>
          <div class="eval-body">
            <div class="eval-meta-grid">
              <div class="meta-item"><div class="meta-k">Verdict</div><div class="meta-v ${verdictPass ? "pass-text" : "fail-text"}">${tr.verdict || "—"}</div></div>
              <div class="meta-item"><div class="meta-k">Risk Score</div><div class="meta-v">${tr.score ?? "—"} / 10</div></div>
              <div class="meta-item"><div class="meta-k">Confidence</div><div class="meta-v">${tr.confidence != null ? tr.confidence + "%" : "—"}</div></div>
              <div class="meta-item"><div class="meta-k">Severity</div><div class="meta-v"><span class="sev-tag" style="background:${sevColor}18;color:${sevColor};border-color:${sevColor}44">${escapeHtml(e.severity)}</span></div></div>
            </div>
            ${
              tr.evidence && tr.evidence !== "N/A"
                ? `<div class="detail-section"><div class="detail-section-label">Evidence</div><div class="detail-section-body">${escapeHtml(tr.evidence)}</div></div>`
                : ""
            }
            ${
              tr.reasoning
                ? `<div class="detail-section"><div class="detail-section-label">Reasoning</div><div class="detail-section-body">${escapeHtml(tr.reasoning)}</div></div>`
                : ""
            }
            ${transcript}
          </div>
        </details>`;
    })
    .join("");

  // ── Findings list ──────────────────────────────────────────────
  const findingBlock = (label, list, color) =>
    list.length === 0
      ? ""
      : `<div class="finding-block" style="--fc:${color}">
          <div class="finding-block-head">
            <span class="finding-label" style="color:${color}">${escapeHtml(label)}</span>
            <span class="finding-count" style="background:${color}18;color:${color};border-color:${color}44">${list.length}</span>
          </div>
          <ol class="finding-list">
            ${list
              .map(
                (f) => `<li>
                <strong>${escapeHtml(f.evaluator)}</strong>
                <span class="finding-score">Score ${f.score}/10</span>
                <div class="finding-desc">${escapeHtml(truncate(f.description, 240))}</div>
              </li>`
              )
              .join("")}
          </ol>
        </div>`;

  // ── Results table rows ─────────────────────────────────────────
  const tableRows = evaluatorResults
    .map((e, idx) => {
      const sevColor = SEV_HEX[e.severity] || "#64748B";
      const pass = e.passed > 0 && e.failed === 0;
      return `
        <tr>
          <td class="td-num">${String(idx + 1).padStart(2, "0")}</td>
          <td><a href="#eval-${idx}" class="eval-link">${escapeHtml(e.name)}</a></td>
          <td><span class="sev-tag" style="background:${sevColor}18;color:${sevColor};border-color:${sevColor}44">${escapeHtml(e.severity)}</span></td>
          <td><span class="verdict-tag ${pass ? "verdict-pass" : "verdict-fail"}">${pass ? "PASS" : "FAIL"}</span></td>
          <td class="td-score">${e.avgScore.toFixed(1)}<span style="color:#94A3B8">/10</span></td>
        </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Opfor Security Report — ${escapeHtml(target.name)}</title>
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

  /* ── Page shell ── */
  .page{max-width:960px;margin:0 auto;padding:0 24px}

  /* ── Cover band ── */
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

  /* ── Section header ── */
  .section{margin-bottom:32px}
  .section-header{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--line)}
  .section-num{width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .section-title{font-size:15px;font-weight:600;color:var(--text);letter-spacing:-0.01em}
  .section-subtitle{font-size:12px;color:var(--muted);margin-left:auto}

  /* ── Executive summary ── */
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

  /* ── Findings ── */
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

  /* ── Results table ── */
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


  /* ── Badges ── */
  .sev-tag{display:inline-block;padding:2px 8px;border:1px solid;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.03em;white-space:nowrap}
  .verdict-tag{display:inline-block;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.04em}
  .verdict-pass{background:var(--pass-bg);color:var(--pass);border:1px solid var(--pass-border)}
  .verdict-fail{background:var(--fail-bg);color:var(--fail);border:1px solid var(--fail-border)}
  .pass-text{color:var(--pass);font-weight:600}
  .fail-text{color:var(--fail);font-weight:600}

  /* ── Evaluator detail blocks ── */
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
  .score-badge{font-size:13px;font-weight:700;color:var(--text-2)}
  .score-denom{font-size:11px;font-weight:400;color:var(--muted)}
  .chevron{color:var(--muted-2);transition:transform 0.2s;flex-shrink:0}
  .eval-detail[open] .chevron{transform:rotate(180deg)}
  .eval-body{padding:16px}
  .eval-meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
  .meta-item{background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
  .meta-k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
  .meta-v{font-size:13px;font-weight:600;color:var(--text)}
  .detail-section{margin-bottom:12px}
  .detail-section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:6px}
  .detail-section-body{font-size:13px;color:var(--text-2);line-height:1.6;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
  .transcript{margin-top:12px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .transcript-header{padding:8px 12px;background:var(--surface-2);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
  .tc-count{font-weight:400;color:var(--muted-2)}
  .turn{border-bottom:1px solid var(--line)}
  .turn:last-child{border-bottom:none}
  .turn-row{padding:10px 12px;border-bottom:1px solid var(--line)}
  .turn-row:last-child{border-bottom:none}
  .turn-role{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px}
  .attacker-role{color:#DC2626}
  .agent-role{color:#2563EB}
  .turn-row pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text-2)}

  /* ── Footer ── */
  .report-footer{max-width:960px;margin:40px auto 0;padding:16px 24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:12px;color:var(--muted)}
  .footer-right{font-size:12px;color:var(--muted-2);font-family:ui-monospace,monospace}

  /* ── Print ── */
  @media print{
    body{background:#fff;padding:0}
    .cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .eval-detail{border:1px solid var(--line)}
    .eval-detail[open]>summary{background:var(--surface-2);-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .stat-card,.scope-card,.finding-block,.results-table-wrap,.eval-detail{break-inside:avoid;box-shadow:none}
  }
  @media(max-width:640px){
    .cover-meta{grid-template-columns:1fr 1fr}
    .exec-banner{flex-direction:column;align-items:flex-start}
    .summary-stats{grid-template-columns:1fr 1fr}
    .scope-grid,.findings-grid{grid-template-columns:1fr}
    .eval-meta-grid{grid-template-columns:repeat(2,1fr)}
  }
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
          <div class="cover-brand-sub">Red-team Platform</div>
        </div>
      </div>
      <div class="cover-classification">Confidential</div>
    </div>
    <div class="cover-title">LLM Security Assessment Report</div>
    <div class="cover-subtitle">Automated adversarial evaluation · ${escapeHtml(metadata.framework)} · ${dateStr}</div>
    <div class="cover-meta">
      <div class="cover-meta-item">
        <div class="cover-meta-k">Target System</div>
        <div class="cover-meta-v" title="${escapeHtml(target.name)}">${escapeHtml(target.name)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-k">Evaluation Suite</div>
        <div class="cover-meta-v">${escapeHtml(metadata.configId)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-k">Assessment Date</div>
        <div class="cover-meta-v">${dateStr}, ${timeStr}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-k">Evaluators Run</div>
        <div class="cover-meta-v">${summary.totalEvaluators}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-k">Attacker Model</div>
        <div class="cover-meta-v">${escapeHtml(target.model)}</div>
      </div>
      <div class="cover-meta-item">
        <div class="cover-meta-k">Report ID</div>
        <div class="cover-meta-v mono" style="font-family:ui-monospace,monospace;font-size:11px;color:#94A3B8">${escapeHtml(metadata.reportId)}</div>
      </div>
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
    <div class="exec-banner ${overallVerdict === "PASS" ? "pass" : "fail"}">
      <div class="exec-banner-left">
        <div class="exec-verdict-icon">
          ${
            overallVerdict === "PASS"
              ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`
              : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>`
          }
        </div>
        <div>
          <div class="exec-verdict-label">Overall Verdict</div>
          <div class="exec-verdict-text">${overallVerdict}</div>
        </div>
      </div>
      <div class="exec-risk">${riskLevel.label}</div>
    </div>
    <div class="summary-stats">
      <div class="stat-card">
        <div class="sc-label">Safety Score</div>
        <div class="sc-value" style="color:${safetyColor(summary.safetyScore)}">${summary.safetyScore}%</div>
        <div class="sc-bar"><div class="sc-bar-fill" style="width:${summary.safetyScore}%;background:${safetyColor(summary.safetyScore)}"></div></div>
        <div class="sc-sub">Based on ${summary.totalTests} evaluator${summary.totalTests === 1 ? "" : "s"}</div>
      </div>
      <div class="stat-card">
        <div class="sc-label">Attack Success Rate</div>
        <div class="sc-value" style="color:${summary.attackSuccessRate > 0 ? "#DC2626" : "#059669"}">${summary.attackSuccessRate}%</div>
        <div class="sc-bar"><div class="sc-bar-fill" style="width:${summary.attackSuccessRate}%;background:${summary.attackSuccessRate > 0 ? "#DC2626" : "#059669"}"></div></div>
        <div class="sc-sub">${summary.failed} of ${summary.totalTests} evaluators breached</div>
      </div>
      <div class="stat-card">
        <div class="sc-label">Evaluators Passed</div>
        <div class="sc-value" style="color:#059669">${summary.passed}</div>
        <div class="sc-sub">No vulnerability surfaced</div>
      </div>
      <div class="stat-card">
        <div class="sc-label">Evaluators Failed</div>
        <div class="sc-value" style="color:${summary.failed > 0 ? "#DC2626" : "#059669"}">${summary.failed}</div>
        <div class="sc-sub">${criticalFindings.length} critical · ${highFindings.length} high severity</div>
      </div>
    </div>
    <div class="summary-narrative">
      ${
        overallVerdict === "PASS"
          ? `The target system <strong>${escapeHtml(target.name)}</strong> <strong>passed all ${summary.totalTests} evaluator${summary.totalTests === 1 ? "" : "s"}</strong> in the <em>${escapeHtml(metadata.configId)}</em> suite. No exploitable vulnerabilities were surfaced under sustained adversarial pressure with the configured turn budget. The system demonstrates adequate resistance to the evaluated attack patterns at the time of assessment.`
          : `The target system <strong>${escapeHtml(target.name)}</strong> <strong>failed ${summary.failed} of ${summary.totalTests} evaluator${summary.totalTests === 1 ? "" : "s"}</strong> (${summary.attackSuccessRate}% attack success rate) in the <em>${escapeHtml(metadata.configId)}</em> suite. ${summary.failed === 1 ? "One vulnerability was" : "Multiple vulnerabilities were"} surfaced under adversarial pressure.${criticalFindings.length > 0 ? ` <strong style="color:#DC2626">${criticalFindings.length} critical finding${criticalFindings.length === 1 ? "" : "s"}</strong> require immediate remediation.` : ""} Refer to the Findings section for a prioritised remediation plan.`
      }
    </div>
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
        <div class="scope-row"><span class="scope-k">System</span><span class="scope-v">${escapeHtml(target.name)}</span></div>
        <div class="scope-row"><span class="scope-k">Type</span><span class="scope-v">LLM Chatbot Interface</span></div>
        <div class="scope-row"><span class="scope-k">Access method</span><span class="scope-v">${state.scrapeFromSite ? "Browser automation (live tab)" : "Manual description"}</span></div>
      </div>
      <div class="scope-card">
        <div class="scope-card-title">Evaluation Parameters</div>
        <div class="scope-row"><span class="scope-k">Suite</span><span class="scope-v">${escapeHtml(metadata.configId)}</span></div>
        <div class="scope-row"><span class="scope-k">Attacker model</span><span class="scope-v mono">${escapeHtml(target.model)}</span></div>
        <div class="scope-row"><span class="scope-k">Max turns / evaluator</span><span class="scope-v">${state.maxTurns}</span></div>
        <div class="scope-row"><span class="scope-k">Wait between turns</span><span class="scope-v">${state.waitSec}s</span></div>
        <div class="scope-row"><span class="scope-k">Message length limit</span><span class="scope-v">${state.messageCharLimit} chars</span></div>
      </div>
      ${
        state.businessUseCase
          ? `<div class="scope-card scope-full">
              <div class="scope-card-title">Business Context</div>
              <div style="font-size:13px;color:#334155;line-height:1.6">${escapeHtml(state.businessUseCase)}</div>
            </div>`
          : ""
      }
    </div>
  </div>

  <!-- 3. Findings -->
  ${
    criticalFindings.length + highFindings.length > 0
      ? `<div class="section">
          <div class="section-header">
            <div class="section-num">3</div>
            <div class="section-title">Key Findings</div>
            <div class="section-subtitle">${criticalFindings.length + highFindings.length} finding${criticalFindings.length + highFindings.length === 1 ? "" : "s"} requiring attention</div>
          </div>
          <div class="findings-grid">
            ${findingBlock("Critical", criticalFindings, "#DC2626")}
            ${findingBlock("High", highFindings, "#D97706")}
          </div>
        </div>`
      : `<div class="section">
          <div class="section-header">
            <div class="section-num">3</div>
            <div class="section-title">Key Findings</div>
          </div>
          <div class="no-findings">No critical or high severity findings — system passed all evaluated attack patterns.</div>
        </div>`
  }

  <!-- 4. Detailed Results -->
  <div class="section">
    <div class="section-header">
      <div class="section-num">4</div>
      <div class="section-title">Evaluation Results</div>
      <div class="section-subtitle">${summary.totalEvaluators} evaluator${summary.totalEvaluators === 1 ? "" : "s"}</div>
    </div>
    <div class="results-table-wrap" style="margin-bottom:16px">
      <table class="results">
        <thead><tr>
          <th>#</th><th>Evaluator</th><th>Severity</th><th>Verdict</th><th>Risk Score</th>
        </tr></thead>
        <tbody>${tableRows || `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No evaluators executed.</td></tr>`}</tbody>
      </table>
    </div>
    <div style="margin-top:18px"></div>
    <div style="margin-bottom:8px: color:#64748B"># Details</div>
    ${appendix}
  </div>

</div>

<div class="report-footer">
  <div class="footer-left">Generated by ${escapeHtml(metadata.framework)} · ${dateStr}</div>
  <div class="footer-right">${escapeHtml(metadata.reportId)}</div>
</div>

</body>
</html>`;
}

const REPORT_HISTORY_KEY = "opforReportHistory";
const LAST_SUITE_REPORT_KEY = "opforLastSuiteReport";
const MAX_HISTORY_ITEMS = 25;

function safeClone(obj) {
  // MV3 popup runs in modern Chromium; structuredClone is available in most environments.
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch {}
  }
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function trimStr(s, max) {
  const v = String(s ?? "");
  return v.length > max ? v.slice(0, max) : v;
}

function pruneRawForHistory(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const out = {
    ok: raw.ok,
    completed: raw.completed,
    partial: raw.partial,
    stopped: raw.stopped,
    stopReason: raw.stopReason,
    siteUrl: raw.siteUrl,
    suiteId: raw.suiteId,
    evaluatorId: raw.evaluatorId,
    evaluatorName: raw.evaluatorName,
    severity: raw.severity,
    maxRounds: raw.maxRounds,
    frame: raw.frame,
    judgment: raw.judgment,
  };

  const transcript = Array.isArray(raw.transcript) ? raw.transcript : [];
  if (transcript.length) {
    out.transcript = transcript.slice(-80).map((m) => ({
      role: m?.role,
      content: trimStr(m?.content, 20_000),
    }));
  }

  const turns = Array.isArray(raw.turns) ? raw.turns : [];
  if (turns.length) {
    out.turns = turns.slice(-60).map((t) => ({
      round: t?.round,
      userMessage: trimStr(t?.userMessage, 20_000),
      assistantPreview: trimStr(t?.assistantPreview, 20_000),
    }));
  }

  return out;
}

function pruneReportForHistory(report) {
  const r = safeClone(report);
  if (Array.isArray(r?.evaluatorResults)) {
    r.evaluatorResults = r.evaluatorResults.map((er) => ({
      ...er,
      raw: pruneRawForHistory(er?.raw),
    }));
  }
  return r;
}

async function getReportHistory() {
  try {
    const data = await chrome.storage.local.get(REPORT_HISTORY_KEY);
    const cur = data?.[REPORT_HISTORY_KEY];
    return Array.isArray(cur?.items) ? cur.items : [];
  } catch {
    return [];
  }
}

async function setReportHistory(items) {
  try {
    await chrome.storage.local.set({
      [REPORT_HISTORY_KEY]: { v: 1, updatedAt: Date.now(), items },
    });
  } catch {}
}

async function addReportToHistory(report) {
  if (!report?.metadata?.reportId) return;
  const verdict =
    report?.summary?.failed === 0 && report?.summary?.totalTests > 0 ? "PASS" : "FAIL";
  const item = {
    id: report.metadata.reportId,
    generated: report.metadata.generated,
    configId: report.metadata.configId,
    model: report.metadata.llmJudge,
    verdict,
    summary: report.summary,
    report,
  };
  const items = await getReportHistory();
  const next = [item, ...items.filter((x) => x?.id !== item.id)].slice(0, MAX_HISTORY_ITEMS);
  await setReportHistory(next);
}

async function persistLastSuiteReport(report) {
  try {
    await chrome.storage.local.set({
      [LAST_SUITE_REPORT_KEY]: { v: 1, savedAt: Date.now(), report },
    });
  } catch {}
}

async function finalizeAndPersistCurrentReport() {
  if (!state.results.length) return null;
  const built = buildReport();
  const pruned = pruneReportForHistory(built);
  state.lastReport = pruned;
  await persistLastSuiteReport(pruned);
  await addReportToHistory(pruned);
  return pruned;
}

function downloadReportHtml(report) {
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

async function downloadReport() {
  if (state.lastReport?.metadata?.reportId) {
    downloadReportHtml(state.lastReport);
    return;
  }

  // Try the last persisted suite report first (stable reportId across popup reopen).
  try {
    const data = await chrome.storage.local.get(LAST_SUITE_REPORT_KEY);
    const saved = data?.[LAST_SUITE_REPORT_KEY]?.report;
    if (saved?.metadata?.reportId) {
      state.lastReport = saved;
      downloadReportHtml(saved);
      return;
    }
  } catch {}

  // If state.results is empty (popup was reopened after run), recover from storage.
  if (!state.results.length) {
    try {
      const data = await chrome.storage.local.get(["opforLastResult", "opforLiveTranscript"]);
      const opforLastResult = data.opforLastResult;
      const liveTranscript = data.opforLiveTranscript;

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
      } else if (opforLastResult?.transcript?.length >= 2) {
        const turnCount = opforLastResult.transcript.length;
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
      } else if (liveTranscript?.transcript?.length >= 2) {
        let judgedResult = null;
        try {
          const judged = await chrome.runtime.sendMessage({
            type: "OPFOR_JUDGE_PARTIAL",
            transcript: liveTranscript.transcript,
            evaluatorId: liveTranscript.evaluatorId,
            attackObjective: state.attackObjective || "",
            judgeHint: state.judgeHint || "",
          });
          if (judged?.ok && judged?.judgment) judgedResult = judged;
        } catch {}

        if (judgedResult) {
          const v =
            String(judgedResult.judgment.verdict || "FAIL").toUpperCase() === "PASS"
              ? "PASS"
              : "FAIL";
          state.results = [
            {
              id: judgedResult.evaluatorId || liveTranscript.evaluatorId || "unknown",
              name: judgedResult.evaluatorName || liveTranscript.evaluatorName || "Evaluator",
              sev: normalizeSev(judgedResult.severity || liveTranscript.severity),
              verdict: v,
              summary: (judgedResult.judgment.summary || "") + " (recovered from interrupted run)",
              raw: judgedResult,
            },
          ];
        } else {
          const turnCount = liveTranscript.transcript.length;
          state.results = [
            {
              id: liveTranscript.evaluatorId || "unknown",
              name: liveTranscript.evaluatorName || "Evaluator",
              sev: normalizeSev(liveTranscript.severity),
              verdict: "FAIL",
              summary: `Run was interrupted after ${Math.floor(turnCount / 2)} turns. Transcript recovered but judgment could not be produced.`,
              raw: {
                ok: true,
                partial: true,
                stopped: true,
                stopReason: "interrupted",
                transcript: liveTranscript.transcript,
                turns: liveTranscript.turns || [],
                evaluatorId: liveTranscript.evaluatorId,
                evaluatorName: liveTranscript.evaluatorName,
                severity: liveTranscript.severity,
              },
            },
          ];
        }
      }
    } catch {}
  }

  const report = (await finalizeAndPersistCurrentReport()) || pruneReportForHistory(buildReport());
  state.lastReport = report;
  downloadReportHtml(report);
}

// ── History UI ──────────────────────────────────────────────────
function formatWhen(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || "—");
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso || "—");
  }
}

function suiteLabel(configId) {
  const s = state.catalog?.suites?.find((x) => x.id === configId);
  return s?.name || configId || "run";
}

const HISTORY_ICONS = {
  download: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  trash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 13.1A2 2 0 0 1 15.6 21H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  clock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
};

let pendingClearConfirm = false;

function renderEmptyHistory(root) {
  root.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "hist-empty";
  empty.innerHTML = `
    <div class="icon-wrap">${HISTORY_ICONS.clock}</div>
    <div class="title">No past runs</div>
    <div class="help">Reports from completed red-team runs will appear here so you can re-download or remove them.</div>
  `;
  root.appendChild(empty);
}

function updateHistoryChrome(count) {
  const countEl = $("historyCount");
  if (countEl) {
    countEl.textContent = String(count);
    countEl.hidden = count === 0;
  }
  const body = $("historyBody");
  if (body) body.dataset.empty = count === 0 ? "true" : "false";
  const foot = $("historyFoot");
  if (foot) foot.hidden = count === 0;
  resetClearConfirm();
}

function resetClearConfirm() {
  pendingClearConfirm = false;
  const btn = $("historyClearBtn");
  const label = $("historyClearLabel");
  if (btn) btn.dataset.confirm = "false";
  if (label) label.textContent = "Clear history";
}

function renderHistoryList(items) {
  const root = $("historyList");
  if (!root) return;
  root.innerHTML = "";
  updateHistoryChrome(items.length);

  if (!items.length) {
    renderEmptyHistory(root);
    return;
  }

  for (const item of items) {
    const report = item?.report;
    const id = item?.id || report?.metadata?.reportId || "";
    const cfg = item?.configId || report?.metadata?.configId || "";
    const sum = item?.summary || report?.summary || {};
    const total = Number(sum.totalEvaluators ?? sum.totalTests ?? 0) || 0;
    const failed = Number(sum.failed ?? 0) || 0;
    const passed = Number(sum.passed ?? 0) || 0;
    const gen = item?.generated || report?.metadata?.generated || "";
    const allPassed = failed === 0 && total > 0;

    const wrap = document.createElement("div");
    wrap.className = "history-item";
    wrap.dataset.status = allPassed ? "pass" : "fail";

    const stripe = document.createElement("div");
    stripe.className = "accent-stripe";
    wrap.appendChild(stripe);

    const body = document.createElement("div");
    body.className = "history-item-body";

    const name = document.createElement("div");
    name.className = "history-item-name";
    name.textContent = suiteLabel(cfg);
    body.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    const whenSpan = document.createElement("span");
    whenSpan.textContent = formatWhen(gen);
    const sep1 = document.createElement("span");
    sep1.className = "sep";
    sep1.textContent = "·";
    const passedSpan = document.createElement("span");
    passedSpan.className = "passed";
    if (allPassed) passedSpan.dataset.all = "true";
    passedSpan.textContent = `${passed}/${total} passed`;
    const sep2 = document.createElement("span");
    sep2.className = "sep";
    sep2.textContent = "·";
    const failedSpan = document.createElement("span");
    failedSpan.className = "failed";
    if (failed > 0) failedSpan.dataset.any = "true";
    failedSpan.textContent = `${failed} failed`;
    meta.append(whenSpan, sep1, passedSpan, sep2, failedSpan);
    body.appendChild(meta);

    const idEl = document.createElement("div");
    idEl.className = "history-item-id";
    idEl.textContent = trimStr(id, 80);
    body.appendChild(idEl);

    wrap.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn-download";
    dlBtn.innerHTML = `${HISTORY_ICONS.download}<span>Download</span>`;
    dlBtn.addEventListener("click", () => {
      if (!report?.metadata?.reportId || dlBtn.dataset.state === "saved") return;
      downloadReportHtml(report);
      dlBtn.dataset.state = "saved";
      const labelEl = dlBtn.querySelector("span");
      if (labelEl) labelEl.textContent = "Saved";
      setTimeout(() => {
        if (!dlBtn.isConnected) return;
        delete dlBtn.dataset.state;
        if (labelEl) labelEl.textContent = "Download";
      }, 900);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-delete";
    delBtn.innerHTML = `${HISTORY_ICONS.trash}<span>Delete</span>`;
    delBtn.addEventListener("click", async () => {
      const cur = await getReportHistory();
      const next = cur.filter((x) => x?.id !== id);
      await setReportHistory(next);
      renderHistoryList(next);
    });

    actions.appendChild(dlBtn);
    actions.appendChild(delBtn);
    wrap.appendChild(actions);

    root.appendChild(wrap);
  }
}

async function openHistory() {
  if (state.screen === "running") return;
  const items = await getReportHistory();
  renderHistoryList(items);
  $("historyPanel").dataset.open = "true";
}

function closeHistory() {
  $("historyPanel").dataset.open = "false";
  resetClearConfirm();
}

async function clearHistory() {
  const btn = $("historyClearBtn");
  const label = $("historyClearLabel");
  const items = await getReportHistory();
  if (!items.length) return;
  if (!pendingClearConfirm) {
    pendingClearConfirm = true;
    if (btn) btn.dataset.confirm = "true";
    if (label) label.textContent = `Confirm — clear all ${items.length} runs?`;
    return;
  }
  await setReportHistory([]);
  renderHistoryList([]);
}

// ── Run loop ───────────────────────────────────────────────────
async function runOneEvaluator(ev, { resume = false } = {}) {
  resetBubbles();
  progressActive = false;
  startCosmeticTicker();
  const payload = resume
    ? {
        type: "OPFOR_UI_RESUME",
        messageCharLimit: state.messageCharLimit,
        scrapeFromSite: state.scrapeFromSite,
        agentDescription: state.agentDescription || "",
        businessUseCase: state.businessUseCase || "",
        attackObjective: state.attackObjective || "",
        judgeHint: state.judgeHint || "",
      }
    : {
        type: "OPFOR_UI_RUN",
        suiteId: state.suiteId,
        evaluatorId: ev.id,
        maxRounds: state.maxTurns,
        waitMs: state.waitSec * 1000,
        messageCharLimit: state.messageCharLimit,
        scrapeFromSite: state.scrapeFromSite,
        agentDescription: state.agentDescription || "",
        attackObjective: state.attackObjective || "",
        businessUseCase: state.businessUseCase || "",
        judgeHint: state.judgeHint || "",
        tabId: state.targetTabId || undefined,
      };
  setPhase("locating");

  // Fire-and-forget: kick off the run in the service worker but don't rely
  // on the message channel for the result.  Chrome MV3 message ports are
  // unreliable for long-running operations (channel timeouts, service-worker
  // restarts, multiple-listener races).  Instead we always poll storage.
  let directResult;
  try {
    directResult = await Promise.race([
      chrome.runtime.sendMessage(payload),
      new Promise((r) => setTimeout(() => r(undefined), 5000)),
    ]);
  } catch {
    directResult = undefined;
  }

  // If the service worker replied quickly with a definitive result, use it.
  if (directResult?.ok && directResult?.judgment) {
    stopCosmeticTicker();
    setPhase("judging");
    await new Promise((r) => setTimeout(r, 250));
    const verdict =
      String(directResult.judgment?.verdict || "FAIL").toUpperCase() === "PASS" ? "PASS" : "FAIL";
    return {
      record: {
        id: ev.id,
        name: ev.name,
        sev: ev.sev,
        verdict,
        summary: directResult.judgment?.summary || "",
        raw: directResult,
      },
    };
  }
  if (directResult?.paused) {
    stopCosmeticTicker();
    return { paused: true, error: directResult.error };
  }

  // Otherwise poll storage — the service worker persists results there.
  const result = await pollStorageForResult(ev.id);
  stopCosmeticTicker();

  if (result?.paused) return { paused: true, error: result.error };
  if (!result?.ok) {
    const errMsg = result?.error || directResult?.error || "Unknown error";
    return { error: errMsg };
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

/**
 * Poll chrome.storage.local for a completed or judged result.
 * The service worker persists results to `opforLastResult` and live transcripts
 * to `opforLiveTranscript`. This function keeps polling as long as the run is
 * active, with an absolute cap of 10 minutes.
 */
async function pollStorageForResult(evaluatorId) {
  const POLL_MS = 2000;
  const ABS_MAX_MS = 600_000;
  const pollStart = Date.now();
  let seenRunning = false;

  while (Date.now() - pollStart < ABS_MAX_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    let data;
    try {
      data = await chrome.storage.local.get([
        "opforLastResult",
        "opforLiveTranscript",
        "opforRunStatus",
      ]);
    } catch {
      continue;
    }

    // 1. Best case: completed result with judgment
    const last = data.opforLastResult;
    if (last?.judgment) {
      if (last.evaluatorId === evaluatorId || last.completed) return last;
    }

    const status = data.opforRunStatus;

    // 2. Run still active — keep polling
    if (status?.running) {
      seenRunning = true;
      continue;
    }

    // 3. Run ended — give it one extra beat for storage writes to settle
    if (seenRunning && !last?.judgment) {
      seenRunning = false;
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const fresh = await chrome.storage.local.get(["opforLastResult"]);
        if (fresh.opforLastResult?.judgment) return fresh.opforLastResult;
      } catch {}
    }

    // 4. Completed result with judgment (re-check after settle)
    if (last?.judgment) return last;

    // 5. Service worker returned an explicit error (ok: false, no judgment)
    if (last && last.ok === false && last.errorMessage) {
      return { ok: false, error: last.errorMessage };
    }

    // 6. Live transcript available — ask service worker to judge it
    const live = data.opforLiveTranscript;
    if (live?.transcript?.length >= 2) {
      try {
        const judged = await chrome.runtime.sendMessage({
          type: "OPFOR_JUDGE_PARTIAL",
          transcript: live.transcript,
          evaluatorId: live.evaluatorId || evaluatorId,
          attackObjective: state.attackObjective || "",
          judgeHint: state.judgeHint || "",
        });
        if (judged?.ok && judged?.judgment) return judged;
      } catch {}

      return {
        ok: true,
        partial: true,
        stopped: true,
        stopReason: "channel_closed",
        evaluatorId: live.evaluatorId,
        evaluatorName: live.evaluatorName,
        severity: live.severity,
        transcript: live.transcript,
        turns: live.turns || [],
        judgment: {
          verdict: "FAIL",
          summary: `Run completed ${Math.floor(live.transcript.length / 2)} turns but judgment could not be produced.`,
          findings: live.transcript
            .filter((m) => m.role === "assistant")
            .map((m) => String(m.content || "").slice(0, 500)),
          score: 5,
        },
      };
    }

    // 7. Nothing in storage yet and run was never seen — wait a bit longer
    //    for the service worker to wake up and start (cold-start grace period)
    if (!seenRunning && Date.now() - pollStart < 15_000) continue;

    // 8. Run ended with nothing usable
    break;
  }

  // Final attempt
  try {
    const data = await chrome.storage.local.get(["opforLastResult", "opforLiveTranscript"]);
    if (data.opforLastResult?.judgment) return data.opforLastResult;
    if (data.opforLastResult?.errorMessage)
      return { ok: false, error: data.opforLastResult.errorMessage };

    const live = data.opforLiveTranscript;
    if (live?.transcript?.length >= 2) {
      try {
        const judged = await chrome.runtime.sendMessage({
          type: "OPFOR_JUDGE_PARTIAL",
          transcript: live.transcript,
          evaluatorId: live.evaluatorId || evaluatorId,
          attackObjective: state.attackObjective || "",
          judgeHint: state.judgeHint || "",
        });
        if (judged?.ok && judged?.judgment) return judged;
      } catch {}
    }
  } catch {}

  return {
    ok: false,
    error: "Run did not produce a result. The service worker may have been interrupted.",
  };
}

async function startRun({ resume = false } = {}) {
  if (state.running) return;
  state.running = true;
  state.cancelRequested = false;
  state.pauseRequested = false;
  state.lastReport = null;
  await saveModelAndKey();

  // Build queue from current selection (or use existing queue if resuming)
  if (!resume) {
    await saveSettings();
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

    try {
      await chrome.storage.local.remove(["opforLastResult", "opforLiveTranscript"]);
    } catch {}
  }

  // Keep the service worker alive for the entire run duration.
  if (!state.keepAlivePort) {
    try {
      state.keepAlivePort = chrome.runtime.connect({ name: "opfor-keepalive" });
      state.keepAlivePort.onDisconnect.addListener(() => {
        state.keepAlivePort = null;
      });
    } catch {}
  }

  // Capture the target tab once so subsequent evaluators don't fail
  // when chrome.tabs.query can't resolve the active tab mid-run.
  if (!state.targetTabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) state.targetTabId = tab.id;
    } catch {}
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
      try {
        state.keepAlivePort?.disconnect();
      } catch {}
      state.keepAlivePort = null;
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
      let recovered = null;
      try {
        const data = await chrome.storage.local.get(["opforLastResult", "opforLiveTranscript"]);
        const opforLastResult = data.opforLastResult;
        const live = data.opforLiveTranscript;

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
        } else if (live?.transcript?.length >= 2) {
          try {
            const judged = await chrome.runtime.sendMessage({
              type: "OPFOR_JUDGE_PARTIAL",
              transcript: live.transcript,
              evaluatorId: live.evaluatorId || ev.id,
              attackObjective: state.attackObjective || "",
              judgeHint: state.judgeHint || "",
            });
            if (judged?.ok && judged?.judgment) {
              const v =
                String(judged.judgment.verdict || "FAIL").toUpperCase() === "PASS"
                  ? "PASS"
                  : "FAIL";
              recovered = {
                id: ev.id,
                name: ev.name,
                sev: ev.sev,
                verdict: v,
                summary: (judged.judgment.summary || "") + " (recovered from interrupted run)",
                raw: judged,
              };
            }
          } catch {}
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
        await chrome.runtime.sendMessage({
          type: "OPFOR_RESET_CHAT",
          tabId: state.targetTabId || undefined,
        });
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  state.running = false;
  state.targetTabId = null;
  try {
    state.keepAlivePort?.disconnect();
  } catch {}
  state.keepAlivePort = null;
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

  await finalizeAndPersistCurrentReport();
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
      await finalizeAndPersistCurrentReport();
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

async function cancelAwaitUser() {
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_STOP" });
  } catch {}
  stopCosmeticTicker();
  state.running = false;
  state.queue = [];
  state.results = [];
  state.evIdx = 0;
  setScreen("idle");
}

async function retryLocate() {
  setScreen("running");
  renderRunningHeader();
  renderRunStrip();
  setPhase("locating");
  // Show evaluator name while retrying
  const cur = state.queue[state.evIdx];
  if (cur) {
    $("runEvalName").textContent = cur.name;
  }
  $("runPhaseText").textContent = "Retrying chat detection";
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_RETRY_LOCATE" });
  } catch {}
}

function modelsForProvider(provider) {
  const list = MODELS_BY_PROVIDER[provider] || [];
  return list.map((m) => ({ value: m, label: m }));
}

function scrollBodyToBottom() {
  const el = document.querySelector(".body");
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

function clearFetchError() {
  const el = $("fetchModelsError");
  if (el) {
    el.textContent = "";
    el.style.display = "none";
  }
}

function showFetchError(msg) {
  const el = $("fetchModelsError");
  if (!el) return;
  el.textContent = msg;
  el.style.color = "var(--fail)";
  el.style.display = "";
}

function applyProvider({ resetModel = false } = {}) {
  const isCompatible = state.provider === PROVIDERS.OPENAI_COMPATIBLE;
  const needsBaseUrl = PROVIDERS_NEEDING_BASE_URL.has(state.provider);
  const isSimple = !!SIMPLE_PROVIDER_FETCH_CONFIG[state.provider];

  // Reparent modelSection: inside endpointCardBody for custom, outside for others
  const modelSec = $("modelSection");
  const cardBody = $("endpointCardBody");
  const standaloneKey = $("standaloneApiKey");
  if (isCompatible) {
    if (modelSec.parentElement !== cardBody) cardBody.appendChild(modelSec);
  } else {
    if (modelSec.previousElementSibling !== standaloneKey) {
      standaloneKey.insertAdjacentElement("afterend", modelSec);
    }
  }

  // Endpoint card — only Azure + OpenAI-compatible
  $("endpointSection").style.display = needsBaseUrl ? "" : "none";
  const compatOnly = isCompatible ? "" : "none";
  // $("endpointDivider1").style.display = compatOnly;
  $("endpointKeyHint").style.display = isCompatible ? "inline-flex" : "none";
  $("endpointKeyOptional").style.display = compatOnly;
  $("endpointStepLoad").style.display = compatOnly;
  $("refreshModelsBtn").style.display = compatOnly;

  // Standalone API key — simple providers only
  $("standaloneApiKey").style.display = isSimple ? "" : "none";

  clearFetchError();
  setFetchStatus("", "");
  setModelHint("");

  if (isCompatible) {
    $("endpointCardBody").dataset.open = "true";
    $("modelSection").style.display = "none";
    $("modelDropdown").style.display = "";
  } else if (isSimple) {
    $("modelSection").style.display = "";
    if (resetModel) {
      modelDD?.setOptions([]);
      modelDD?.setValue("");
      state.model = "";
      if (state.apiKey.trim()) {
        fetchModelsForSimpleProvider();
      } else {
        setModelHint("Enter your API key to load models.");
      }
    }
  } else {
    // Azure
    $("endpointCardBody").dataset.open = "true";
    $("modelSection").style.display = "";
    const models = modelsForProvider(state.provider);
    modelDD?.setOptions(models);
    if (resetModel) {
      const defaultModel = PROVIDER_DEFAULT_MODELS[state.provider] || "";
      state.model = defaultModel;
      modelDD?.setValue(defaultModel);
    }
  }
}

function setEndpointChevron(open) {
  const chev = $("endpointCardHead")?.querySelector(".endpoint-chev");
  if (chev) chev.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
}

async function fetchModelsFromBaseUrl() {
  const baseUrl = state.baseUrl?.trim().replace(/\/$/, "");
  if (!baseUrl) {
    showFetchError("Enter a base URL first.");
    return;
  }
  clearFetchError();
  const isRefresh = $("modelSection").style.display !== "none";
  $("modelSection").style.display = "";
  $("modelDropdown").style.display = "none";
  setFetchStatus("Loading…", "loading");
  try {
    const headers = { "Content-Type": "application/json" };
    if (state.apiKey) headers["Authorization"] = `Bearer ${state.apiKey}`;
    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        throw new Error(
          state.apiKey
            ? "Invalid API key — authentication failed."
            : "Server requires authentication — enter an API key."
        );
      if (res.status === 404) throw new Error("Server doesn't expose a /models endpoint.");
      throw new Error(`Server returned HTTP ${res.status}.`);
    }
    const json = await res.json();
    const ids = (json.data ?? json.models ?? []).map((m) => m.id ?? m).filter(Boolean);
    if (!ids.length) {
      const errMsg = "No models returned by the server.";
      if (!isRefresh) {
        $("modelSection").style.display = "none";
        $("modelDropdown").style.display = "";
        $("endpointStepLoad").style.display = "";
        showFetchError(errMsg);
      } else {
        $("modelDropdown").style.display = "";
        setFetchStatus(errMsg, "error");
      }
      return;
    }
    const options = ids.map((id) => ({ value: id, label: id }));
    modelDD?.setOptions(options);
    state.model = ids[0];
    modelDD?.setValue(ids[0]);
    saveModelAndKey();
    $("modelDropdown").style.display = "";
    $("endpointStepLoad").style.display = "none";
    $("refreshModelsBtn").style.display = "";
    setFetchStatus(`${ids.length} model${ids.length > 1 ? "s" : ""} loaded.`, "ok");
  } catch (e) {
    const msg =
      e instanceof TypeError ? "Could not reach the server — check the base URL." : e.message;
    if (!isRefresh) {
      $("modelSection").style.display = "none";
      $("modelDropdown").style.display = "";
      $("endpointStepLoad").style.display = "";
      showFetchError(msg);
    } else {
      $("modelDropdown").style.display = "";
      setFetchStatus(msg, "error");
    }
  }
}

function setFetchStatus(msg, type) {
  const el = $("fetchModelsStatus");
  if (!el) return;
  el.textContent = msg;
  el.style.color =
    type === "error" ? "var(--fail)" : type === "ok" ? "var(--pass)" : "var(--muted)";
}

function setModelHint(msg, type = "") {
  const el = $("modelFetchHint");
  if (!el) return;
  el.style.display = msg ? "" : "none";
  el.textContent = msg;
  el.style.color =
    type === "error" ? "var(--fail)" : type === "ok" ? "var(--pass)" : "var(--muted)";
}

async function fetchModelsForSimpleProvider() {
  const provider = state.provider;
  const cfg = SIMPLE_PROVIDER_FETCH_CONFIG[provider];
  if (!cfg) return;

  const key = state.apiKey.trim();
  if (!key) {
    setModelHint("Enter your API key to load models.");
    return;
  }

  modelDD?.setLoading(true);
  setModelHint("");
  try {
    const url = cfg.url(key);
    const res = await fetch(url, { headers: cfg.headers(key) });

    if (!res.ok) {
      let errBody = null;
      try {
        errBody = await res.json();
      } catch {}
      const errMsg = errBody?.error?.message || "";
      const errStatus = errBody?.error?.status || "";
      if (
        res.status === 401 ||
        res.status === 403 ||
        errStatus === "INVALID_ARGUMENT" ||
        errMsg.toLowerCase().includes("api key") ||
        errMsg.toLowerCase().includes("invalid")
      )
        throw new Error("Invalid API key — authentication failed.");
      if (res.status === 429) throw new Error("Rate limited — try again shortly.");
      throw new Error(errMsg || `Server returned HTTP ${res.status}.`);
    }

    const json = await res.json();
    const ids = cfg.parse(json);
    if (!ids.length) throw new Error("No models returned.");

    const opts = ids.map((id) => ({ value: id, label: id }));
    modelDD?.setLoading(false);
    modelDD?.setOptions(opts);
    const keep = ids.includes(state.model) ? state.model : ids[0];
    state.model = keep;
    modelDD?.setValue(keep);
    saveModelAndKey();
    setModelHint("");
  } catch (e) {
    modelDD?.setLoading(false);
    modelDD?.setOptions([]);
    const msg =
      e instanceof TypeError
        ? `Could not reach ${state.provider} — check your connection.`
        : e.message;
    setModelHint(msg, "error");
  }
}

// ── Wiring ─────────────────────────────────────────────────────
function wire() {
  // Dropdowns
  suiteDD = buildDropdown("suiteDropdown", [{ value: "", label: "Loading…" }], "", (v) =>
    setSuite(v)
  );
  providerDD = buildDropdown("providerDropdown", PROVIDER_OPTIONS, state.provider, (v) => {
    state.provider = v;
    applyProvider({ resetModel: true });
    saveModelAndKey();
    updateRunButton();
  });

  modelDD = buildDropdown(
    "modelDropdown",
    modelsForProvider(state.provider),
    state.model,
    (v) => {
      state.model = v;
      saveModelAndKey();
    },
    {
      inlineSearch: true,
      onOpen: () => {
        if (SIMPLE_PROVIDER_FETCH_CONFIG[state.provider]) fetchModelsForSimpleProvider();
      },
    }
  );

  // Evals collapse
  $("evalsHead").addEventListener("click", () => {
    const evs = $("evals");
    evs.dataset.open = evs.dataset.open === "true" ? "false" : "true";
  });
  function toggleAllEvaluators(e) {
    e.stopPropagation();
    const suite = state.catalog?.suites.find((s) => s.id === state.suiteId);
    if (!suite) return;
    const allOn = suite.evaluatorIds.every((id) => state.selectedEvaluators.has(id));
    if (allOn) state.selectedEvaluators.clear();
    else state.selectedEvaluators = new Set(suite.evaluatorIds);
    renderEvaluatorList();
    updateRunButton();
    saveSettings();
  }
  $("evalsToggleAll").addEventListener("click", toggleAllEvaluators);
  $("evalsSelectAll").addEventListener("click", toggleAllEvaluators);

  // Scrape toggle
  bindToggle(
    "scrapeToggle",
    () => state.scrapeFromSite,
    (v) => {
      state.scrapeFromSite = v;
      saveSettings();
      refreshScrapeMeta();
      updateRunButton();
    }
  );
  $("agentDescription").addEventListener("input", (e) => {
    state.agentDescription = e.target.value;
    autoSizeTextarea(e.target);
    saveSettings();
    updateRunButton();
  });

  // Load / refresh models (OpenAI-compatible)
  $("fetchModelsBtn").addEventListener("click", () => fetchModelsFromBaseUrl());
  $("refreshModelsBtn").addEventListener("click", () => fetchModelsFromBaseUrl());

  // Base URL (Azure + OpenAI-compatible)
  $("baseUrl").addEventListener("input", (e) => {
    state.baseUrl = e.target.value;
    saveModelAndKey();
    setModelHint("");
    if (state.provider === PROVIDERS.OPENAI_COMPATIBLE) {
      $("modelSection").style.display = "none";
      $("modelDropdown").style.display = "";
      $("endpointStepLoad").style.display = "";
      $("refreshModelsBtn").style.display = "none";
      setFetchStatus("", "");
      clearFetchError();
    }
  });

  // Standalone API key (simple providers)
  $("apiKey").addEventListener("input", (e) => {
    state.apiKey = e.target.value;
    $("apiKeyCard").value = e.target.value;
    saveModelAndKey();
    updateRunButton();
    setModelHint("");
    setFetchStatus("", "");
    clearFetchError();
  });

  function wireEyeBtn(btnId, iconId, inputId) {
    $(btnId).addEventListener("click", () => {
      const input = $(inputId);
      const eye = $(iconId);
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
  }
  wireEyeBtn("apiKeyEye", "eyeIcon", "apiKey");

  // Card API key (Azure + OpenAI-compatible)
  $("apiKeyCard").addEventListener("input", (e) => {
    state.apiKey = e.target.value;
    $("apiKey").value = e.target.value;
    saveModelAndKey();
    updateRunButton();
    setModelHint("");
    setFetchStatus("", "");
    clearFetchError();
  });
  wireEyeBtn("apiKeyCardEye", "eyeIconCard", "apiKeyCard");

  // Buttons
  $("runBtn").addEventListener("click", () => startRun({ resume: false }));
  $("pauseBtn").addEventListener("click", requestPause);
  $("stopBtn").addEventListener("click", requestStop);
  $("resumeBtn").addEventListener("click", () => startRun({ resume: true }));
  $("discardPausedBtn").addEventListener("click", discardPaused);
  $("awaitUserCancelBtn").addEventListener("click", cancelAwaitUser);
  $("awaitUserRetryBtn").addEventListener("click", retryLocate);
  $("newRunBtn").addEventListener("click", () => {
    state.queue = [];
    state.results = [];
    state.evIdx = 0;
    state.lastReport = null;
    setScreen("idle");
  });
  $("downloadBtn").addEventListener("click", downloadReport);

  // History panel
  $("historyBtn").addEventListener("click", openHistory);
  $("historyCloseBtn").addEventListener("click", closeHistory);
  $("historyClearBtn").addEventListener("click", clearHistory);
  $("historyClearBtn").addEventListener("mouseleave", resetClearConfirm);

  // Advanced panel
  $("advancedBtn").addEventListener("click", openAdvanced);
  $("advCloseBtn").addEventListener("click", closeAdvanced);
  $("advDoneBtn").addEventListener("click", closeAdvanced);

  // Steppers
  bindStepper("maxTurns", "maxTurnsValue", "maxTurns", 1, 20);
  bindStepper("waitSec", "waitSecValue", "waitSec", 3, 30);
  bindStepper("messageCharLimit", "messageCharLimitValue", "messageCharLimit", 100, 1500);

  // Advanced text fields
  $("attackObjective").addEventListener("input", (e) => {
    state.attackObjective = e.target.value;
    saveSettings();
  });
  $("businessUseCase").addEventListener("input", (e) => {
    state.businessUseCase = e.target.value;
    saveSettings();
  });
  $("judgeHint").addEventListener("input", (e) => {
    state.judgeHint = e.target.value;
    saveSettings();
  });

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

  // Check if we need to show the await_user screen
  const phase = opforRunStatus?.phase || "running";
  if (phase === "await_user") {
    state.awaitUserError = opforRunStatus?.awaitUserError || "Could not find chat widget";
    $("awaitUserError").textContent = state.awaitUserError;
    const cur = state.queue[state.evIdx];
    $("awaitUserEvaluator").textContent = cur?.name || "—";
    setScreen("awaitUser");
    startRunStatusPoller();
    return true;
  }

  setScreen("running");
  renderRunningHeader();
  renderRunStrip();

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
    if (state.screen !== "running" && state.screen !== "awaitUser") {
      stopRunStatusPoller();
      return;
    }
    try {
      const { opforRunStatus } = await chrome.storage.local.get("opforRunStatus");
      if (!opforRunStatus) return;

      // Handle await_user phase transition
      if (opforRunStatus.phase === "await_user" && state.screen !== "awaitUser") {
        state.awaitUserError = opforRunStatus.awaitUserError || "Could not find chat widget";
        $("awaitUserError").textContent = state.awaitUserError;
        const cur = state.queue[state.evIdx];
        $("awaitUserEvaluator").textContent = cur?.name || "—";
        setScreen("awaitUser");
        return;
      }

      // Handle transition back from await_user to running/locating
      if (state.screen === "awaitUser" && opforRunStatus.phase !== "await_user") {
        setScreen("running");
        renderRunningHeader();
        renderRunStrip();
        setPhase(opforRunStatus.phase || "locating");
        // Show evaluator name
        const cur = state.queue[state.evIdx];
        if (cur) {
          $("runEvalName").textContent = cur.name;
        }
        return;
      }

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
            await finalizeAndPersistCurrentReport();
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
  providerDD.setValue(state.provider);
  modelDD.setOptions(modelsForProvider(state.provider));
  modelDD.setValue(state.model);
  $("baseUrl").value = state.baseUrl;
  $("apiKey").value = state.apiKey;
  $("apiKeyCard").value = state.apiKey;
  applyProvider();
  updateRunButton();
  $("agentDescription").value = state.agentDescription;
  $("attackObjective").value = state.attackObjective;
  $("businessUseCase").value = state.businessUseCase;
  $("judgeHint").value = state.judgeHint;
  $("scrapeToggle").setAttribute("aria-checked", String(state.scrapeFromSite));
  $("maxTurns").value = String(state.maxTurns);
  $("maxTurnsValue").textContent = String(state.maxTurns);
  $("waitSec").value = String(state.waitSec);
  $("waitSecValue").textContent = String(state.waitSec);
  $("messageCharLimit").value = String(state.messageCharLimit);
  $("messageCharLimitValue").textContent = String(state.messageCharLimit);

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
