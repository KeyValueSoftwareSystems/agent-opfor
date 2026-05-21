import { state, triggerRetryLocate } from "./state.js";
import { getLlmProfile, assertLlmCfg } from "./config.js";
import { loadAttackCatalog } from "./catalog.js";
import { clearRunStatus } from "./storage.js";
import { pickChatFrameWithRetry, embeddedChatBoost } from "./frameDiscovery.js";
import { preparePageForChat, actSendText } from "./domActions.js";
import {
  judgeResponse,
  createModel,
  setEnvProvider,
  PROVIDER_ENV_VARS,
  generateJsonObject,
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

// ── OPFOR_INJECT_SEND_HI ─────────────────────────────────────────────────────
// Legacy single-shot handler: open chat, find input via AI, send "hi".
function handleInjectSendHi(message, sendResponse) {
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");

      await preparePageForChat(tab.id);

      let vendorOpenResult = null;
      try {
        const vendorRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["frame_vendor_open.js"],
          world: "MAIN",
        });
        vendorOpenResult = vendorRes?.[0]?.result;
      } catch {}

      const openResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ["frame_open_chat.js"],
      });
      const openResult = openResults?.[0]?.result ?? { ok: true, clicked: false };

      await new Promise((r) => setTimeout(r, 2500));

      let allFramesMeta = [];
      try {
        allFramesMeta = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      } catch {}

      const { frames } = await pickChatFrameWithRetry(tab.id, { maxRetries: 6, intervalMs: 1000 });
      if (!frames.length) throw new Error("No frame snapshots collected.");

      frames.sort((a, b) => {
        const boost = embeddedChatBoost(b) - embeddedChatBoost(a);
        if (boost !== 0) return boost;
        return (b.chatScore || 0) - (a.chatScore || 0) || (b.inputCount || 0) - (a.inputCount || 0);
      });
      const chatFrames = frames.filter((f) => (f.chatScore || 0) > 0);
      const nonChatFrames = frames.filter((f) => (f.chatScore || 0) <= 0);
      const framesToTry = [...chatFrames, ...nonChatFrames];

      const cfg = await getLlmProfile("reader");
      assertLlmCfg(cfg, { kind: "HTML reader" });

      let lastAi = null;
      let lastAct = null;

      for (const f of framesToTry.slice(0, 8)) {
        const system = [
          "You are helping a browser extension identify a chat input box INSIDE A SINGLE IFRAME/FRAME.",
          "You receive a SANITIZED DOM snapshot for that frame only.",
          "Return ONLY JSON with this exact schema:",
          `{ "inputSelector": string, "submit": { "method": "enter" | "click", "buttonSelector"?: string }, "confidence": number, "notes"?: string }`,
          "Selectors must be CSS selectors.",
          'IMPORTANT: Prefer selectors that appear verbatim in selector="..." entries in the snapshot (these may include shadow(...) >> ... syntax).',
          "If the snapshot has CHAT_SIGNALS (role=log, aria-live, chat_transcript), this frame IS the chat UI — choose the input from it, not a site search bar.",
          "Pick the textarea, [contenteditable], or [role=textbox] that is closest to the bottom of the visible chat transcript, not the page header.",
          "Reject any input marked site_search_hint=1, type=search, role=searchbox, or with placeholder/aria mentioning 'search articles/help'.",
          "Prefer submit.method='click' with a visible send/submit button when one appears in CANDIDATE_BUTTONS; fall back to 'enter' only if no send button is found.",
          "Never pick plus/attach/paperclip/microphone buttons as the submit action.",
          "Never include markdown. Never include extra keys.",
        ].join("\n");

        const user = [
          "Task: Identify the chat prompt/input element in this frame and how to submit a message.",
          `Frame URL: ${String(f.frameUrl || "")}`,
          "",
          "Sanitized DOM snapshot:",
          String(f.snapshot).slice(0, 60_000),
        ].join("\n");

        const ai = await generateJsonObject(buildModelFromProfile(cfg), [
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        lastAi = { frameId: f.frameId, frameUrl: f.frameUrl, ...ai };

        if (!ai?.inputSelector || typeof ai.inputSelector !== "string") continue;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [f.frameId] },
          func: (plan) => {
            globalThis.__OPFOR_PLAN__ = plan;
          },
          args: [{ inputSelector: ai.inputSelector, submit: ai.submit, text: "hi" }],
        });

        const act2 = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [f.frameId] },
          files: ["frame_actuate.js"],
        });
        const actResult = act2?.[0]?.result;
        lastAct = { frameId: f.frameId, result: actResult };

        if (actResult?.ok) {
          sendResponse({
            ok: true,
            via: "ai_frames",
            inputKind: actResult.inputKind,
            submitMethod: ai?.submit?.method === "click" ? "button.click" : "enter.key",
            open: openResult,
            frame: { frameId: f.frameId, frameUrl: f.frameUrl },
            ai: {
              confidence: ai.confidence,
              inputSelector: ai.inputSelector,
              submitMethod: ai.submit?.method,
              buttonSelector: ai.submit?.buttonSelector,
              notes: ai.notes,
            },
          });
          return;
        }
      }

      sendResponse({
        ok: false,
        error: "Could not send message in any frame (see ai/act results).",
        open: openResult,
        framesMeta: allFramesMeta,
        collectedFrames: frames.map((f) => ({
          frameId: f.frameId,
          frameUrl: f.frameUrl,
          chatScore: f.chatScore,
          inputCount: f.inputCount,
        })),
        lastAi,
        lastAct,
      });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true;
}

