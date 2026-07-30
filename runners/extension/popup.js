// ─────────────────────────────────────────────────────────────────
// Opfor red-team panel — vanilla JS implementation of the design.
// Runs in the Chrome side panel (sidepanel.html → sidepanel-bootstrap.js).
// Drives idle / running / paused / done screens and the slide-in
// advanced panel. Talks to service_worker.js via the existing
// OPFOR_UI_RUN / RESUME / STOP / DISCARD_PAUSED message contracts.
// ─────────────────────────────────────────────────────────────────

import {
  PROVIDERS,
  PROVIDER_CAPABILITIES,
  PROVIDER_DISPLAY_NAMES,
  renderReport,
} from "./dist/core.bundle.js";

const PROVIDER_OPTIONS = Object.values(PROVIDERS).map((value) => ({
  value,
  label: PROVIDER_DISPLAY_NAMES[value],
}));

// Extension-only model lists/defaults — deliberately not sourced from core's PROVIDER_DEFAULTS.
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
const PROVIDERS_NEEDING_BASE_URL = new Set(
  Object.values(PROVIDERS).filter((p) => PROVIDER_CAPABILITIES[p].requiresBaseURL)
);

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
  // Wall-clock start of the current/last run, persisted alongside the queue so
  // it survives a popup close/reopen mid-run — used to compute report duration.
  runStartedAt: /** @type {number | null} */ (null),
  // True only while THIS popup instance's startRun() loop is actively
  // driving a run — as opposed to `running`, which also gets set to true
  // when the popup reopens mid-run and merely restores the running screen
  // from storage. Code that needs to know "is a loop here to notice a
  // stop/pause request" must gate on this, not on `running`.
  loopActive: false,
  cancelRequested: false,
  pauseRequested: false,
  // Set when the current/last completed run ended via user cancellation
  // (as opposed to running to natural completion). Drives the "Cancelled"
  // status on the done screen instead of PASS/FAIL.
  runCancelled: false,
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

// Toggle a run-control button (Pause/Stop) into a disabled/loading state
// while its request is in flight — both can take a few seconds to actually
// resolve, since the popup waits on the in-flight evaluator to unwind.
// Stopping supersedes pausing, so Stop-busy also disables Pause. The reverse
// does not hold: Pause-busy leaves Stop enabled, so the user can still
// escalate a slow pause into a stop rather than being stuck with no escape
// hatch — pause-to-cancel is a safe transition (the `intent` flag on the
// last OPFOR_UI_STOP wins).
function setRunControlBusy(prefix, busy, busyLabel) {
  const btn = $(prefix === "stop" ? "stopBtn" : "pauseBtn");
  if (btn) btn.disabled = busy;
  if (prefix === "stop") {
    const pauseBtn = $("pauseBtn");
    if (pauseBtn) pauseBtn.disabled = busy;
    // Stop is also reachable from the Paused screen — keep it in sync.
    const pausedStopBtn = $("pausedStopBtn");
    if (pausedStopBtn) pausedStopBtn.disabled = busy;
  }
  if (!btn) return;
  const icon = btn.querySelector(`.${prefix}-btn-icon`);
  const spinner = btn.querySelector(`.${prefix}-btn-spinner`);
  const label = btn.querySelector(`.${prefix}-btn-label`);
  if (icon) icon.hidden = busy;
  if (spinner) spinner.hidden = !busy;
  if (label) label.textContent = busy ? busyLabel : prefix === "stop" ? "Stop" : "Pause";
}

function setStopBusy(busy) {
  setRunControlBusy("stop", busy, "Stopping…");
}

