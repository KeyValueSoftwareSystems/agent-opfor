const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const maxRoundsEl = document.getElementById("maxRounds");
const waitSecEl = document.getElementById("waitSec");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const resumeBanner = document.getElementById("resumeBanner");
const resumeDetail = document.getElementById("resumeDetail");
const resumeBtn = document.getElementById("resumeBtn");
const discardPausedBtn = document.getElementById("discardPausedBtn");
const suiteSelect = document.getElementById("suiteSelect");
const evaluatorSelect = document.getElementById("evaluatorSelect");

/** @type {{ suites: { id: string; name: string; evaluatorIds: string[] }[]; evaluators: { id: string; name: string }[] } | null} */
let catalog = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function setResults(text) {
  resultsEl.textContent = text;
}

let RUNNING = false;

function setUiEnabled(enabled) {
  runBtn.disabled = !enabled;
  stopBtn.disabled = enabled;
  maxRoundsEl.disabled = !enabled;
  waitSecEl.disabled = !enabled;
  resumeBtn.disabled = !enabled;
  discardPausedBtn.disabled = !enabled;
  suiteSelect.disabled = !enabled;
  evaluatorSelect.disabled = !enabled;
}

function evaluatorLabel(ev) {
  return `${ev.name} (${ev.id})`;
}

function fillEvaluatorOptions(suiteId) {
  evaluatorSelect.innerHTML = "";
  if (!catalog || !suiteId) return;
  const suite = catalog.suites.find((s) => s.id === suiteId);
  if (!suite) return;
  const byId = new Map(catalog.evaluators.map((e) => [e.id, e]));
  for (const id of suite.evaluatorIds) {
    const ev = byId.get(id);
    if (!ev) continue;
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = evaluatorLabel(ev);
    evaluatorSelect.appendChild(opt);
  }
}

async function loadCatalog() {
  const url = chrome.runtime.getURL("catalog.json");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`catalog.json (${r.status}). Run: node src/extension/scripts/build-catalog.mjs`);
  catalog = await r.json();
  suiteSelect.innerHTML = "";
  for (const s of catalog.suites) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.id})`;
    suiteSelect.appendChild(opt);
  }
  const firstSuite = catalog.suites[0]?.id || "";
  suiteSelect.value = firstSuite;
  fillEvaluatorOptions(firstSuite);
}

suiteSelect.addEventListener("change", () => {
  fillEvaluatorOptions(suiteSelect.value);
});

async function refreshPausedBanner() {
  const { astraPausedRun } = await chrome.storage.local.get("astraPausedRun");
  if (astraPausedRun?.plan?.inputSelector) {
    resumeBanner.style.display = "block";
    const ev = astraPausedRun.evaluatorSnapshot;
    const parts = [];
    if (astraPausedRun.suiteId) parts.push(`Suite: ${astraPausedRun.suiteId}`);
    if (ev?.name) parts.push(`Evaluator: ${ev.name}`);
    resumeDetail.textContent = parts.join(" · ") || "";
  } else {
    resumeBanner.style.display = "none";
    resumeDetail.textContent = "";
  }
}

/** Closing the popup stops the background run (aborts wait + in-flight LLM). */
window.addEventListener("pagehide", () => {
  chrome.runtime.sendMessage({ type: "ASTRA_UI_STOP" }).catch(() => {});
});

async function runAdaptiveFlow(resume) {
  const maxRounds = Math.max(1, Math.min(20, Number(maxRoundsEl.value || 10)));
  const waitSec = Math.max(3, Math.min(30, Number(waitSecEl.value || 10)));

  if (
    !resume &&
    (!suiteSelect.value || !evaluatorSelect.value || evaluatorSelect.options.length === 0)
  ) {
    setStatus("Select a suite and evaluator.");
    return;
  }

  RUNNING = true;
  setUiEnabled(false);
  setResults("");
  setStatus(resume ? "Resuming paused session…" : "Running adaptive conversation…");

  try {
    const payload = resume
      ? { type: "ASTRA_UI_RESUME" }
      : {
          type: "ASTRA_UI_RUN",
          suiteId: suiteSelect.value,
          evaluatorId: evaluatorSelect.value,
          maxRounds,
          waitMs: waitSec * 1000
        };

    const result = await chrome.runtime.sendMessage(payload);

    await refreshPausedBanner();

    if (!result?.ok) {
      if (result?.paused) {
        setStatus(`⏸ Paused.\n${result?.error || "Stopped."}\nReopen the popup to continue or discard.`);
      } else {
        setStatus(`⚠️ Run failed.\n${result?.error || "Unknown error"}`);
      }
      if (result?.debug) setResults(JSON.stringify(result.debug, null, 2));
      return;
    }

    const j = result.judgment || {};
    const evLine =
      result.evaluatorName && result.evaluatorId ? `\nEvaluator: ${result.evaluatorName} (${result.evaluatorId})` : "";
    setStatus(
      `✅ Done.\nSite: ${result.siteUrl}${evLine}\nRounds: ${result.turns?.length ?? 0}\nVerdict: ${j.verdict ?? "?"}\n\n${j.summary ?? ""}`
    );
    setResults(JSON.stringify(result, null, 2));
  } catch (err) {
    setStatus(`⚠️ Error.\n${err instanceof Error ? err.message : String(err)}`);
  } finally {
    RUNNING = false;
    setUiEnabled(true);
    await refreshPausedBanner();
  }
}

stopBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "ASTRA_UI_STOP" });
  setStatus("Stopping…");
});

runBtn.addEventListener("click", () => {
  if (RUNNING) return;
  runAdaptiveFlow(false);
});

resumeBtn.addEventListener("click", () => {
  if (RUNNING) return;
  runAdaptiveFlow(true);
});

discardPausedBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "ASTRA_UI_DISCARD_PAUSED" });
  await refreshPausedBanner();
  setStatus("Paused session discarded.");
});

setUiEnabled(true);
setStatus("Loading catalog…");
loadCatalog()
  .then(() => {
    setStatus("Ready.");
    refreshPausedBanner();
  })
  .catch((e) => {
    setStatus(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
  });
