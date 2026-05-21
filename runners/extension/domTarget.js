import { actSendText, actVendorSendText } from "./domActions.js";
import { snapshotCurrentResponse, extractResponse } from "./responseExtractor.js";
import { llmShortenMessage } from "./llmUiActions.js";
import { state } from "./state.js";

const SHORTEN_MAX_RETRIES = 3;
const PAUSE_POLL_MS = 300;
const MAX_CONSECUTIVE_FAILURES = 2;

/**
 * Creates a DOM-backed target adapter conforming to core's AgentTarget interface.
 *
 * tabId:     Chrome tab ID to operate on
 * frameId:   frame ID where the chat input lives (resolved by chatLocator)
 * plan:      { inputSelector, submit, vendorMode? }
 * readerCfg: LLM config for message shortening (reader model)
 * options:
 *   waitMs:     ms to wait between send and extract (default 5000)
 *   onTurnDone: async ({ round, userMessage, sentOk, extractedOk, assistantPreview }) => void
 *   onRecovery: async () => { plan, frameId, siteSnapshot }|null — called on consecutive DOM failures
 */
export function createDomTarget(tabId, frameId, plan, readerCfg, options = {}) {
  const { waitMs = 5000, onTurnDone, onRecovery } = options;

  let currentPlan = plan;
  let currentFrameId = frameId;
  let consecutiveFailures = 0;
  const transcript = [];
  const turns = [];

  return {
    async send(prompt, _options) {
      // Honor pause: block until unpaused or stopped
      while (state.pauseRequested && !state.OPFOR_STOP) {
        await sleep(PAUSE_POLL_MS);
      }
      if (state.OPFOR_STOP) throw domTargetStopError();

      // Pre-send snapshot (used for diff extraction)
      const prevSnapshot = await snapshotCurrentResponse(tabId, currentFrameId);

      // Send with message_too_long retry and optional LLM shortening
      let textToSend = prompt;
      let sendResult = null;

      for (let attempt = 0; attempt <= SHORTEN_MAX_RETRIES; attempt++) {
        sendResult = currentPlan.vendorMode
          ? await actVendorSendText(tabId, textToSend)
          : await actSendText(tabId, currentFrameId, { ...currentPlan, text: textToSend });

        if (sendResult.ok) break;

        if (sendResult.error === "message_too_long" && attempt < SHORTEN_MAX_RETRIES) {
          const maxLen = sendResult.maxLength ?? Math.floor(textToSend.length * 0.8);
          try {
            textToSend = await llmShortenMessage(readerCfg, prompt, maxLen);
          } catch {
            textToSend = prompt.slice(0, maxLen);
          }
          continue;
        }

        break;
      }

      // On send failure: try recovery (re-locate widget) before giving up
      if (!sendResult?.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && onRecovery) {
          const recovered = await onRecovery().catch(() => null);
          if (recovered?.plan) {
            currentPlan = recovered.plan;
            currentFrameId = recovered.frameId ?? currentFrameId;
            consecutiveFailures = 0;
            sendResult = await actSendText(tabId, currentFrameId, {
              ...currentPlan,
              text: textToSend,
            });
          }
        }
        if (!sendResult?.ok) {
          throw new Error(`DomTarget send failed: ${sendResult?.error ?? "unknown error"}`);
        }
      }

      if (state.OPFOR_STOP) throw domTargetStopError();

      await sleep(Math.min(waitMs, 1000));

      if (state.OPFOR_STOP) throw domTargetStopError();

      // Extract response
      const extraction = await extractResponse(
        tabId,
        currentFrameId,
        textToSend,
        prevSnapshot?.text ?? ""
      );
      const assistantText = extraction?.ok ? String(extraction.text || "").trim() : "";

      if (assistantText) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }

      // Accumulate turn data for getCollectedData()
      transcript.push({ role: "user", content: textToSend });
      transcript.push({
        role: "assistant",
        content: assistantText || "(Could not extract assistant reply from the page.)",
      });
      const turnData = {
        round: turns.length + 1,
        userMessage: textToSend,
        sentOk: !!sendResult.ok,
        extractedOk: !!assistantText,
        assistantPreview: (assistantText || "").slice(0, 10_000),
      };
      turns.push(turnData);

      if (onTurnDone) await onTurnDone(turnData).catch(() => {});

      return assistantText || "(Could not extract assistant reply from the page.)";
    },

    async close() {
      // No-op: DOM session has no persistent connection to close
    },

    /** Returns transcript and turn log accumulated during this session. */
    getCollectedData() {
      return { transcript: [...transcript], turns: [...turns] };
    },
  };
}

/**
 * Creates a tagged stop error that orchestrator.js can detect at the top level
 * to trigger its existing partial-result persistence path.
 */
export function domTargetStopError() {
  return Object.assign(new Error("OPFOR_STOP requested"), { code: "OPFOR_STOP" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