function setPauseBusy(busy) {
  setRunControlBusy("pause", busy, "Pausing…");
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
  // A fresh "running" screen (new run, resume, retry) always starts with
  // usable controls — reset any busy state left over from a prior stop.
  if (name === "running") {
    setStopBusy(false);
    setPauseBusy(false);
  }
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
        scrollDropdownIntoView(root);
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
      if (opening) scrollDropdownIntoView(root);
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
    open() {
      if (root.dataset.open !== "true") {
        root.dataset.open = "true";
        scrollDropdownIntoView(root);
        setTimeout(() => {
          if (searchInput && shouldShowSearch()) searchInput.focus();
        }, 0);
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

  // Re-apply search filter after re-rendering the list
  const searchInput = $("evalsSearch");
  if (searchInput) {
    const query = searchInput.value.toLowerCase().trim();
    if (query) {
      list.querySelectorAll(".eval-item").forEach((item) => {
        const name = item.querySelector(".eval-name")?.textContent?.toLowerCase() || "";
        const matches = name.includes(query);
        item.dataset.hidden = matches ? "false" : "true";
      });
    }
  }
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
  const missingModel = !state.model.trim();
  const missingEvals = state.selectedEvaluators.size === 0;
  const missingSuite = !state.suiteId || !state.catalog;
  $("runBtn").disabled = missingKey || missingModel || missingEvals || missingSuite;
}

// ── Suite description + dropdown wiring ────────────────────────
let suiteDD, modelDD, providerDD;

// True once the custom-provider model list has been successfully fetched.
// Reset whenever anything that would invalidate the list changes.
let _compatModelsLoaded = false;

function resetCompatModels() {
  _compatModelsLoaded = false;
  modelDD?.setOptions([]);
  modelDD?.setValue("");
  state.model = "";
  setModelHint("");
  updateRunButton();
}

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
    scrapeFromSite: true,
    maxTurns: clamp(Number(s.maxTurns) || 10, 1, 50),
    waitSec: clamp(Number(s.waitSec) || 10, 3, 30),
    messageCharLimit: clamp(Math.round((Number(s.messageCharLimit) || 500) / 50) * 50, 100, 1500),
    attackObjective: s.attackObjective ?? "",
    businessUseCase: s.businessUseCase ?? "",
    judgeHint: s.judgeHint ?? "",
    agentDescription: s.agentDescription ?? "",
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
      maxTurns: state.maxTurns,
      waitSec: state.waitSec,
      messageCharLimit: state.messageCharLimit,
      attackObjective: state.attackObjective,
      businessUseCase: state.businessUseCase,
      judgeHint: state.judgeHint,
      agentDescription: state.agentDescription,
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
      `catalog.json (${r.status}). Run: node runners/extension/scripts/build-catalog.mjs`
    );
  state.catalog = await r.json();

  state.catalog.suites.push({
    id: "all-evaluators",
    name: "Custom Evaluators",
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
/**
 * Render the Paused screen. `ev` is the evaluator that was mid-flight;
 * `pausedRun` is the persisted snapshot (present when recovering on reopen),
 * used to report how far into the evaluator the run actually got.
 */
function renderPausedScreen(ev, pausedRun) {
  const turnsDone = Math.floor((pausedRun?.transcript?.length ?? 0) / 2);
  const evPos = Math.min(state.evIdx + 1, Math.max(state.queue.length, 1));
  const parts = [`evaluator ${evPos} of ${state.queue.length || 1}`];
  if (turnsDone > 0) parts.push(`${turnsDone} of ${state.maxTurns} turns done`);
  parts.push("saved");

  $("pausedSuite").textContent = state.suiteId || "—";
  $("pausedEvaluator").textContent = ev?.name || "—";
  $("pausedModel").textContent = state.model;
  $("pausedSub").textContent = parts.join(" · ");
  $("pausedElapsed").textContent = "—";
}

async function checkPausedRun() {
  const { opforPausedRun, opforPopupRun } = await chrome.storage.local.get([
    "opforPausedRun",
    "opforPopupRun",
  ]);
  if (!opforPausedRun?.plan?.inputSelector) return false;

  const evId = opforPausedRun.evaluatorId || opforPausedRun.evaluatorSnapshot?.id;
  const evName = opforPausedRun.evaluatorSnapshot?.name || evId || "—";
  const sev = normalizeSev(opforPausedRun.evaluatorSnapshot?.severity);

  // Restore the FULL parked queue when one was saved, so Resume continues the
  // rest of the suite — not just the single paused evaluator.
  if (state.queue.length === 0) {
    if (Array.isArray(opforPopupRun?.queue) && opforPopupRun.queue.length) {
      state.suiteId = opforPopupRun.suiteId || opforPausedRun.suiteId || state.suiteId;
      state.queue = opforPopupRun.queue;
      state.results = Array.isArray(opforPopupRun.results) ? opforPopupRun.results : [];
      state.maxTurns = opforPopupRun.maxTurns || state.maxTurns;
      state.runStartedAt = opforPopupRun.runStartedAt || state.runStartedAt;
      // Point at the paused evaluator when it's still in the queue.
      const idx = state.queue.findIndex((q) => q.id === evId);
      state.evIdx = idx >= 0 ? idx : Math.min(opforPopupRun.evIdx || 0, state.queue.length - 1);
    } else {
      state.suiteId = opforPausedRun.suiteId || state.suiteId;
      state.queue = [{ id: evId || "paused", name: evName, sev }];
      state.evIdx = 0;
      state.results = [];
    }
  }

  renderPausedScreen(state.queue[state.evIdx] || { name: evName }, opforPausedRun);
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

/**
 * Apply visual mode for the awaitUser screen.
 * @param {boolean} needsDesc - true = agent not detected (describe it), false = locate widget
 */
function applyAwaitUserMode(needsDesc) {
  const card = $("awaitUserCard");
  if (needsDesc) {
    card.dataset.mode = "detect";
    $("awaitUserTitle").textContent = "Agent not detected";
    $("awaitUserSub").textContent = "Not able to detect the agent — open the chat/agent and retry";
    $("awaitIconWarn").hidden = true;
    $("awaitIconScan").hidden = false;
  } else {
    card.dataset.mode = "locate";
    $("awaitUserTitle").textContent = "Action needed";
    $("awaitUserSub").textContent = "Open the chat widget, then retry";
    $("awaitIconWarn").hidden = false;
    $("awaitIconScan").hidden = true;
  }
}

function handleProgress(message) {
  if (state.screen !== "running" && state.screen !== "awaitUser") return;
  progressActive = true;
  // Only stop the cosmetic ticker when real turn data arrives — not on phase
  // events, which fire early (before attack generation completes).
  if (message.kind === "turn") stopCosmeticTicker();
  if (message.kind === "phase") {
    if (message.phase === "await_user") {
      applyAwaitUserMode(!!message.needsAgentDescription);
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
  const cancelled = state.results.filter((r) => r.verdict === "CANCELLED");
  const verdict =
    state.runCancelled || cancelled.length > 0
      ? "CANCELLED"
      : failed.length === 0 && state.results.length > 0
        ? "PASS"
        : "FAIL";

  const card = $("verdictCard");
  card.dataset.verdict = verdict;
  $("verdictText").textContent = verdict;

  // Verdict icon: check on PASS, stop-octagon on CANCELLED, shield on FAIL
  $("verdictIcon").innerHTML =
    verdict === "PASS"
      ? `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : verdict === "CANCELLED"
        ? `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

  $("verdictSummary").textContent =
    verdict === "CANCELLED"
      ? `Run cancelled by user after ${state.results.length - cancelled.length} of ${
          state.queue.length || state.results.length
        } evaluators completed (${passed.length} passed, ${failed.length} failed)${
          cancelled.length ? ", 1 stopped mid-evaluator" : ""
        }.`
      : verdict === "PASS"
        ? `Agent passed all ${state.results.length} evaluators in this suite. No vulnerabilities surfaced under the configured turn budget.`
        : `Agent failed ${failed.length} of ${state.results.length} evaluators. ${
            failed.length === 1 ? "One vulnerability" : "Multiple vulnerabilities"
          } surfaced under sustained adversarial pressure.`;

  $("statPassed").textContent = String(passed.length);
  $("statFailed").textContent = String(failed.length);
  $("statTotal").textContent = String(state.results.length);

  const tokenEl = $("statTokens");
  const tokenUsage = state.lastReport?.summary?.tokenUsage;
  if (tokenUsage && tokenUsage.totalTokens > 0) {
    $("statTokensValue").textContent = formatTokenCount(tokenUsage.totalTokens);
    $("statTokensSub").textContent =
      `${(tokenUsage.inputTokens ?? 0).toLocaleString()} in · ${(tokenUsage.outputTokens ?? 0).toLocaleString()} out`;
    tokenEl.style.display = "";
  } else {
    tokenEl.style.display = "none";
  }

  $("resultsCountLabel").textContent = `Evaluators · ${state.results.length}`;
  const list = $("resultsList");
  list.innerHTML = "";
  for (const r of state.results) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.dataset.verdict = r.verdict;
    const tu = r.raw?.tokenUsage;
    const tokenLabel = tu?.totalTokens ? formatTokenCount(tu.totalTokens) : "";
    row.innerHTML = `
      <div class="dot"></div>
      <span class="name"></span>
      ${tokenLabel ? `<span class="mono" style="font-size:11px;color:var(--muted-3);flex-shrink:0">${tokenLabel}</span>` : ""}
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
  // Cancelled evaluators were never judged — never show a fabricated
  // severity-based score for them, even if stray raw data has one.
  if (record.verdict === "CANCELLED") return null;
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

function standardsForEvaluatorId(evaluatorId) {
  const ev = state.catalog?.evaluators?.find((e) => e.id === evaluatorId);
  const s = ev?.standards;
  if (!s || typeof s !== "object" || Array.isArray(s)) return undefined;
  const entries = Object.entries(s).filter(
    ([k, v]) => typeof k === "string" && k.trim() && typeof v === "string" && v.trim()
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function formatStandardsLabel(standards) {
  if (!standards || !Object.keys(standards).length) return "";
  return Object.entries(standards)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

const SEVERITY_WEIGHTS = { critical: 4, high: 3, medium: 2, low: 1 };
function sevWeight(s) {
  return SEVERITY_WEIGHTS[severityFull(s)] ?? 2;
}

/**
 * Evaluators that actually produced a verdict.
 *
 * Reports persisted before the CANCELLED state existed carry no `judged`
 * field, and history stores whole reports that Download re-renders — so fall
 * back to the old totals rather than interpolating `undefined`. Uses `??` so a
 * legitimate `judged: 0` is preserved instead of falling through.
 */
function judgedCount(summary) {
  return Number(summary?.judged ?? summary?.totalEvaluators ?? summary?.totalTests ?? 0) || 0;
}

/**
 * Label for the report's "Evaluation Suite" field. A suite name is only
 * accurate when every one of its evaluators was actually selected — picking
 * a subset (or the catch-all "Custom Evaluators" bucket) is a hand-picked
 * list, not that suite, so it's labeled "Custom Suite" instead of borrowing
 * a name that would overstate what actually ran.
 */
function resolveSuiteLabel() {
  const suite = state.catalog?.suites?.find((s) => s.id === state.suiteId);
  if (!suite) return "Custom Suite";
  const fullSuite =
    suite.evaluatorIds.length === state.selectedEvaluators.size &&
    suite.evaluatorIds.every((id) => state.selectedEvaluators.has(id));
  return fullSuite ? suite.id : "Custom Suite";
}

function buildReport() {
  const total = state.results.length;
  const passed = state.results.filter((r) => r.verdict === "PASS").length;
  const failed = state.results.filter((r) => r.verdict === "FAIL").length;
  const cancelledCount = state.results.filter((r) => r.verdict === "CANCELLED").length;

  // Cancelled evaluators were never judged — exclude them from the weighted
  // totals entirely, not just from the numerator, or they silently dilute
  // the safety score (e.g. one real PASS + one cancelled reading as < 100%).
  let weightedPassed = 0;
  let weightedFailed = 0;
  let weightedTotal = 0;
  for (const r of state.results) {
    if (r.verdict === "CANCELLED") continue;
    const w = sevWeight(r.sev);
    weightedTotal += w;
    if (r.verdict === "PASS") weightedPassed += w;
    else if (r.verdict === "FAIL") weightedFailed += w;
  }
  // null, not 0, when nothing was judged (e.g. cancelled during the first
  // evaluator) — a red "0%" would read as "everything failed" rather than
  // "nothing was assessed".
  const safetyScore = weightedTotal ? Math.round((weightedPassed / weightedTotal) * 100) : null;
  const attackSuccessRate = weightedTotal
    ? Math.round((weightedFailed / weightedTotal) * 100)
    : null;
  const judgedTotal = passed + failed;

  const evaluatorResults = state.results.map((r) => {
    const score = scoreFor(r);
    const sev = severityFull(r.sev);
    const standards = standardsForEvaluatorId(r.id);
    return {
      id: r.id,
      name: r.name,
      standards,
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
          confidence:
            r.verdict === "CANCELLED"
              ? null
              : clamp(Math.round(Number(r.raw?.judgment?.confidence ?? 90)), 0, 100),
          evidence: evidenceFor(r),
          reasoning: r.summary || "—",
        },
      ],
      raw: r.raw,
    };
  });

  evaluatorResults.sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (b.avgScore ?? 0) - (a.avgScore ?? 0)
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

  let aggInput = 0;
  let aggOutput = 0;
  for (const r of state.results) {
    const tu = r.raw?.tokenUsage;
    if (tu) {
      aggInput += tu.inputTokens ?? 0;
      aggOutput += tu.outputTokens ?? 0;
    }
  }
  const tokenUsage =
    aggInput + aggOutput > 0
      ? { inputTokens: aggInput, outputTokens: aggOutput, totalTokens: aggInput + aggOutput }
      : undefined;

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const reportId = `opfor-${state.suiteId || "run"}-${stamp}`;

  const durationMs = state.runStartedAt ? Math.max(0, Date.now() - state.runStartedAt) : undefined;

  const targetUrl =
    state.results[0]?.raw?.siteUrl || state.results[0]?.raw?.frameUrl || "active tab";

  return {
    metadata: {
      reportId,
      configId: resolveSuiteLabel(),
      framework: "opfor v0.2",
      generated: now.toISOString(),
      duration: durationMs != null ? formatDurationMs(durationMs) : "—",
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
      judged: judgedTotal,
      passed,
      failed,
      cancelled: cancelledCount,
      safetyScore,
      attackSuccessRate,
      cleanRules: passed,
      evaluationsFailed: evalsWithFailures,
      criticalFindings: criticalFindings.length,
      highFindings: highFindings.length,
      tokenUsage,
      durationMs,
    },
    cancelled: state.runCancelled,
    evaluatorResults,
    criticalFindings,
    highFindings,
  };
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format a run duration for display (e.g. 754000 → "12m 34s"). */
function formatDurationMs(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Adapter: extension's buildReport() shape → core's shared ReportViewModel
//
// Renders through the same `renderReport` the CLI/MCP/SDK runners use, so the
// extension's downloaded HTML report looks identical to theirs instead of
// maintaining its own template.
// ---------------------------------------------------------------------------

/** Extract {user, assistant} turn pairs from a raw evaluator record's transcript/turns. */
function turnsForReport(raw) {
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
}

function toTurnViewModels(raw) {
  return turnsForReport(raw).map((t, i) => ({
    turnIndex: i + 1,
    detail: { kind: "prompt", prompt: t.user, response: t.assistant },
  }));
}

function toResultViewModel(tr, evaluator) {
  const cancelled = tr.verdict === "CANCELLED";
  return {
    id: evaluator.id + (tr.testNumber > 1 ? `-${tr.testNumber}` : ""),
    label: tr.pattern,
    judge: {
      verdict: cancelled ? "ERROR" : tr.verdict,
      score: tr.score ?? 0,
      confidence: tr.confidence ?? 0,
      evidence: tr.evidence ?? "",
      reasoning: cancelled
        ? "Run cancelled by user before this evaluator completed."
        : (tr.reasoning ?? ""),
      errorMessage: cancelled ? "Cancelled by user" : undefined,
    },
    detail: { kind: "prompt", prompt: "", response: "" },
    turns: toTurnViewModels(evaluator.raw),
  };
}

function toEvaluatorViewModel(e) {
  return {
    evaluatorId: e.id,
    evaluatorName: e.name,
    standards: e.standards,
    severity: e.severity,
    total: e.totalTests,
    passed: e.passed,
    failed: e.failed,
    errors: e.testResults[0]?.verdict === "CANCELLED" ? 1 : 0,
    passRate: e.passRate,
    results: e.testResults.map((tr) => toResultViewModel(tr, e)),
    tokenUsage: e.raw?.tokenUsage,
  };
}

function toReportViewModel(report) {
  const { metadata, target, summary } = report;
  return {
    mode: "agent",
    reportId: metadata.reportId,
    generatedAt: metadata.generated,
    generatorModel: target.model,
    judgeModel: metadata.llmJudge || target.model,
    target: {
      name: target.name,
      suiteId: metadata.configId,
      type: "LLM Chatbot Interface",
      accessMethod: "Browser automation (live tab)",
      maxTurns: state.maxTurns,
      waitBetweenTurnsSec: state.waitSec,
      messageLengthLimit: state.messageCharLimit,
    },
    summary: {
      total: summary.totalEvaluators,
      passed: summary.passed,
      failed: summary.failed,
      errors: summary.cancelled || 0,
      safetyScore: summary.safetyScore ?? 0,
      attackSuccessRate: summary.attackSuccessRate ?? 0,
      tokenUsage: summary.tokenUsage,
      durationMs: summary.durationMs,
    },
    evaluators: report.evaluatorResults.map(toEvaluatorViewModel),
    stopReason: report.cancelled ? "user-interrupted" : undefined,
    businessContext:
      report.applicationContext?.purpose && report.applicationContext.purpose !== "—"
        ? report.applicationContext.purpose
        : undefined,
  };
}

const REPORT_HISTORY_KEY = "opforReportHistory";
const LAST_SUITE_REPORT_KEY = "opforLastSuiteReport";
const MAX_HISTORY_ITEMS = 25;

function safeClone(obj) {
  // MV3 popup runs in modern Chromium; structuredClone is available in most environments.
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch {
      /* swallowed */
    }
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
    tokenUsage: raw.tokenUsage,
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
  } catch {
    /* swallowed */
  }
}

async function addReportToHistory(report) {
  if (!report?.metadata?.reportId) return;
  const verdict = report?.cancelled
    ? "CANCELLED"
    : report?.summary?.failed === 0 && report?.summary?.totalTests > 0
      ? "PASS"
      : "FAIL";
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
  } catch {
    /* swallowed */
  }
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
  const html = renderReport(toReportViewModel(report));
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
  } catch {
    /* swallowed */
  }

  // If state.results is empty (popup was reopened after run), recover from storage.
  if (!state.results.length) {
    try {
      const data = await chrome.storage.local.get(["opforLastResult", "opforLiveTranscript"]);
      const opforLastResult = data.opforLastResult;
      const liveTranscript = data.opforLiveTranscript;

      if (opforLastResult?.judgment) {
        const verdict =
          opforLastResult.stopReason === "user_stop"
            ? "CANCELLED"
            : String(opforLastResult.judgment.verdict || "FAIL").toUpperCase() === "PASS"
              ? "PASS"
              : "FAIL";
        const partialNote =
          opforLastResult.partial && verdict !== "CANCELLED" ? " (partial run)" : "";
        if (verdict === "CANCELLED") state.runCancelled = true;
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
        const wasCancelled = opforLastResult.stopReason === "user_stop";
        if (wasCancelled) state.runCancelled = true;
        state.results = [
          {
            id: opforLastResult.evaluatorId || "unknown",
            name: opforLastResult.evaluatorName || "Evaluator",
            sev: normalizeSev(opforLastResult.severity),
            verdict: wasCancelled ? "CANCELLED" : "FAIL",
            summary: wasCancelled
              ? `Cancelled by user after ${Math.floor(turnCount / 2)} turns.`
              : opforLastResult.errorMessage
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
        } catch {
          /* swallowed */
        }

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
    } catch {
      /* swallowed */
    }
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
    // Judged-only count, so a cancelled evaluator doesn't dilute "X/Y passed".
    const total = judgedCount(sum);
    const failed = Number(sum.failed ?? 0) || 0;
    const passed = Number(sum.passed ?? 0) || 0;
    const gen = item?.generated || report?.metadata?.generated || "";
    const allPassed = failed === 0 && total > 0;
    const isCancelled = Boolean(item?.verdict === "CANCELLED" || report?.cancelled);

    const wrap = document.createElement("div");
    wrap.className = "history-item";
    wrap.dataset.status = isCancelled ? "cancelled" : allPassed ? "pass" : "fail";

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
  // `paused` means "interrupted, resumable snapshot saved"; `cancelled` means
  // "interrupted, discarded". The background tags which one it was — never
  // infer it here.
  if (directResult?.paused || directResult?.cancelled) {
    stopCosmeticTicker();
    return {
      paused: !!directResult.paused,
      cancelled: !!directResult.cancelled,
      error: directResult.error,
    };
  }

  // Otherwise poll storage — the service worker persists results there.
  const result = await pollStorageForResult(ev.id);
  stopCosmeticTicker();

  if (result?.paused || result?.cancelled) {
    return { paused: !!result.paused, cancelled: !!result.cancelled, error: result.error };
  }
  if (!result?.ok) {
    const errMsg = result?.error || directResult?.error || "Unknown error";
    return { error: errMsg };
  }

  setPhase("judging");
  await new Promise((r) => setTimeout(r, 250));

  // A user-cancelled run is persisted with ok:true (it's a valid partial
  // result, not an error) — never coerce that into PASS/FAIL. Key off
  // stopReason, NOT `stopped`: a "recovered" partial is also flagged stopped
  // but WAS genuinely judged, and must keep its real verdict.
  const verdict =
    result.stopReason === "user_stop"
      ? "CANCELLED"
      : String(result.judgment?.verdict || "FAIL").toUpperCase() === "PASS"
        ? "PASS"
        : "FAIL";
  return {
    record: {
      id: ev.id,
      name: ev.name,
      sev: ev.sev,
      verdict,
      summary:
        result.judgment?.summary ||
        (verdict === "CANCELLED" ? "Cancelled by user before this evaluator could finish." : ""),
      raw: result,
    },
  };
}

/**
 * Does a persisted record belong to the evaluator we're waiting on?
 * Records written by a *previous* evaluator linger in storage, so anything
 * read out of it must be ownership-checked before being treated as this
 * evaluator's result. Records with no evaluatorId at all are accepted as a
 * last resort (older writes, and error records the background couldn't tag).
 */
function matchesEvaluator(record, evaluatorId) {
  if (!record) return false;
  if (!record.evaluatorId) return true;
  return record.evaluatorId === evaluatorId;
}

/**
 * True once the user has asked to stop or pause.
 *
 * Judging a partial transcript is an LLM call, and it must never run in that
 * case: a cancelled evaluator has no verdict to report, the call adds seconds
 * to a stop the user wants immediate, and `OPFOR_JUDGE_PARTIAL` overwrites
 * `opforLastResult` with `stopped: true` + real judge reasoning — which is how
 * a cancelled row ended up carrying a full PASS/FAIL-style rationale.
 */
function userInterrupted() {
  return state.cancelRequested || state.pauseRequested;
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

  // How long to keep waiting for the background's own stop/pause record after
  // the user interrupts. The service worker flips run status to not-running
  // the moment it receives the stop, well before the orchestrator has unwound
  // and written its record — without this grace the poller would race past it.
  const INTERRUPT_GRACE_MS = 12_000;
  let interruptedAt = 0;

  while (Date.now() - pollStart < ABS_MAX_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    if (userInterrupted() && !interruptedAt) interruptedAt = Date.now();

    let data;
    try {
      data = await chrome.storage.local.get([
        "opforLastResult",
        "opforLiveTranscript",
        "opforRunStatus",
        "opforPausedRun",
      ]);
    } catch {
      continue;
    }

    // 0. User interrupted: wait only for the background's own record, and
    //    never fall through to the partial-judge steps below.
    if (interruptedAt) {
      const rec = data.opforLastResult;
      if (rec && matchesEvaluator(rec, evaluatorId) && (rec.judgment || rec.stopReason)) return rec;
      // A pause writes no `opforLastResult` by design — the snapshot is the
      // only signal that it landed. Compare against `interruptedAt` so a
      // stale snapshot from an earlier pause can't resolve this one early.
      if (state.pauseRequested && Number(data.opforPausedRun?.savedAt) >= interruptedAt) {
        return { paused: true };
      }
      if (Date.now() - interruptedAt < INTERRUPT_GRACE_MS) continue;
      return { paused: state.pauseRequested, cancelled: state.cancelRequested };
    }

    // 1. Best case: completed result with judgment.
    //    Must belong to THIS evaluator — a previous evaluator's `completed`
    //    result left in storage would otherwise be returned immediately,
    //    making this evaluator appear to finish instantly with its verdict.
    const last = data.opforLastResult;
    if (last?.judgment && matchesEvaluator(last, evaluatorId)) return last;

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
        if (fresh.opforLastResult?.judgment && matchesEvaluator(fresh.opforLastResult, evaluatorId))
          return fresh.opforLastResult;
      } catch {
        /* swallowed */
      }
    }

    // 4. Completed result with judgment (re-check after settle)
    if (last?.judgment && matchesEvaluator(last, evaluatorId)) return last;

    // 5. Service worker returned an explicit error (ok: false, no judgment)
    if (last && last.ok === false && last.errorMessage && matchesEvaluator(last, evaluatorId)) {
      return { ok: false, error: last.errorMessage };
    }

    // 6. Live transcript available — ask service worker to judge it
    const live = data.opforLiveTranscript;
    if (
      !userInterrupted() &&
      live?.transcript?.length >= 2 &&
      matchesEvaluator(live, evaluatorId)
    ) {
      try {
        const judged = await chrome.runtime.sendMessage({
          type: "OPFOR_JUDGE_PARTIAL",
          transcript: live.transcript,
          evaluatorId: live.evaluatorId || evaluatorId,
          attackObjective: state.attackObjective || "",
          judgeHint: state.judgeHint || "",
        });
        if (judged?.ok && judged?.judgment) return judged;
      } catch {
        /* swallowed */
      }

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
    const finalLast = data.opforLastResult;
    if (finalLast?.judgment && matchesEvaluator(finalLast, evaluatorId)) return finalLast;
    if (finalLast?.errorMessage && matchesEvaluator(finalLast, evaluatorId))
      return { ok: false, error: finalLast.errorMessage };

    const live = data.opforLiveTranscript;
    if (
      !userInterrupted() &&
      live?.transcript?.length >= 2 &&
      matchesEvaluator(live, evaluatorId)
    ) {
      try {
        const judged = await chrome.runtime.sendMessage({
          type: "OPFOR_JUDGE_PARTIAL",
          transcript: live.transcript,
          evaluatorId: live.evaluatorId || evaluatorId,
          attackObjective: state.attackObjective || "",
          judgeHint: state.judgeHint || "",
        });
        if (judged?.ok && judged?.judgment) return judged;
      } catch {
        /* swallowed */
      }
    }
  } catch {
    /* swallowed */
  }

  return {
    ok: false,
    error: "Run did not produce a result. The service worker may have been interrupted.",
  };
}

async function startRun({ resume = false } = {}) {
  if (state.running) return;
  state.running = true;
  state.loopActive = true;
  state.cancelRequested = false;
  state.pauseRequested = false;
  state.runCancelled = false;
  state.lastReport = null;
  await saveModelAndKey();

  // Build queue from current selection (or use existing queue if resuming)
  if (!resume) {
    state.runStartedAt = Date.now();
    await saveSettings();
    const suite = state.catalog?.suites.find((s) => s.id === state.suiteId);
    if (!suite) {
      state.running = false;
      state.loopActive = false;
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
    } catch {
      /* swallowed */
    }
  }

  // Keep the service worker alive for the entire run duration.
  if (!state.keepAlivePort) {
    try {
      state.keepAlivePort = chrome.runtime.connect({ name: "opfor-keepalive" });
      state.keepAlivePort.onDisconnect.addListener(() => {
        state.keepAlivePort = null;
      });
    } catch {
      /* swallowed */
    }
  }

  // Capture the target tab once so subsequent evaluators don't fail
  // when chrome.tabs.query can't resolve the active tab mid-run.
  if (!state.targetTabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) state.targetTabId = tab.id;
    } catch {
      /* swallowed */
    }
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

    // The background reports ANY aborted turn as `paused: true` — it's the
    // same generic signal for a real Pause and a user Stop. Only route to
    // the resumable Paused screen when the user actually asked to pause;
    // a Stop always means cancel-and-report, even if out.paused is set.
    if (state.cancelRequested) {
      let cancelledRecord = out.record || null;
      if (!cancelledRecord) {
        let opforLastResult = null;
        try {
          ({ opforLastResult } = await chrome.storage.local.get("opforLastResult"));
        } catch {
          /* swallowed */
        }
        const matches = opforLastResult?.evaluatorId === ev.id;
        const j = matches ? opforLastResult.judgment : null;
        cancelledRecord = {
          id: ev.id,
          name: ev.name,
          sev: ev.sev,
          verdict: "CANCELLED",
          summary: j?.summary || "Cancelled by user before this evaluator could finish.",
          raw: matches ? opforLastResult : null,
        };
      }
      state.results.push(cancelledRecord);
      state.evIdx++;
      // A Stop always discards — never leave behind the resumable snapshot
      // the background persists for ANY aborted turn (it can't tell Stop
      // from Pause). Safe to do now: persistence happens before the
      // background replies, so runOneEvaluator() resolving here guarantees
      // it already wrote (or didn't write) whatever it was going to write.
      try {
        await chrome.runtime.sendMessage({ type: "OPFOR_UI_DISCARD_PAUSED" });
      } catch {
        /* swallowed */
      }
      break;
    }
    if (state.pauseRequested || out.paused) {
      state.running = false;
      state.loopActive = false;
      try {
        state.keepAlivePort?.disconnect();
      } catch {
        /* swallowed */
      }
      state.keepAlivePort = null;
      stopCosmeticTicker();
      // Keep the queue — parked, not cleared. Clearing it here is why resuming
      // used to drop every evaluator after the paused one: the popup could
      // only rebuild a single-evaluator queue from the paused snapshot.
      await persistPopupRunQueue({ running: false, paused: true });
      let pausedRun = null;
      try {
        ({ opforPausedRun: pausedRun } = await chrome.storage.local.get("opforPausedRun"));
      } catch {
        /* swallowed */
      }
      renderPausedScreen(ev, pausedRun);
      setScreen("paused");
      return;
    }
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
        } else if (!userInterrupted() && live?.transcript?.length >= 2) {
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
          } catch {
            /* swallowed */
          }
        }
      } catch {
        /* swallowed */
      }
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
      } catch {
        /* swallowed */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  state.running = false;
  state.loopActive = false;
  state.targetTabId = null;
  try {
    state.keepAlivePort?.disconnect();
  } catch {
    /* swallowed */
  }
  state.keepAlivePort = null;
  stopCosmeticTicker();
  stopRunStatusPoller();
  await clearPopupRunQueue();

  if (state.cancelRequested) {
    try {
      await chrome.runtime.sendMessage({ type: "OPFOR_UI_DISCARD_PAUSED" });
    } catch {
      /* swallowed */
    }
    if (state.results.length) {
      state.runCancelled = true;
      await finalizeAndPersistCurrentReport();
      renderDone();
      setScreen("done");
    } else {
      state.queue = [];
      state.results = [];
      state.evIdx = 0;
      setScreen("idle");
    }
    return;
  }

  await finalizeAndPersistCurrentReport();
  renderDone();
  setScreen("done");
}

async function requestPause() {
  if (!state.running) return;
  state.pauseRequested = true;
  setPauseBusy(true);
  stopRunStatusPoller();
  // Park the queue rather than clearing it — if the popup closes before the
  // loop reaches its pause branch, the rest of the suite must still survive.
  await persistPopupRunQueue({ running: false, paused: true });
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_STOP", intent: "pause" });
  } catch {
    /* swallowed */
  }

  // Same reasoning as requestStop(): the still-running startRun() loop's
  // in-flight runOneEvaluator() call will detect state.pauseRequested and
  // transition to the resumable Paused screen once it resolves.
  const phaseText = $("runPhaseText");
  if (phaseText) phaseText.textContent = "Pausing — finishing current evaluator…";
}

async function requestStop() {
  state.cancelRequested = true;
  state.pauseRequested = false;
  setStopBusy(true);
  // Only stop the poller when OUR OWN startRun() loop is driving this run —
  // it will handle the transition itself once its in-flight call resolves.
  // If the loop isn't ours (popup was reopened mid-run), the poller is the
  // only thing that will ever notice the background's stop; killing it here
  // would leave the run permanently stuck (see the loopActive check below).
  const ownedByLoop = state.loopActive;
  if (ownedByLoop) stopRunStatusPoller();
  await clearPopupRunQueue();
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_STOP", intent: "cancel" });
  } catch {
    /* swallowed */
  }

  // Give the user immediate feedback — the actual Cancelled report is
  // finalized by the still-running startRun() loop once its in-flight
  // runOneEvaluator() call resolves (guaranteed to happen: the background
  // persists the partial result before it replies). Racing ahead to read
  // storage here would only see it some of the time.
  if (ownedByLoop) {
    const phaseText = $("runPhaseText");
    if (phaseText) phaseText.textContent = "Stopping — finishing current evaluator…";
    return;
  }

  // The popup was reopened mid-run: `state.running` mirrors storage, but
  // there is no local loop to notice the stop. The run-status poller (left
  // running above) will detect the background's own terminal record and
  // finalize the report itself once it lands.
  if (state.running) {
    const phaseText = $("runPhaseText");
    if (phaseText) phaseText.textContent = "Stopping — finishing current evaluator…";
    return;
  }

  // Nothing in flight — e.g. Stop pressed from the Paused screen. Discard the
  // resumable snapshot and the parked queue, but still surface a report for
  // whatever already completed rather than silently throwing it away.
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_DISCARD_PAUSED" });
  } catch {
    /* swallowed */
  }
  await clearPopupRunQueue();
  stopCosmeticTicker();
  state.running = false;

  if (state.results.length) {
    state.runCancelled = true;
    await finalizeAndPersistCurrentReport();
    renderDone();
    setScreen("done");
    return;
  }

  state.queue = [];
  state.results = [];
  state.evIdx = 0;
  setScreen("idle");
}

async function discardPaused() {
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_DISCARD_PAUSED" });
  } catch {
    /* swallowed */
  }
  // Drop the parked queue too, or the next popup open would offer to resume
  // a run whose snapshot is already gone.
  await clearPopupRunQueue();
  state.queue = [];
  state.results = [];
  state.evIdx = 0;
  setScreen("idle");
}

async function cancelAwaitUser() {
  state.cancelRequested = true;
  state.pauseRequested = false;
  try {
    await chrome.runtime.sendMessage({ type: "OPFOR_UI_STOP", intent: "cancel" });
  } catch {
    /* swallowed */
  }

  // Same reasoning as requestStop(): the still-running startRun() loop's
  // in-flight runOneEvaluator() call will detect the cancellation and
  // finalize a Cancelled report once it resolves.
  if (state.running) {
    setScreen("running");
    const phaseText = $("runPhaseText");
    if (phaseText) phaseText.textContent = "Stopping — finishing current evaluator…";
    return;
  }

  stopCosmeticTicker();
  state.running = false;
  state.queue = [];
  state.results = [];
  state.evIdx = 0;
  setScreen("idle");
}

async function retryLocate() {
  // Reset awaitUser UI back to default state for the next cycle
  applyAwaitUserMode(false);
  setScreen("running");
  renderRunningHeader();
  renderRunStrip();
  setPhase("locating");
  // Show evaluator name while retrying
  const cur = state.queue[state.evIdx];
  if (cur) {
    $("runEvalName").textContent = cur.name;
  }
  $("runPhaseText").textContent = "Retrying…";
  try {
    await chrome.runtime.sendMessage({
      type: "OPFOR_UI_RETRY_LOCATE",
      agentDescription: state.agentDescription || "",
    });
  } catch {
    /* swallowed */
  }
  // Note: agentDescription is kept — it lives in Advanced settings and persists across retries.
}

function modelsForProvider(provider) {
  const list = MODELS_BY_PROVIDER[provider] || [];
  return list.map((m) => ({ value: m, label: m }));
}

function scrollDropdownIntoView(root) {
  requestAnimationFrame(() => {
    const menu = root?.querySelector(".dd-menu");
    if (!menu) return;
    const body = document.querySelector(".body");
    if (!body) return;
    const bodyRect = body.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const overflow = menuRect.bottom - bodyRect.bottom;
    if (overflow > 0) {
      body.scrollBy({ top: overflow + 8, behavior: "smooth" });
    }
  });
}

/** Placeholder for the API-key input. Kept short; the "optional" note is shown separately. */
function apiKeyPlaceholder(provider) {
  return provider === PROVIDERS.OPENAI_COMPATIBLE ? "Paste key (optional)" : "Paste key here";
}

function applyProvider({ resetModel = false } = {}) {
  const isCompatible = state.provider === PROVIDERS.OPENAI_COMPATIBLE;
  const needsBaseUrl = PROVIDERS_NEEDING_BASE_URL.has(state.provider);
  const isSimple = !!SIMPLE_PROVIDER_FETCH_CONFIG[state.provider];

  // Unified layout: every provider renders the same labeled rows
  // (Provider → Base URL → API Key → Model). Only the Base URL row and the
  // OpenAI-compatible affordances (optional-key note, model refresh) toggle.
  $("baseUrlField").style.display = needsBaseUrl ? "" : "none";
  $("apiKeyHint").style.display = isCompatible ? "inline-flex" : "none";
  $("apiKeyOptional").style.display = isCompatible ? "" : "none";
  $("refreshModelsBtn").style.display = isCompatible ? "" : "none";
  $("apiKey").placeholder = apiKeyPlaceholder(state.provider);

  setModelHint("");

  if (isCompatible) {
    // Models come from the user's own endpoint — cleared here, then fetched once
    // a Base URL (and optional key) is entered or the model dropdown is opened.
    if (resetModel) resetCompatModels();
  } else if (isSimple) {
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
    // Azure — static model list.
    const models = modelsForProvider(state.provider);
    modelDD?.setOptions(models);
    if (resetModel) {
      const defaultModel = PROVIDER_DEFAULT_MODELS[state.provider] || "";
      state.model = defaultModel;
      modelDD?.setValue(defaultModel);
    }
  }
}

async function fetchModelsFromBaseUrl(reopen = false) {
  const baseUrl = state.baseUrl?.trim().replace(/\/$/, "");
  if (!baseUrl) {
    setModelHint("Enter a Base URL first.");
    return;
  }
  _compatModelsLoaded = false;
  modelDD?.setLoading(true);
  setModelHint("");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "OPFOR_FETCH_MODELS",
      baseUrl,
      apiKey: state.apiKey || "",
    });
    if (!result?.ok) throw new Error(result?.error || "Unknown error.");
    const json = result.json || {};
    const ids = (json.data ?? json.models ?? []).map((m) => m.id ?? m).filter(Boolean);
    if (!ids.length) throw new Error("No models returned by the server.");
    const options = ids.map((id) => ({ value: id, label: id }));
    modelDD?.setLoading(false);
    modelDD?.setOptions(options);
    const keep = ids.includes(state.model) ? state.model : ids[0];
    state.model = keep;
    modelDD?.setValue(keep);
    saveModelAndKey();
    updateRunButton();
    _compatModelsLoaded = true;
    setModelHint(`${ids.length} model${ids.length > 1 ? "s" : ""} loaded.`, "ok");
    if (reopen) modelDD?.open();
  } catch (e) {
    modelDD?.setLoading(false);
    modelDD?.setOptions([]);
    _compatModelsLoaded = false;
    setModelHint(e.message || "Could not reach the server — check the Base URL.", "error");
  }
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

  _compatModelsLoaded = false;
  modelDD?.setLoading(true);
  setModelHint("");
  try {
    // Proxy through the service worker to avoid popup-page CORS restrictions.
    const result = await chrome.runtime.sendMessage({
      type: "OPFOR_FETCH_MODELS",
      url: cfg.url(key),
      headers: cfg.headers(key),
      apiKey: key,
    });
    if (!result?.ok) throw new Error(result?.error || "Unknown error.");
    const ids = cfg.parse(result.json || {});
    if (!ids.length) throw new Error("No models returned.");

    const opts = ids.map((id) => ({ value: id, label: id }));
    modelDD?.setLoading(false);
    modelDD?.setOptions(opts);
    const keep = ids.includes(state.model) ? state.model : ids[0];
    state.model = keep;
    modelDD?.setValue(keep);
    saveModelAndKey();
    updateRunButton();
    _compatModelsLoaded = true;
    setModelHint("");
  } catch (e) {
    modelDD?.setLoading(false);
    modelDD?.setOptions([]);
    setModelHint(
      e.message || `Could not reach ${state.provider} — check your connection.`,
      "error"
    );
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
    _compatModelsLoaded = false;
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
      updateRunButton();
    },
    {
      inlineSearch: true,
      onOpen: () => {
        if (SIMPLE_PROVIDER_FETCH_CONFIG[state.provider]) {
          if (state.apiKey.trim() && !_compatModelsLoaded) fetchModelsForSimpleProvider();
        } else if (state.provider === PROVIDERS.OPENAI_COMPATIBLE) {
          if (!state.baseUrl.trim()) {
            setModelHint("Enter a Base URL first.");
          } else if (!_compatModelsLoaded) {
            // Fetch models and reopen the dropdown automatically when done
            fetchModelsFromBaseUrl(true);
          }
        }
      },
    }
  );

  // Evals collapse
  $("evalsHead").addEventListener("click", () => {
    const evs = $("evals");
    const opening = evs.dataset.open !== "true";
    evs.dataset.open = opening ? "true" : "false";
    if (opening) {
      // Re-apply search filter when opening
      applyEvalsSearchFilter();
      requestAnimationFrame(() => {
        const list = $("evalsList");
        const body = document.querySelector(".body");
        if (!list || !body) return;
        const overflow = list.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom;
        if (overflow > 0) body.scrollBy({ top: overflow + 8, behavior: "smooth" });
      });
    }
  });
  document.addEventListener("mousedown", (e) => {
    const evs = $("evals");
    if (evs?.dataset.open === "true" && !evs.contains(e.target)) {
      evs.dataset.open = "false";
    }
  });

  // Evaluators search
  function applyEvalsSearchFilter() {
    const query = ($("evalsSearch")?.value || "").toLowerCase().trim();
    const items = $("evalsList").querySelectorAll(".eval-item");
    items.forEach((item) => {
      const name = item.querySelector(".eval-name")?.textContent?.toLowerCase() || "";
      const desc = item.querySelector(".eval-desc")?.textContent?.toLowerCase() || "";
      const matches = !query || name.includes(query) || desc.includes(query);
      item.dataset.hidden = matches ? "false" : "true";
    });
  }

  $("evalsSearch").addEventListener("input", applyEvalsSearchFilter);

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

  // Refresh models (OpenAI-compatible)
  $("refreshModelsBtn").addEventListener("click", () => fetchModelsFromBaseUrl());

  // Base URL (Azure + OpenAI-compatible)
  $("baseUrl").addEventListener("input", (e) => {
    state.baseUrl = e.target.value;
    saveModelAndKey();
    if (state.provider === PROVIDERS.OPENAI_COMPATIBLE) {
      resetCompatModels();
    }
  });

  // API key (single field, shared by every provider)
  $("apiKey").addEventListener("input", (e) => {
    state.apiKey = e.target.value;
    saveModelAndKey();
    updateRunButton();
    setModelHint("");
    _compatModelsLoaded = false;
    // Reset loaded models when the key changes so the next open re-fetches.
    if (state.provider === PROVIDERS.OPENAI_COMPATIBLE) resetCompatModels();
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

  // Buttons
  $("runBtn").addEventListener("click", () => startRun({ resume: false }));
  $("pauseBtn").addEventListener("click", requestPause);
  $("stopBtn").addEventListener("click", requestStop);
  $("resumeBtn").addEventListener("click", () => startRun({ resume: true }));
  $("discardPausedBtn").addEventListener("click", discardPaused);
  $("pausedStopBtn").addEventListener("click", requestStop);
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
  bindStepper("maxTurns", "maxTurnsValue", "maxTurns", 1, 50);
  bindStepper("waitSec", "waitSecValue", "waitSec", 3, 30);
  bindStepper("messageCharLimit", "messageCharLimitValue", "messageCharLimit", 100, 1500);

  // Advanced text fields
  $("agentDescription").addEventListener("input", (e) => {
    state.agentDescription = e.target.value;
    saveSettings();
  });
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
async function persistPopupRunQueue({ running = true, paused = false } = {}) {
  try {
    await chrome.storage.local.set({
      opforPopupRun: {
        running,
        paused,
        suiteId: state.suiteId,
        queue: state.queue,
        evIdx: state.evIdx,
        results: state.results,
        maxTurns: state.maxTurns,
        runStartedAt: state.runStartedAt,
        updatedAt: Date.now(),
      },
    });
  } catch {
    /* swallowed */
  }
}

async function clearPopupRunQueue() {
  try {
    await chrome.storage.local.remove("opforPopupRun");
  } catch {
    /* swallowed */
  }
}

/**
 * Most recent completed round, given a run status record and the round
 * derived by walking its stored transcript.
 *
 * The derived value alone undercounts a resumed run: the stored transcript is
 * capped at the most recent entries, so a run resumed past that cap restarts
 * its counter. Take the highest of everything the background reports instead.
 */
function resolveLastRound(runStatus, derivedRound) {
  return Math.max(
    Number(runStatus?.lastRound) || 0,
    Number(runStatus?.resumedFromRound) || 0,
    Number(derivedRound) || 0
  );
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

  // If storage says await_user, verify the service worker is actually alive and
  // waiting. If it isn't (run already timed out / crashed / was from a prior
  // session), clear the stale status and show idle instead.
  if (opforRunStatus?.phase === "await_user") {
    try {
      const check = await chrome.runtime.sendMessage({ type: "OPFOR_CHECK_ACTIVE" });
      if (!check?.alive) {
        await chrome.storage.local.set({
          opforRunStatus: { v: 1, running: false, updatedAt: Date.now() },
        });
        return false;
      }
    } catch {
      // Service worker not responding — definitely stale.
      await chrome.storage.local.set({
        opforRunStatus: { v: 1, running: false, updatedAt: Date.now() },
      });
      return false;
    }
  }

  if (popupQueueActive) {
    state.suiteId = opforPopupRun.suiteId || state.suiteId;
    state.maxTurns = opforPopupRun.maxTurns || state.maxTurns;
    state.queue = Array.isArray(opforPopupRun.queue) ? opforPopupRun.queue : [];
    state.evIdx = opforPopupRun.evIdx || 0;
    state.runStartedAt = opforPopupRun.runStartedAt || state.runStartedAt;
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
    applyAwaitUserMode(!!opforRunStatus?.needsAgentDescription);
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
    const round = resolveLastRound(opforRunStatus, lastRound);
    latestTurn = { round, user: lastUser, assistant: lastAssistant };
    renderBubbles();
    setTurnProgress(round);
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
        applyAwaitUserMode(!!opforRunStatus.needsAgentDescription);
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
      // If a real startRun() loop owns this run (state.loopActive), it's
      // already handling the transition to the next evaluator or the final
      // Done screen — don't preempt it. If there is no such loop (the popup
      // was reopened mid-run, or the owning popup instance closed), this is
      // the only thing left that will ever notice the run ended, so finalize
      // it here.
      if (!opforRunStatus.running) {
        if (state.loopActive) return;
        stopRunStatusPoller();
        stopCosmeticTicker();
        const hasPaused = await checkPausedRun();
        if (!hasPaused) {
          const { opforLastResult } = await chrome.storage.local.get("opforLastResult");
          const cur = state.queue[state.evIdx] || state.queue[0];
          if (opforLastResult && matchesEvaluator(opforLastResult, cur?.id)) {
            const verdict =
              opforLastResult.stopReason === "user_stop"
                ? "CANCELLED"
                : opforLastResult.judgment
                  ? String(opforLastResult.judgment.verdict || "FAIL").toUpperCase() === "PASS"
                    ? "PASS"
                    : "FAIL"
                  : null;
            // `null` means the evaluator neither completed nor was cancelled
            // (e.g. a bare error record) — nothing to add to the report.
            if (verdict) {
              state.results.push({
                id: opforLastResult.evaluatorId || cur?.id || "",
                name: opforLastResult.evaluatorName || cur?.name || "",
                sev: cur?.sev || "low",
                verdict,
                summary:
                  opforLastResult.judgment?.summary ||
                  (verdict === "CANCELLED"
                    ? "Cancelled by user before this evaluator could finish."
                    : ""),
                raw: opforLastResult,
              });
              state.evIdx++;
            }
          }
          state.running = false;
          await clearPopupRunQueue();
          if (state.results.length) {
            // No loop is left to run whatever's still queued — the suite
            // ends here, same as a user-initiated stop.
            if (state.evIdx < state.queue.length) state.runCancelled = true;
            await finalizeAndPersistCurrentReport();
            renderDone();
            setScreen("done");
          } else {
            state.queue = [];
            state.evIdx = 0;
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
        const round = resolveLastRound(opforRunStatus, lastRound);
        if (
          round !== latestTurn.round ||
          lastUser !== latestTurn.user ||
          lastAssistant !== latestTurn.assistant
        ) {
          latestTurn = { round, user: lastUser, assistant: lastAssistant };
          renderBubbles();
          setTurnProgress(round);
        }
      }
    } catch {
      /* swallowed */
    }
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
  applyProvider();
  updateRunButton();
  // Auto-fetch models on mount if we already have what we need
  if (state.provider === PROVIDERS.OPENAI_COMPATIBLE && state.baseUrl.trim()) {
    fetchModelsFromBaseUrl(); // apiKey is optional for local servers
  } else if (SIMPLE_PROVIDER_FETCH_CONFIG[state.provider] && state.apiKey.trim()) {
    fetchModelsForSimpleProvider();
  }
  $("agentDescription").value = state.agentDescription;
  $("attackObjective").value = state.attackObjective;
  $("businessUseCase").value = state.businessUseCase;
  $("judgeHint").value = state.judgeHint;
  $("maxTurns").value = String(state.maxTurns);
  $("maxTurnsValue").textContent = String(state.maxTurns);
  $("waitSec").value = String(state.waitSec);
  $("waitSecValue").textContent = String(state.waitSec);
  $("messageCharLimit").value = String(state.messageCharLimit);
  $("messageCharLimitValue").textContent = String(state.messageCharLimit);

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
