import { state, triggerRetryLocate } from "./state.js";
import { getLlmProfile, assertLlmCfg } from "./config.js";
import { loadAttackCatalog } from "./catalog.js";
import { clearRunStatus } from "./storage.js";
import {
  judgeResponse,
  createModel,
  setEnvProvider,
  PROVIDER_ENV_VARS,
} from "./dist/core.bundle.js";
import { resetChatSession, executeAdaptiveRedTeamRun } from "./orchestrator.js";
import { persistPartialResult } from "./storage.js";

async function configureSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Older builds or non-Chromium browsers — ignore.
  }

  // Prefer right-side docking (MetaMask-style). Ignored on Chrome versions that
  // only support global Settings → Appearance → Side panel position.
  if (chrome.sidePanel?.setOptions) {
    try {
      await chrome.sidePanel.setOptions({
        path: "sidepanel.html",
        enabled: true,
        side: "right",
      });
    } catch {
      try {
        await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
      } catch {
        // ignore
      }
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel();
});
chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
});
configureSidePanel();

function buildModelFromProfile(profile) {
  const envVar = PROVIDER_ENV_VARS[profile.provider] ?? "OPFOR_API_KEY";
  setEnvProvider((name) => (name === envVar ? profile.apiKey : undefined));
  return createModel({
    provider: profile.provider,
    model: profile.model,
    apiKeyEnv: envVar,
    baseURL: profile.baseUrl || undefined,
  });
}

function adaptJudgeResult(coreResult) {
  return {
    verdict: coreResult.verdict === "ERROR" ? "UNKNOWN" : coreResult.verdict,
    summary: coreResult.reasoning,
    findings: coreResult.evidence ? [{ text: coreResult.evidence }] : [],
    confidence: coreResult.confidence,
    score: coreResult.score,
  };
}

