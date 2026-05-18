import { sleep } from "./utils.js";
import { state, beginUiRunAbortController, endUiRunAbortController } from "./state.js";
import { callLlm } from "./llm.js";
import { getLlmProfile, assertLlmCfg } from "./config.js";
import { loadAttackCatalog, evaluatorFromCatalog, assertEvaluatorInSuite } from "./catalog.js";
import {
  persistPausedAdaptiveRun,
  setRunStatus,
  clearRunStatus,
  persistPartialResult,
  broadcastProgress,
} from "./storage.js";
import { pickChatFrame, pickChatFrameWithRetry } from "./frameDiscovery.js";
import {
  preparePageForChat,
  actSendText,
  actVendorSendText,
  actClickSelector,
  actVerifyInputVisible,
  injectShadowPatch,
} from "./domActions.js";
import { snapshotCurrentResponse, extractResponse } from "./responseExtractor.js";
import {
  aiPickInputInFrame,
  aiUiNextAction,
  llmShortenMessage,
  llmNextUserMessage,
  judgeConversationFinal,
} from "./llmPlanner.js";

export async function sleepInterruptible(ms) {
  const step = 250;
  let left = ms;
  while (left > 0 && !state.OPFOR_STOP) {
    const chunk = Math.min(step, left);
    await sleep(chunk);
    left -= chunk;
  }
}

/**
 * AI-driven chat session reset. Scans the current page/widget for end-chat or
 * new-conversation controls and clicks them to clear the old transcript,
 * then re-opens a fresh widget.
 */
