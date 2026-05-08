const statusEl = document.getElementById("status");
const providerEl = document.getElementById("provider");
const baseUrlEl = document.getElementById("baseUrl");
const modelEl = document.getElementById("model");
const apiKeyEl = document.getElementById("apiKey");
const enabledEl = document.getElementById("enabled");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");

function setStatus(text) {
  statusEl.textContent = text;
}

async function load() {
  const { astraAiFallback } = await chrome.storage.local.get("astraAiFallback");
  const cfg = astraAiFallback || {};

  providerEl.value = cfg.provider || "openai_compat";
  baseUrlEl.value = cfg.baseUrl || "https://api.openai.com/v1";
  modelEl.value = cfg.model || "gpt-4o-mini";
  apiKeyEl.value = cfg.apiKey || "";
  enabledEl.value = String(cfg.enabled ?? false);
}

saveBtn.addEventListener("click", async () => {
  const cfg = {
    provider: providerEl.value,
    baseUrl: baseUrlEl.value.trim() || "https://api.openai.com/v1",
    model: modelEl.value.trim() || "gpt-4o-mini",
    apiKey: apiKeyEl.value.trim(),
    enabled: enabledEl.value === "true"
  };

  await chrome.storage.local.set({ astraAiFallback: cfg });
  setStatus("Saved.");
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("astraAiFallback");
  await load();
  setStatus("Cleared.");
});

load().catch((err) => setStatus(err instanceof Error ? err.message : String(err)));