// ── Main message handler ─────────────────────────────────────────────────────
function handleMainMessages(message, sendResponse) {
  if (message?.type === "OPFOR_UI_STOP") {
    state.OPFOR_STOP = true;
    try {
      state.uiRunAbortController?.abort();
    } catch {}
    triggerRetryLocate();
    clearRunStatus().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "OPFOR_UI_RETRY_LOCATE") {
    // If there's an active retry waiter, trigger it (pass any agentDescription the user provided)
    if (state.retryLocateResolver) {
      triggerRetryLocate({ agentDescription: message.agentDescription || "" });
      sendResponse({ ok: true });
      return true;
    }

    // Otherwise, service worker may have restarted - restart the run from storage
    (async () => {
      try {
        const { opforRunStatus } = await chrome.storage.local.get("opforRunStatus");
        if (!opforRunStatus?.running || opforRunStatus?.phase !== "await_user") {
          sendResponse({ ok: false, error: "No active await_user state to retry" });
          return;
        }

        // Restart the run with stored parameters, merging any manual description the user provided
        const restartMessage = {
          type: "OPFOR_UI_RUN",
          suiteId: opforRunStatus.suiteId,
          evaluatorId: opforRunStatus.evaluatorId,
          maxRounds: opforRunStatus.maxRounds,
          waitMs: 10000,
          scrapeFromSite: opforRunStatus.scrapeFromSite !== false,
          agentDescription: message.agentDescription || opforRunStatus.agentDescription || "",
          attackObjective: opforRunStatus.attackObjective || "",
          businessUseCase: opforRunStatus.businessUseCase || "",
          judgeHint: opforRunStatus.judgeHint || "",
        };

        await executeAdaptiveRedTeamRun(sendResponse, restartMessage, false);
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (message?.type === "OPFOR_UI_DISCARD_PAUSED") {
    chrome.storage.local.remove("opforPausedRun", () => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "OPFOR_UI_RESUME") {
    (async () => {
      await executeAdaptiveRedTeamRun(sendResponse, message, true);
    })();
    return true;
  }

  if (message?.type === "OPFOR_RESET_CHAT") {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tab?.id;
        }
        if (!tabId) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        const cfg = await getLlmProfile("reader");
        assertLlmCfg(cfg, { kind: "HTML reader" });
        const result = await resetChatSession(tabId, cfg);
        sendResponse({ ok: result.ok });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (message?.type === "OPFOR_JUDGE_PARTIAL") {
    (async () => {
      try {
        const judgeCfg = await getLlmProfile("judge");
        assertLlmCfg(judgeCfg, { kind: "Judge" });
        const {
          transcript,
          evaluatorId,
          attackObjective: aoPartial,
          judgeHint: jhPartial,
        } = message;
        if (!transcript?.length || transcript.length < 2) {
          sendResponse({ ok: false, error: "Transcript too short to judge" });
          return;
        }
        const catalog = await loadAttackCatalog();
        const evaluatorSnapshot = catalog.evaluators?.find((e) => e.id === evaluatorId) || {
          id: evaluatorId || "unknown",
          name: "Unknown Evaluator",
          passCriteria: "",
          failCriteria: "",
        };
        const judgeModel = buildModelFromProfile(judgeCfg);
        const lastUser = [...transcript].reverse().find((t) => t.role === "user")?.content || "";
        const lastAssistant =
          [...transcript].reverse().find((t) => t.role === "assistant")?.content || "";
        const combinedHint = [aoPartial ? `Attack objective: ${aoPartial}` : "", jhPartial || ""]
          .filter(Boolean)
          .join("\n");
        const judgment = adaptJudgeResult(
          await judgeResponse(
            evaluatorSnapshot,
            lastUser,
            lastAssistant,
            judgeModel,
            undefined,
            transcript,
            {
              patternName: evaluatorSnapshot?.name,
              judgeHint: combinedHint || undefined,
            }
          )
        );
        const result = {
          ok: true,
          completed: false,
          partial: true,
          stopped: true,
          stopReason: "recovered",
          evaluatorId,
          evaluatorName: evaluatorSnapshot.name,
          severity: evaluatorSnapshot.severity,
          transcript,
          judgment,
        };
        await persistPartialResult(result);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }

  // Check whether the service worker has a live run (waiting for retry or running).
  if (message?.type === "OPFOR_CHECK_ACTIVE") {
    const alive =
      !!state.retryLocateResolver || (!state.OPFOR_STOP && !!state.uiRunAbortController);
    sendResponse({ alive });
    return true;
  }

  // Proxy model-list fetches through the service worker so popup pages don't
  // hit browser CORS / Private Network Access restrictions.
  if (message?.type === "OPFOR_FETCH_MODELS") {
    (async () => {
      try {
        // Two modes:
        //  • { baseUrl, apiKey } — OpenAI-compatible: fetches <baseUrl>/models with Bearer auth
        //  • { url, headers }    — Provider-specific: fetches the given url directly
        let fetchUrl, fetchHeaders;
        if (message.url) {
          fetchUrl = message.url;
          fetchHeaders = message.headers || {};
        } else {
          const baseUrl = String(message.baseUrl || "")
            .trim()
            .replace(/\/$/, "");
          if (!baseUrl) {
            sendResponse({ ok: false, error: "No base URL provided." });
            return;
          }
          fetchUrl = `${baseUrl}/models`;
          fetchHeaders = { "Content-Type": "application/json" };
          if (message.apiKey) fetchHeaders["Authorization"] = `Bearer ${message.apiKey}`;
        }

        const res = await fetch(fetchUrl, { headers: fetchHeaders });
        if (!res.ok) {
          let errBody = null;
          try {
            errBody = await res.json();
          } catch {}
          const errMsg = errBody?.error?.message || "";
          if (res.status === 401 || res.status === 403) {
            sendResponse({
              ok: false,
              error: message.apiKey
                ? "Invalid API key — authentication failed."
                : "Server requires authentication — enter an API key.",
            });
            return;
          }
          if (res.status === 404) {
            sendResponse({ ok: false, error: "Server doesn't expose a /models endpoint." });
            return;
          }
          if (res.status === 429) {
            sendResponse({ ok: false, error: "Rate limited — try again shortly." });
            return;
          }
          sendResponse({ ok: false, error: errMsg || `Server returned HTTP ${res.status}.` });
          return;
        }
        const json = await res.json();
        sendResponse({ ok: true, json });
      } catch (e) {
        const msg =
          e instanceof TypeError
            ? "Could not reach the server — check the base URL."
            : e instanceof Error
              ? e.message
              : String(e);
        sendResponse({ ok: false, error: msg });
      }
    })();
    return true;
  }

  if (message?.type !== "OPFOR_UI_RUN") return;

  (async () => {
    await executeAdaptiveRedTeamRun(sendResponse, message, false);
  })();

  return true;
}

// ── Keep-alive port ──────────────────────────────────────────────────────────
// The popup holds this port open during a run to prevent Chrome from killing
// the service worker mid-operation (MV3 30s idle timeout).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "opfor-keepalive") {
    port.onDisconnect.addListener(() => {});
  }
});

// ── Single consolidated message listener ─────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return handleMainMessages(message, sendResponse);
});