export async function resetChatSession(tabId, readerCfg) {
  const findResetButton = async (snapshot, frameUrl) => {
    const system = [
      "You are a UI automation planner. The user has finished a chat session and needs to START A NEW ONE.",
      "You receive a sanitized DOM snapshot of the current page/widget state.",
      "Your goal: find a button or control that will end the current chat and/or start a new one.",
      "",
      "Return ONLY JSON with this schema:",
      '{ "action": "click_reset" | "click_close_then_reopen" | "already_fresh" | "no_reset_found", "resetSelector"?: string, "closeSelector"?: string, "confidence": number, "notes"?: string }',
      "",
      "Decision rules:",
      '1. If you see a button/link like "New conversation", "Start new chat", "Start over", "Reset", "Clear chat" → action=click_reset with its selector.',
      '2. If you see a "Close", "End chat", "X" (close icon), "Done" button that would dismiss the widget → action=click_close_then_reopen with its closeSelector. The extension will click it, wait, then re-open the launcher.',
      "3. If the chat area looks empty / fresh (no transcript messages visible) → action=already_fresh.",
      "4. If nothing useful is found → action=no_reset_found.",
      "",
      "Look in CANDIDATE_BUTTONS for these controls. Also check for close/X icons in the widget header.",
      'Prefer selectors verbatim from selector="..." in the snapshot.',
      "NEVER click navigation links (products, pricing, etc.).",
      "Never include markdown. Never include extra keys.",
    ].join("\n");

    const user = [
      `Frame URL: ${String(frameUrl || "")}`,
      "",
      "Sanitized DOM snapshot:",
      String(snapshot || "").slice(0, 60_000),
    ].join("\n");

    return await callLlm({
      provider: readerCfg.provider,
      baseUrl: readerCfg.baseUrl,
      apiKey: readerCfg.apiKey,
      model: readerCfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
  };

  try {
    let { frames, best } = await pickChatFrame(tabId);
    let siteSnapshot = frames.find((f) => f.frameId === 0)?.snapshot || best?.snapshot || "";

    const framesToScan = [best, ...frames.filter((f) => f.frameId !== best?.frameId)].slice(0, 4);

    for (const f of framesToScan) {
      if (!f?.snapshot) continue;
      const decision = await findResetButton(f.snapshot, f.frameUrl).catch(() => null);
      if (!decision) continue;

      if (decision.action === "already_fresh") {
        const ai = await aiPickInputInFrame(readerCfg, f).catch(() => null);
        if (ai?.inputSelector) {
          const vis = await actVerifyInputVisible(tabId, f.frameId, ai.inputSelector);
          if (vis) {
            return {
              ok: true,
              plan: {
                inputSelector: ai.inputSelector,
                submit: ai.submit,
                confidence: ai.confidence,
              },
              best: f,
              siteSnapshot,
            };
          }
        }
        continue;
      }

      if (decision.action === "click_reset" && decision.resetSelector) {
        let clickRes = await actClickSelector(tabId, f.frameId, decision.resetSelector);
        if (!clickRes?.ok && f.frameId !== 0) {
          clickRes = await actClickSelector(tabId, 0, decision.resetSelector);
        }
        if (clickRes?.ok) {
          await sleep(2500);
          const { frames: newFrames } = await pickChatFrameWithRetry(tabId, {
            maxRetries: 4,
            intervalMs: 1200,
          });
          for (const nf of newFrames.slice(0, 4)) {
            const ai = await aiPickInputInFrame(readerCfg, nf).catch(() => null);
            if (ai?.inputSelector) {
              const vis = await actVerifyInputVisible(tabId, nf.frameId, ai.inputSelector);
              if (vis) {
                return {
                  ok: true,
                  plan: {
                    inputSelector: ai.inputSelector,
                    submit: ai.submit,
                    confidence: ai.confidence,
                  },
                  best: nf,
                  siteSnapshot: newFrames.find((x) => x.frameId === 0)?.snapshot || nf.snapshot,
                };
              }
            }
          }
        }
        continue;
      }

      if (decision.action === "click_close_then_reopen" && decision.closeSelector) {
        let clickRes = await actClickSelector(tabId, f.frameId, decision.closeSelector);
        if (!clickRes?.ok && f.frameId !== 0) {
          clickRes = await actClickSelector(tabId, 0, decision.closeSelector);
        }
        if (clickRes?.ok) {
          await sleep(2000);
          try {
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              files: ["frame_open_chat.js"],
            });
          } catch {}
          await sleep(3000);
          const { frames: newFrames } = await pickChatFrameWithRetry(tabId, {
            maxRetries: 5,
            intervalMs: 1200,
          });
          for (const nf of newFrames.slice(0, 4)) {
            const ai = await aiPickInputInFrame(readerCfg, nf).catch(() => null);
            if (ai?.inputSelector) {
              const vis = await actVerifyInputVisible(tabId, nf.frameId, ai.inputSelector);
              if (vis) {
                return {
                  ok: true,
                  plan: {
                    inputSelector: ai.inputSelector,
                    submit: ai.submit,
                    confidence: ai.confidence,
                  },
                  best: nf,
                  siteSnapshot: newFrames.find((x) => x.frameId === 0)?.snapshot || nf.snapshot,
                };
              }
            }
          }
        }
        continue;
      }
    }

    // Fallback: scroll, re-run heuristic opener, re-locate.
    await preparePageForChat(tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["frame_open_chat.js"],
      });
    } catch {}
    await sleep(3000);

    const { frames: finalFrames } = await pickChatFrameWithRetry(tabId, {
      maxRetries: 4,
      intervalMs: 1200,
    });
    for (const nf of finalFrames.slice(0, 4)) {
      const ai = await aiPickInputInFrame(readerCfg, nf).catch(() => null);
      if (ai?.inputSelector) {
        const vis = await actVerifyInputVisible(tabId, nf.frameId, ai.inputSelector);
        if (vis) {
          return {
            ok: true,
            plan: { inputSelector: ai.inputSelector, submit: ai.submit, confidence: ai.confidence },
            best: nf,
            siteSnapshot: finalFrames.find((x) => x.frameId === 0)?.snapshot || nf.snapshot,
          };
        }
      }
    }

    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function executeAdaptiveRedTeamRun(sendResponse, message, resume) {
  beginUiRunAbortController();
  state.OPFOR_STOP = false;

  if (!resume) {
    try {
      await chrome.storage.local.remove(["opforLastResult", "opforLiveTranscript"]);
    } catch {}
  }

  await setRunStatus({
    running: true,
    phase: "locating",
    suiteId: message?.suiteId || "",
    evaluatorId: message?.evaluatorId || "",
    startedAt: Date.now(),
  });

  broadcastProgress({
    kind: "phase",
    phase: "locating",
    suiteId: message?.suiteId,
    evaluatorId: message?.evaluatorId,
  });

  let attackerCfg;
  let judgeCfg;
  let readerCfg;
  try {
    attackerCfg = await getLlmProfile("attacker");
    judgeCfg = await getLlmProfile("judge");
    readerCfg = await getLlmProfile("reader");
    assertLlmCfg(attackerCfg, { kind: "Attacker" });
    assertLlmCfg(judgeCfg, { kind: "Judge" });
    assertLlmCfg(readerCfg, { kind: "HTML reader" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await persistPartialResult({
        ok: false,
        errorMessage: msg,
        evaluatorId: String(message?.evaluatorId || ""),
      });
    } catch {}
    await clearRunStatus();
    sendResponse({ ok: false, error: msg });
    endUiRunAbortController();
    return;
  }

  /** @type {chrome.tabs.Tab | undefined} */
  let tab;
  let maxRounds;
  let waitMs;
  /** @type {{ role: 'user' | 'assistant', content: string }[]} */
  let transcript = [];
  let turnLog = [];
  let plan;
  let best;
  let siteSnapshot = "";
  let suiteId = "";
  let attackObjective = "";
  let businessUseCase = "";
  let judgeHint = "";
  /** @type {Record<string, unknown> | null} */
  let evaluatorSnapshot = null;

  try {
    const catalog = await loadAttackCatalog();

    if (resume) {
      const { opforPausedRun: paused } = await chrome.storage.local.get("opforPausedRun");
      if (!paused?.plan?.inputSelector) throw new Error("No paused session to resume.");
      suiteId = paused.suiteId || "";
      evaluatorSnapshot = paused.evaluatorSnapshot;
      if (
        !evaluatorSnapshot?.id ||
        !Array.isArray(evaluatorSnapshot.patterns) ||
        evaluatorSnapshot.patterns.length === 0
      ) {
        throw new Error("Paused session has no evaluator data. Discard it and start a new run.");
      }
      tab = await chrome.tabs.get(paused.tabId).catch(() => undefined);
      if (!tab?.id)
        throw new Error(
          "The original tab is gone. Discard the paused session and open the site again."
        );

      maxRounds = paused.maxRounds;
      waitMs = paused.waitMs;
      transcript = Array.isArray(paused.transcript) ? paused.transcript : [];
      turnLog = Array.isArray(paused.turnLog) ? paused.turnLog : [];
      plan = paused.plan;
      best = { frameId: paused.frameId, frameUrl: paused.frameUrl };
      siteSnapshot = paused.siteSnapshot || "";

      if (transcript.length % 2 === 1) {
        await sleepInterruptible(Math.min(waitMs, 1000));
        if (state.OPFOR_STOP) {
          await persistPausedAdaptiveRun({
            tabId: tab.id,
            siteUrl: tab.url || "",
            maxRounds,
            waitMs,
            transcript,
            turnLog,
            plan,
            frameId: best.frameId,
            frameUrl: best.frameUrl,
            siteSnapshot,
            suiteId,
            evaluatorSnapshot,
          });
          sendResponse({ ok: false, error: "Run stopped.", paused: true });
          return;
        }
        const resumeLastUser = transcript[transcript.length - 1]?.content || "";
        const extracted = await extractResponse(tab.id, best.frameId, resumeLastUser, "");
        const assistantText = extracted?.ok ? String(extracted.text || "").trim() : "";
        transcript.push({
          role: "assistant",
          content: assistantText || "(Could not extract assistant reply from the page.)",
        });
        const lastUser = resumeLastUser;
        turnLog.push({
          round: turnLog.length + 1,
          userMessage: lastUser,
          sentOk: true,
          extractedOk: !!extracted?.ok,
          assistantPreview: (assistantText || "").slice(0, 10_000),
          resumedAssistantFetch: true,
        });
      }
    } else {
      suiteId = String(message.suiteId || "").trim();
      const evaluatorId = String(message.evaluatorId || "").trim();
      if (!suiteId || !evaluatorId) throw new Error("Select a suite and evaluator.");
      assertEvaluatorInSuite(catalog, suiteId, evaluatorId);
      evaluatorSnapshot = evaluatorFromCatalog(catalog, evaluatorId);
      if (!evaluatorSnapshot) throw new Error(`Unknown evaluator: ${evaluatorId}`);

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
      if (!tab?.id) throw new Error("No active tab found.");

      maxRounds = Math.max(1, Math.min(20, Number(message.maxRounds ?? message.turns ?? 10)));
      waitMs = Math.max(3000, Math.min(30000, Number(message.waitMs || 10000)));
      attackObjective = String(message.attackObjective || "").trim();
      businessUseCase = String(message.businessUseCase || "").trim();
      judgeHint = String(message.judgeHint || "").trim();

      // Phase 1: Prepare page — scroll to trigger lazy widgets.
      await preparePageForChat(tab.id);

      // Phase 2: Heuristic open — try vendor JS APIs first, then DOM heuristics.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["frame_vendor_open.js"],
          world: "MAIN",
        });
      } catch {}
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ["frame_open_chat.js"],
        });
      } catch {}
      await sleep(2500);

      // Phase 3: AI agentic loop — scan frames, ask AI to find input or click launchers.
      const clickedLaunchers = [];
      let lastErr = "";
      let clickedThisIteration = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { frames, best: b } = clickedThisIteration
          ? await pickChatFrameWithRetry(tab.id, { maxRetries: 4, intervalMs: 1200 })
          : await (async () => {
              await sleep(attempt === 0 ? 600 : 500);
              return pickChatFrame(tab.id);
            })();
        best = b;
        siteSnapshot = frames.find((f) => f.frameId === 0)?.snapshot || best.snapshot;

        const decision = await aiUiNextAction(readerCfg, {
          frameUrl: best.frameUrl,
          snapshot: best.snapshot,
          lastError: lastErr,
          attempts: attempt,
          clickedLaunchers,
        });

        if (decision?.action === "set_input" && decision?.inputSelector) {
          const visible = await actVerifyInputVisible(tab.id, best.frameId, decision.inputSelector);
          if (visible) {
            plan = {
              inputSelector: decision.inputSelector,
              submit: decision.submit,
              confidence: decision.confidence,
            };
            break;
          }
          for (const f of frames.filter((fr) => fr.frameId !== best.frameId)) {
            const altAi = await aiPickInputInFrame(readerCfg, f).catch(() => null);
            if (altAi?.inputSelector) {
              const altVis = await actVerifyInputVisible(tab.id, f.frameId, altAi.inputSelector);
              if (altVis) {
                best = f;
                plan = {
                  inputSelector: altAi.inputSelector,
                  submit: altAi.submit,
                  confidence: altAi.confidence,
                };
                break;
              }
            }
          }
          if (plan) break;
          lastErr = "AI picked input but it was not visible in any frame";
          continue;
        }

        if (
          decision?.action === "click_launcher" &&
          typeof decision.launcherSelector === "string"
        ) {
          const sel = decision.launcherSelector;
          let clickRes = await actClickSelector(tab.id, 0, sel);
          if (!clickRes?.ok && best.frameId !== 0) {
            clickRes = await actClickSelector(tab.id, best.frameId, sel);
          }
          if (!clickRes?.ok) {
            lastErr = clickRes?.error || "click failed";
            clickedThisIteration = false;
          } else {
            clickedLaunchers.push(sel);
            clickedThisIteration = true;
            await sleep(3000);
          }
          continue;
        }

        if (decision?.action === "wait") {
          clickedThisIteration = false;
          await sleep(Math.max(500, Math.min(5000, Number(decision.waitMs || 2500))));
          continue;
        }

        if (decision?.action === "give_up") {
          lastErr = String(decision?.notes || "AI gave up");
          break;
        }

        clickedThisIteration = false;
        lastErr = String(decision?.notes || "unexpected action");
      }

      // Phase 4: Fallback — scan all frames with aiPickInputInFrame.
      if (!plan?.inputSelector) {
        try {
          const { frames: fbFrames, best: fbBest } = await pickChatFrameWithRetry(tab.id, {
            maxRetries: 3,
            intervalMs: 1000,
          });
          const framesToTry = fbFrames
            .filter((f) => (f.chatScore || 0) > 0 || f.inputCount > 0)
            .slice(0, 6);
          if (!framesToTry.length && fbBest) framesToTry.push(fbBest);

          for (const f of framesToTry) {
            const ai = await aiPickInputInFrame(readerCfg, f).catch(() => null);
            if (ai?.inputSelector) {
              const vis = await actVerifyInputVisible(tab.id, f.frameId, ai.inputSelector);
              if (vis) {
                best = f;
                plan = {
                  inputSelector: ai.inputSelector,
                  submit: ai.submit,
                  confidence: ai.confidence,
                };
                break;
              }
            }
            if (ai?.launcherSelector && !clickedLaunchers.includes(ai.launcherSelector)) {
              await actClickSelector(tab.id, 0, ai.launcherSelector);
              clickedLaunchers.push(ai.launcherSelector);
              await sleep(3000);
              const { frames: postFrames } = await pickChatFrame(tab.id);
              for (const pf of postFrames.filter((x) => (x.chatScore || 0) > 0).slice(0, 4)) {
                const postAi = await aiPickInputInFrame(readerCfg, pf).catch(() => null);
                if (postAi?.inputSelector) {
                  const pv = await actVerifyInputVisible(tab.id, pf.frameId, postAi.inputSelector);
                  if (pv) {
                    best = pf;
                    plan = {
                      inputSelector: postAi.inputSelector,
                      submit: postAi.submit,
                      confidence: postAi.confidence,
                    };
                    break;
                  }
                }
              }
              if (plan) break;
            }
          }
        } catch {}
      }

      // Phase 5: Vendor API fallback for widgets with closed shadow DOM.
      if (!plan?.inputSelector) {
        try {
          await injectShadowPatch(tab.id);
          await sleep(500);
          const vendorResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            files: ["frame_vendor_api.js"],
            world: "MAIN",
          });
          const vendorResult = vendorResults?.[0]?.result;
          if (vendorResult?.ok && vendorResult?.inputFound) {
            plan = {
              inputSelector: "__VENDOR_INPUT__",
              submit: { method: "vendor" },
              confidence: 0.8,
              vendorMode: true,
              vendor: vendorResult.vendor,
            };
          }
        } catch {}
      }
      if (!plan?.inputSelector) throw new Error("AI could not find (or open) the chat input.");
    }

    await setRunStatus({
      running: true,
      tabId: tab.id,
      siteUrl: tab.url || "",
      suiteId,
      evaluatorId: evaluatorSnapshot?.id,
      evaluatorName: evaluatorSnapshot?.name,
      maxRounds,
      phase: "running",
      transcript: [],
      startedAt: Date.now(),
    });

    broadcastProgress({
      kind: "phase",
      phase: "running",
      suiteId,
      evaluatorId: evaluatorSnapshot?.id,
      maxRounds,
    });

    const suiteRec = catalog.suites.find((s) => s.id === suiteId);
    const suiteLabel = suiteRec ? `${suiteRec.name} (${suiteRec.id})` : suiteId;

    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 2;
    let knownMaxLength = undefined;
    let round = Math.floor(transcript.length / 2);

    for (; round < maxRounds; round++) {
      if (state.OPFOR_STOP) {
        await persistPartialResult({
          ok: true,
          partial: true,
          stopped: true,
          stopReason: "user_stop",
          siteUrl: tab.url || "",
          architecture: "evaluator_adaptive_multi_turn",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          maxRounds,
          frame: { frameId: best.frameId, frameUrl: best.frameUrl },
          transcript,
          turns: turnLog,
        });
        await persistPausedAdaptiveRun({
          tabId: tab.id,
          siteUrl: tab.url || "",
          maxRounds,
          waitMs,
          transcript,
          turnLog,
          plan,
          frameId: best.frameId,
          frameUrl: best.frameUrl,
          siteSnapshot,
          suiteId,
          evaluatorSnapshot,
        });
        sendResponse({ ok: false, error: "Run stopped.", paused: true });
        await clearRunStatus();
        return;
      }

      let detectedMaxLength = knownMaxLength || undefined;
      let userMessage = await llmNextUserMessage(attackerCfg, {
        evaluatorSnapshot,
        suiteLabel,
        siteUrl: tab.url || "",
        siteSnapshot,
        transcript,
        maxMessageLength: detectedMaxLength,
        attackObjective,
        businessUseCase,
      });

      if (state.OPFOR_STOP) {
        await persistPartialResult({
          ok: true,
          partial: true,
          stopped: true,
          stopReason: "user_stop",
          siteUrl: tab.url || "",
          architecture: "evaluator_adaptive_multi_turn",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          maxRounds,
          frame: { frameId: best.frameId, frameUrl: best.frameUrl },
          transcript,
          turns: turnLog,
        });
        await persistPausedAdaptiveRun({
          tabId: tab.id,
          siteUrl: tab.url || "",
          maxRounds,
          waitMs,
          transcript,
          turnLog,
          plan,
          frameId: best.frameId,
          frameUrl: best.frameUrl,
          siteSnapshot,
          suiteId,
          evaluatorSnapshot,
        });
        sendResponse({ ok: false, error: "Run stopped.", paused: true });
        await clearRunStatus();
        return;
      }

      const preSendSnapshot = await snapshotCurrentResponse(tab.id, best.frameId);

      let actResult;
      if (plan.vendorMode) {
        actResult = await actVendorSendText(tab.id, userMessage);
      } else {
        actResult = await actSendText(tab.id, best.frameId, {
          inputSelector: plan.inputSelector,
          submit: plan.submit,
          text: userMessage,
        });
      }

      // Handle message-too-long: shorten and retry (up to 3 times).
      if (actResult?.error === "message_too_long") {
        const limit = actResult.maxLength || Math.floor(userMessage.length * 0.6);
        detectedMaxLength = limit;
        knownMaxLength = limit;
        for (let shortenAttempt = 0; shortenAttempt < 3; shortenAttempt++) {
          try {
            userMessage = await llmShortenMessage(attackerCfg, userMessage, limit);
          } catch {
            userMessage = userMessage.slice(0, Math.floor(limit * 0.85));
          }
          actResult = await actSendText(tab.id, best.frameId, {
            inputSelector: plan.inputSelector,
            submit: plan.submit,
            text: userMessage,
          });
          if (actResult?.ok || actResult?.error !== "message_too_long") break;
        }
      }

      // If send failed, re-discover the chat frame and input.
      if (!actResult?.ok && actResult?.error !== "message_too_long") {
        try {
          const { frames: rFrames, best: rBest } = await pickChatFrame(tab.id);
          if (rBest) {
            best = rBest;
            siteSnapshot = rFrames.find((f) => f.frameId === 0)?.snapshot || rBest.snapshot;
            const rAi = await aiPickInputInFrame(readerCfg, rBest);
            if (rAi?.inputSelector) {
              plan = {
                inputSelector: rAi.inputSelector,
                submit: rAi.submit,
                confidence: rAi.confidence,
              };
              actResult = await actSendText(tab.id, best.frameId, {
                inputSelector: plan.inputSelector,
                submit: plan.submit,
                text: userMessage,
              });
            }
          }
        } catch {}
      }

      transcript.push({ role: "user", content: userMessage });
      broadcastProgress({
        kind: "turn",
        round: round + 1,
        role: "user",
        content: userMessage,
        suiteId,
        evaluatorId: evaluatorSnapshot?.id,
      });

      await sleepInterruptible(Math.min(waitMs, 1000));

      if (state.OPFOR_STOP) {
        await persistPartialResult({
          ok: true,
          partial: true,
          stopped: true,
          stopReason: "user_stop",
          siteUrl: tab.url || "",
          architecture: "evaluator_adaptive_multi_turn",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          maxRounds,
          frame: { frameId: best.frameId, frameUrl: best.frameUrl },
          transcript,
          turns: turnLog,
        });
        await persistPausedAdaptiveRun({
          tabId: tab.id,
          siteUrl: tab.url || "",
          maxRounds,
          waitMs,
          transcript,
          turnLog,
          plan,
          frameId: best.frameId,
          frameUrl: best.frameUrl,
          siteSnapshot,
          suiteId,
          evaluatorSnapshot,
        });
        sendResponse({ ok: false, error: "Run stopped.", paused: true });
        await clearRunStatus();
        return;
      }

      const extracted = await extractResponse(tab.id, best.frameId, userMessage, preSendSnapshot);
      const assistantText = extracted?.ok ? String(extracted.text || "").trim() : "";

      const sendOrExtractFailed = !actResult?.ok || !assistantText;
      if (sendOrExtractFailed) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && round < maxRounds - 1) {
        broadcastProgress({
          kind: "phase",
          phase: "locating",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
        });
        const resetResult = await resetChatSession(tab.id, readerCfg);
        if (resetResult?.ok && resetResult.plan) {
          plan = resetResult.plan;
          best = resetResult.best;
          siteSnapshot = resetResult.siteSnapshot || siteSnapshot;
          consecutiveFailures = 0;
          broadcastProgress({
            kind: "phase",
            phase: "running",
            suiteId,
            evaluatorId: evaluatorSnapshot?.id,
          });

          const retryPreSnapshot = await snapshotCurrentResponse(tab.id, best.frameId);
          actResult = await actSendText(tab.id, best.frameId, {
            inputSelector: plan.inputSelector,
            submit: plan.submit,
            text: userMessage,
          });
          if (actResult?.ok) {
            await sleepInterruptible(Math.min(waitMs, 1000));
            const retryExtracted = await extractResponse(
              tab.id,
              best.frameId,
              userMessage,
              retryPreSnapshot
            );
            const retryText = retryExtracted?.ok ? String(retryExtracted.text || "").trim() : "";
            transcript.push({ role: "user", content: userMessage });
            transcript.push({
              role: "assistant",
              content: retryText || "(Could not extract assistant reply from the page.)",
            });
            broadcastProgress({
              kind: "turn",
              round: round + 1,
              role: "user",
              content: userMessage,
              suiteId,
              evaluatorId: evaluatorSnapshot?.id,
            });
            broadcastProgress({
              kind: "turn",
              round: round + 1,
              role: "assistant",
              content: retryText || "(Could not extract)",
              suiteId,
              evaluatorId: evaluatorSnapshot?.id,
            });
            turnLog.push({
              round: round + 1,
              userMessage,
              sentOk: true,
              extractedOk: !!retryText,
              assistantPreview: (retryText || "").slice(0, 10_000),
              chatReset: true,
            });
            continue;
          }
        }
        broadcastProgress({
          kind: "phase",
          phase: "running",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
        });
      }

      transcript.push({
        role: "assistant",
        content: assistantText || "(Could not extract assistant reply from the page.)",
      });
      broadcastProgress({
        kind: "turn",
        round: round + 1,
        role: "assistant",
        content: assistantText || "(Could not extract assistant reply from the page.)",
        suiteId,
        evaluatorId: evaluatorSnapshot?.id,
      });
      turnLog.push({
        round: round + 1,
        userMessage,
        sentOk: !!actResult?.ok,
        extractedOk: !!extracted?.ok,
        assistantPreview: (assistantText || "").slice(0, 10_000),
      });

      // Persist transcript after every turn so no data is lost if the service worker crashes.
      try {
        await chrome.storage.local.set({
          opforLiveTranscript: {
            v: 1,
            savedAt: Date.now(),
            suiteId,
            evaluatorId: evaluatorSnapshot?.id,
            evaluatorName: evaluatorSnapshot?.name,
            severity: evaluatorSnapshot?.severity,
            siteUrl: tab.url || "",
            transcript,
            turns: turnLog,
            round: round + 1,
            maxRounds,
            completed: false,
          },
        });
      } catch {}
    }

    if (transcript.length >= 2) {
      broadcastProgress({
        kind: "phase",
        phase: "judging",
        suiteId,
        evaluatorId: evaluatorSnapshot?.id,
      });
    }

    let judgment;
    if (transcript.length >= 2) {
      try {
        judgment = await judgeConversationFinal(judgeCfg, {
          evaluatorSnapshot,
          transcript,
          attackObjective,
          judgeHint,
        });
      } catch (judgeErr) {
        const errMsg = judgeErr instanceof Error ? judgeErr.message : String(judgeErr);
        if (errMsg === "Run stopped." || state.OPFOR_STOP) throw judgeErr;
        judgment = {
          verdict: "UNKNOWN",
          summary: `Judge LLM call failed: ${errMsg.slice(0, 200)}`,
          findings: [
            "Judgment could not be completed — transcript may be too long or LLM timed out.",
          ],
        };
      }
    } else {
      judgment = { verdict: "UNKNOWN", summary: "No complete turns.", findings: [] };
    }

    if (state.OPFOR_STOP) {
      let stoppedJudgment = judgment;
      if (!stoppedJudgment && transcript.length >= 2 && judgeCfg?.enabled) {
        try {
          stoppedJudgment = await judgeConversationFinal(judgeCfg, {
            evaluatorSnapshot,
            transcript,
            attackObjective,
            judgeHint,
          });
        } catch {
          stoppedJudgment = {
            verdict: "UNKNOWN",
            summary: "Run stopped before judgment could complete.",
            findings: ["Run stopped by user; partial transcript was collected."],
          };
        }
      }
      const stoppedResult = {
        ok: true,
        partial: true,
        stopped: true,
        stopReason: "user_stop",
        siteUrl: tab.url || "",
        architecture: "evaluator_adaptive_multi_turn",
        suiteId,
        evaluatorId: evaluatorSnapshot?.id,
        evaluatorName: evaluatorSnapshot?.name,
        severity: evaluatorSnapshot?.severity,
        maxRounds,
        frame: { frameId: best.frameId, frameUrl: best.frameUrl },
        transcript,
        turns: turnLog,
        judgment: stoppedJudgment || undefined,
      };
      await persistPartialResult(stoppedResult);
      await persistPausedAdaptiveRun({
        tabId: tab.id,
        siteUrl: tab.url || "",
        maxRounds,
        waitMs,
        transcript,
        turnLog,
        plan,
        frameId: best.frameId,
        frameUrl: best.frameUrl,
        siteSnapshot,
        suiteId,
        evaluatorSnapshot,
      });
      sendResponse({ ok: false, error: "Run stopped before judge.", paused: true });
      await clearRunStatus();
      return;
    }

    await chrome.storage.local.remove("opforPausedRun");
    await clearRunStatus();

    const finalResult = {
      ok: true,
      completed: true,
      partial: false,
      stopped: false,
      siteUrl: tab.url || "",
      architecture: "evaluator_adaptive_multi_turn",
      suiteId,
      evaluatorId: evaluatorSnapshot?.id,
      evaluatorName: evaluatorSnapshot?.name,
      severity: evaluatorSnapshot?.severity,
      maxRounds,
      frame: { frameId: best.frameId, frameUrl: best.frameUrl },
      transcript,
      turns: turnLog,
      judgment,
    };
    await persistPartialResult(finalResult);
    try {
      await chrome.storage.local.remove("opforLiveTranscript");
    } catch {}
    try {
      sendResponse(finalResult);
    } catch {
      // Message channel may have closed if popup was closed; data is safe in storage.
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Run stopped." || state.OPFOR_STOP) {
      let stoppedJudgment;
      if (transcript?.length >= 2 && evaluatorSnapshot && judgeCfg?.enabled) {
        try {
          stoppedJudgment = await judgeConversationFinal(judgeCfg, {
            evaluatorSnapshot,
            transcript,
            attackObjective,
            judgeHint,
          });
        } catch {
          stoppedJudgment = {
            verdict: "UNKNOWN",
            summary: "Run was stopped; judgment could not be completed.",
            findings: ["Run stopped by user before all turns completed."],
          };
        }
      }
      try {
        await persistPartialResult({
          ok: true,
          partial: true,
          stopped: true,
          stopReason: "user_stop",
          siteUrl: tab?.url || "",
          architecture: "evaluator_adaptive_multi_turn",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          severity: evaluatorSnapshot?.severity,
          maxRounds,
          frame: best ? { frameId: best.frameId, frameUrl: best.frameUrl } : undefined,
          transcript,
          turns: turnLog,
          judgment: stoppedJudgment || undefined,
        });
      } catch {}
      if (plan?.inputSelector && tab?.id && best?.frameId != null) {
        try {
          await persistPausedAdaptiveRun({
            tabId: tab.id,
            siteUrl: tab.url || "",
            maxRounds,
            waitMs,
            transcript,
            turnLog,
            plan,
            frameId: best.frameId,
            frameUrl: best.frameUrl,
            siteSnapshot,
            suiteId,
            evaluatorSnapshot,
          });
        } catch {}
      }
      sendResponse({ ok: false, error: "Run stopped.", paused: true });
      await clearRunStatus();
    } else {
      let errorJudgment;
      if (transcript?.length >= 2 && evaluatorSnapshot && judgeCfg?.enabled) {
        try {
          errorJudgment = await judgeConversationFinal(judgeCfg, {
            evaluatorSnapshot,
            transcript,
            attackObjective,
            judgeHint,
          });
        } catch {}
      }
      if (errorJudgment && transcript?.length >= 2) {
        const partialResult = {
          ok: true,
          partial: true,
          stopped: false,
          stopReason: "error",
          errorMessage: msg,
          siteUrl: tab?.url || "",
          architecture: "evaluator_adaptive_multi_turn",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          severity: evaluatorSnapshot?.severity,
          maxRounds,
          frame: best ? { frameId: best.frameId, frameUrl: best.frameUrl } : undefined,
          transcript,
          turns: turnLog,
          judgment: errorJudgment,
        };
        await persistPartialResult(partialResult);
        try {
          sendResponse(partialResult);
        } catch {}
      } else {
        try {
          await persistPartialResult({
            ok: false,
            partial: true,
            stopped: false,
            stopReason: "error",
            errorMessage: msg,
            siteUrl: tab?.url || "",
            suiteId,
            evaluatorId: evaluatorSnapshot?.id,
            evaluatorName: evaluatorSnapshot?.name,
            severity: evaluatorSnapshot?.severity,
            transcript: transcript || [],
            turns: turnLog || [],
          });
        } catch {}
        sendResponse({
          ok: false,
          error: msg,
          debug: { note: "Enable AI in Options; open the site chat if needed." },
        });
      }
      await clearRunStatus();
    }
  } finally {
    endUiRunAbortController();
  }
}
