const statusEl = document.getElementById("status");
const providerEl = document.getElementById("provider");
const attackerBaseUrlEl = document.getElementById("attackerBaseUrl");
const attackerModelEl = document.getElementById("attackerModel");
const attackerApiKeyEl = document.getElementById("attackerApiKey");
const attackerEnabledEl = document.getElementById("attackerEnabled");

const judgeBaseUrlEl = document.getElementById("judgeBaseUrl");
const judgeModelEl = document.getElementById("judgeModel");
const judgeApiKeyEl = document.getElementById("judgeApiKey");
const judgeEnabledEl = document.getElementById("judgeEnabled");

const readerBaseUrlEl = document.getElementById("readerBaseUrl");
const readerModelEl = document.getElementById("readerModel");
const readerApiKeyEl = document.getElementById("readerApiKey");
const readerEnabledEl = document.getElementById("readerEnabled");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");

function setStatus(text) {
  statusEl.textContent = text;
}

function normalizeProfile(p, fallback = {}) {
  const baseUrl = (p.baseUrl || fallback.baseUrl || "https://api.openai.com/v1").trim();
  const model = (p.model || fallback.model || "gpt-4o-mini").trim();
  const apiKey = (p.apiKey || fallback.apiKey || "").trim();
  const enabled = Boolean(p.enabled ?? fallback.enabled ?? false);
  return { baseUrl, model, apiKey, enabled };
}

async function load() {
  const { astraLlmProfiles, astraAiFallback } = await chrome.storage.local.get([
    "astraLlmProfiles",
    "astraAiFallback"
  ]);
  const legacy = astraAiFallback || {};
  const profiles = astraLlmProfiles && typeof astraLlmProfiles === "object" ? astraLlmProfiles : null;

  providerEl.value = profiles?.provider || legacy.provider || "openai_compat";

  const attacker = normalizeProfile(profiles?.attacker || {}, legacy);
  const judge = normalizeProfile(profiles?.judge || {}, legacy);
  const reader = normalizeProfile(profiles?.reader || {}, legacy);

  attackerBaseUrlEl.value = attacker.baseUrl;
  attackerModelEl.value = attacker.model;
  attackerApiKeyEl.value = attacker.apiKey;
  attackerEnabledEl.value = String(attacker.enabled);

  judgeBaseUrlEl.value = judge.baseUrl;
  judgeModelEl.value = judge.model;
  judgeApiKeyEl.value = judge.apiKey;
  judgeEnabledEl.value = String(judge.enabled);

  readerBaseUrlEl.value = reader.baseUrl;
  readerModelEl.value = reader.model;
  readerApiKeyEl.value = reader.apiKey;
  readerEnabledEl.value = String(reader.enabled);
}

saveBtn.addEventListener("click", async () => {
  const profiles = {
    v: 1,
    provider: providerEl.value,
    attacker: {
      baseUrl: attackerBaseUrlEl.value.trim() || "https://api.openai.com/v1",
      model: attackerModelEl.value.trim() || "gpt-4o-mini",
      apiKey: attackerApiKeyEl.value.trim(),
      enabled: attackerEnabledEl.value === "true"
    },
    judge: {
      baseUrl: judgeBaseUrlEl.value.trim() || "https://api.openai.com/v1",
      model: judgeModelEl.value.trim() || "gpt-4o-mini",
      apiKey: judgeApiKeyEl.value.trim(),
      enabled: judgeEnabledEl.value === "true"
    },
    reader: {
      baseUrl: readerBaseUrlEl.value.trim() || "https://api.openai.com/v1",
      model: readerModelEl.value.trim() || "gpt-4o-mini",
      apiKey: readerApiKeyEl.value.trim(),
      enabled: readerEnabledEl.value === "true"
    }
  };

  await chrome.storage.local.set({ astraLlmProfiles: profiles });
  setStatus("Saved.");
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("astraLlmProfiles");
  await load();
  setStatus("Cleared.");
});

load().catch((err) => setStatus(err instanceof Error ? err.message : String(err)));