// ── OPFOR_AI_PICK_INPUT ──────────────────────────────────────────────────────
function handleAiPickInput(message, sendResponse) {
  (async () => {
    try {
      const cfg = await getLlmProfile("reader");
      assertLlmCfg(cfg, { kind: "HTML reader" });

      const dom = String(message?.sanitizedDom || "");
      const userTask = String(message?.task || "Find the chat input and how to submit.");

      const system = [
        "You are helping a browser extension identify a chat input box on a web page.",
        "You receive a SANITIZED DOM snapshot containing only inputs/textareas/contenteditable nodes and candidate send/submit buttons, plus nearby labels.",
        "Return ONLY JSON with this exact schema:",
        `{ "inputSelector": string, "submit": { "method": "enter" | "click", "buttonSelector"?: string }, "confidence": number, "notes"?: string }`,
        "Selectors must be CSS selectors.",
        'IMPORTANT: Prefer returning selectors that appear verbatim in selector="..." entries in the snapshot.',
        "Prefer stable attributes like data-testid, aria-label, name, id.",
        "Submission guidance:",
        "- Prefer submit.method='click' with a buttonSelector when you can identify a Send/Submit button.",
        "- Only use submit.method='enter' when no reliable send button is available or the UI obviously uses Enter-to-send.",
        "- If you choose 'click', you MUST provide submit.buttonSelector that matches a visible element.",
        "Avoid picking search bars or site search inputs as the chat input.",
        "Never choose attachment/plus/microphone buttons for submit.",
        "If no chat input is visible, suggest a likely launcher/button to open chat in notes, based on LIKELY_CHAT_LAUNCHERS or FLOATING_WIDGET_CANDIDATES.",
        "If unsure, set confidence < 0.5 and still provide best guess selectors.",
        "Never include markdown. Never include extra keys.",
      ].join("\n");

      const user = [`Task: ${userTask}`, "", "Sanitized DOM snapshot:", dom.slice(0, 60_000)].join(
        "\n"
      );

      const out = await generateJsonObject(buildModelFromProfile(cfg), [
        { role: "system", content: system },
        { role: "user", content: user },
      ]);

      sendResponse({ ok: true, ...out });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true;
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
  const type = message?.type;
  if (type === "OPFOR_INJECT_SEND_HI") return handleInjectSendHi(message, sendResponse);
  if (type === "OPFOR_AI_PICK_INPUT") return handleAiPickInput(message, sendResponse);
  if (
    type === "OPFOR_UI_STOP" ||
    type === "OPFOR_UI_RETRY_LOCATE" ||
    type === "OPFOR_UI_DISCARD_PAUSED" ||
    type === "OPFOR_UI_RESUME" ||
    type === "OPFOR_RESET_CHAT" ||
    type === "OPFOR_JUDGE_PARTIAL" ||
    type === "OPFOR_UI_RUN"
  ) {
    return handleMainMessages(message, sendResponse);
  }
});
