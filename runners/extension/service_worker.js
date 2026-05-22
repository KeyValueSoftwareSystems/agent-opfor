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
    // If there's an active retry waiter, trigger it
    if (state.retryLocateResolver) {
      triggerRetryLocate();
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

        // Restart the run with stored parameters
        const restartMessage = {
          type: "OPFOR_UI_RUN",
          suiteId: opforRunStatus.suiteId,
          evaluatorId: opforRunStatus.evaluatorId,
          maxRounds: opforRunStatus.maxRounds,
          waitMs: 10000,
          scrapeFromSite: opforRunStatus.scrapeFromSite !== false,
          agentDescription: opforRunStatus.agentDescription || "",
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
