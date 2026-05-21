import { sleep } from "./utils.js";
import {
  state,
  beginUiRunAbortController,
  endUiRunAbortController,
  waitForRetryLocate,
  clearRetryLocate,
} from "./state.js";
import {
  judgeResponse,
  createModel,
  setEnvProvider,
  PROVIDER_ENV_VARS,
  generateJsonObject,
  runAllBrowser,
} from "./dist/core.bundle.js";
import { createDomTarget } from "./domTarget.js";
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
import { locateChatWidget } from "./chatLocator.js";
import { actClickSelector, actVerifyInputVisible } from "./domActions.js";
import { extractResponse } from "./responseExtractor.js";
import { aiPickInputInFrame, llmShortenMessage } from "./llmUiActions.js";

export async function sleepInterruptible(ms) {
  const step = 250;
  let left = ms;
  while (left > 0 && !state.OPFOR_STOP) {
    const chunk = Math.min(step, left);
    await sleep(chunk);
    left -= chunk;
  }
}

/** Build a core LanguageModel from an extension LLM profile. */
function profileToLlmConfig(profile) {
  const envVar = PROVIDER_ENV_VARS[profile.provider] ?? "OPFOR_API_KEY";
  setEnvProvider((name) => (name === envVar ? profile.apiKey : undefined));
  return {
    provider: profile.provider,
    model: profile.model,
    apiKeyEnv: envVar,
    baseURL: profile.baseUrl || undefined,
  };
}

function buildModelFromProfile(profile) {
  return createModel(profileToLlmConfig(profile));
}

/** Map core JudgeResult to the extension's judgment schema. */
function adaptJudgeResult(coreResult) {
  return {
    verdict: coreResult.verdict === "ERROR" ? "UNKNOWN" : coreResult.verdict,
    summary: coreResult.reasoning,
    findings: coreResult.evidence ? [{ text: coreResult.evidence }] : [],
    confidence: coreResult.confidence,
    score: coreResult.score,
  };
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

    return await generateJsonObject(buildModelFromProfile(readerCfg), [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
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

    return await locateChatWidget(tabId, readerCfg);
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
  let attackerLlmConfig;
  let judgeLlmConfig;
  let attackerModel;
  let judgeModel;
  try {
    attackerCfg = await getLlmProfile("attacker");
    judgeCfg = await getLlmProfile("judge");
    readerCfg = await getLlmProfile("reader");
    assertLlmCfg(attackerCfg, { kind: "Attacker" });
    assertLlmCfg(judgeCfg, { kind: "Judge" });
    assertLlmCfg(readerCfg, { kind: "HTML reader" });
    attackerLlmConfig = profileToLlmConfig(attackerCfg);
    judgeLlmConfig = profileToLlmConfig(judgeCfg);
    attackerModel = createModel(attackerLlmConfig);
    judgeModel = createModel(judgeLlmConfig);
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
  let siteSnapshot;
  let suiteId = "";
  let attackObjective = "";
  let businessUseCase;
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

      if (message.tabId) {
        tab = await chrome.tabs.get(message.tabId);
      } else {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs[0];
      }
      if (!tab?.id) throw new Error("No active tab found.");

      maxRounds = Math.max(1, Math.min(20, Number(message.maxRounds ?? message.turns ?? 10)));
      waitMs = Math.max(3000, Math.min(30000, Number(message.waitMs || 10000)));
      attackObjective = String(message.attackObjective || "").trim();
      businessUseCase = String(message.businessUseCase || "").trim();
      judgeHint = String(message.judgeHint || "").trim();

      // Set preliminary run status so await_user phase can be persisted
      await setRunStatus({
        running: true,
        tabId: tab.id,
        siteUrl: tab.url || "",
        suiteId,
        evaluatorId: evaluatorSnapshot?.id,
        evaluatorName: evaluatorSnapshot?.name,
        maxRounds,
        phase: "locating",
        transcript: [],
        startedAt: Date.now(),
        attackObjective,
        businessUseCase,
        judgeHint,
      });

      let located = await locateChatWidget(tab.id, readerCfg);

      const MAX_USER_RETRIES = 5;
      let userRetryCount = 0;

      while (!located.ok && !state.OPFOR_STOP && userRetryCount < MAX_USER_RETRIES) {
        broadcastProgress({
          kind: "phase",
          phase: "await_user",
          error: located.error || "Could not find (or open) the chat input.",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          maxRounds,
        });

        const retryPromise = waitForRetryLocate();
        const timeoutPromise = new Promise((resolve) =>
          setTimeout(() => resolve("timeout"), 120_000)
        );

        const result = await Promise.race([retryPromise, timeoutPromise]);

        if (state.OPFOR_STOP) {
          clearRetryLocate();
          throw new Error("Run stopped by user.");
        }

        if (result === "timeout") {
          clearRetryLocate();
          throw new Error("Timed out waiting for user to open chat widget.");
        }

        userRetryCount++;
        broadcastProgress({
          kind: "phase",
          phase: "locating",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
        });

        located = await locateChatWidget(tab.id, readerCfg);
      }

      if (!located.ok) {
        throw new Error(located.error || "Could not find (or open) the chat input.");
      }

      plan = located.plan;
      best = located.best;
      siteSnapshot = located.siteSnapshot || "";
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

    // Build DomTarget adapter — handles send/extract/pause/stop/recovery
    const domTarget = createDomTarget(tab.id, best.frameId, plan, readerCfg, {
      waitMs,
      onTurnDone: async (turnData) => {
        const { transcript: newT, turns: newTL } = domTarget.getCollectedData();
        const liveTrans = [...transcript, ...newT];
        broadcastProgress({
          kind: "turn",
          round: turnData.round,
          role: "user",
          content: turnData.userMessage,
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
        });
        broadcastProgress({
          kind: "turn",
          round: turnData.round,
          role: "assistant",
          content: turnData.assistantPreview,
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
        });
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
              transcript: liveTrans,
              turns: [...turnLog, ...newTL],
              round: liveTrans.length / 2,
              maxRounds,
              completed: false,
            },
          });
        } catch {}
      },
      onRecovery: async () => {
        broadcastProgress({
          kind: "phase",
          phase: "locating",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
        });
        const result = await resetChatSession(tab.id, readerCfg).catch(() => null);
        if (result?.ok && result.plan) {
          broadcastProgress({
            kind: "phase",
            phase: "running",
            suiteId,
            evaluatorId: evaluatorSnapshot?.id,
          });
          return result;
        }
        return null;
      },
    });

    let report = null;
    let runError = null;
    const combinedHint = [
      attackObjective ? `Attack objective: ${attackObjective}` : "",
      judgeHint || "",
    ]
      .filter(Boolean)
      .join("\n");
    // Store judgeHint on evaluatorSnapshot so runAllBrowser passes it through
    const evalWithHint = combinedHint
      ? { ...evaluatorSnapshot, judgeHint: combinedHint }
      : evaluatorSnapshot;

    try {
      report = await runAllBrowser(
        [evalWithHint],
        {
          attackLlm: attackerLlmConfig,
          judgeLlm: judgeLlmConfig,
          effort: "adaptive",
          turns: maxRounds,
          targetName: tab.url || "target",
        },
        domTarget,
        {
          initialHistory: transcript.length > 0 ? transcript : undefined,
          onProgress: (event) => {
            if (event.type === "evaluator_start") {
              broadcastProgress({
                kind: "phase",
                phase: "judging",
                suiteId,
                evaluatorId: evaluatorSnapshot?.id,
              });
            }
          },
        }
      );
    } catch (e) {
      runError = e;
    }

    const { transcript: newTranscript, turns: newTurnLog } = domTarget.getCollectedData();
    const fullTranscript = [...transcript, ...newTranscript];
    const fullTurnLog = [...turnLog, ...newTurnLog];

    // ── STOPPED path ────────────────────────────────────────────────────────
    if (runError?.code === "OPFOR_STOP" || state.OPFOR_STOP) {
      let stoppedJudgment;
      if (fullTranscript.length >= 2) {
        try {
          const lastUser =
            [...fullTranscript].reverse().find((t) => t.role === "user")?.content || "";
          const lastAssistant =
            [...fullTranscript].reverse().find((t) => t.role === "assistant")?.content || "";
          stoppedJudgment = adaptJudgeResult(
            await judgeResponse(
              evaluatorSnapshot,
              lastUser,
              lastAssistant,
              judgeModel,
              undefined,
              fullTranscript,
              {
                patternName: evaluatorSnapshot?.name,
                judgeHint: combinedHint || undefined,
              }
            )
          );
        } catch {
          stoppedJudgment = {
            verdict: "UNKNOWN",
            summary: "Run stopped before judgment could complete.",
            findings: [{ text: "Run stopped by user; partial transcript was collected." }],
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
        transcript: fullTranscript,
        turns: fullTurnLog,
        judgment: stoppedJudgment || undefined,
      };
      await persistPartialResult(stoppedResult);
      if (plan?.inputSelector && tab?.id && best?.frameId != null) {
        await persistPausedAdaptiveRun({
          tabId: tab.id,
          siteUrl: tab.url || "",
          maxRounds,
          waitMs,
          transcript: fullTranscript,
          turnLog: fullTurnLog,
          plan,
          frameId: best.frameId,
          frameUrl: best.frameUrl,
          siteSnapshot,
          suiteId,
          evaluatorSnapshot,
        }).catch(() => {});
      }
      sendResponse({ ok: false, error: "Run stopped.", paused: true });
      await clearRunStatus();
      return;
    }

    // ── ERROR path ───────────────────────────────────────────────────────────
    if (runError) {
      const runMsg = runError instanceof Error ? runError.message : String(runError);
      const attack = report?.evaluators?.[0]?.attacks?.[0];
      const errorJudgment = attack ? adaptJudgeResult(attack.judge) : null;
      if (errorJudgment && fullTranscript.length >= 2) {
        const partialResult = {
          ok: true,
          partial: true,
          stopped: false,
          stopReason: "error",
          errorMessage: runMsg,
          siteUrl: tab.url || "",
          architecture: "evaluator_adaptive_multi_turn",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          severity: evaluatorSnapshot?.severity,
          maxRounds,
          frame: { frameId: best.frameId, frameUrl: best.frameUrl },
          transcript: fullTranscript,
          turns: fullTurnLog,
          judgment: errorJudgment,
        };
        await persistPartialResult(partialResult);
        try {
          sendResponse(partialResult);
        } catch {}
      } else {
        await persistPartialResult({
          ok: false,
          partial: true,
          stopped: false,
          stopReason: "error",
          errorMessage: runMsg,
          siteUrl: tab.url || "",
          suiteId,
          evaluatorId: evaluatorSnapshot?.id,
          evaluatorName: evaluatorSnapshot?.name,
          severity: evaluatorSnapshot?.severity,
          transcript: fullTranscript,
          turns: fullTurnLog,
        }).catch(() => {});
        sendResponse({ ok: false, error: runMsg });
      }
      await clearRunStatus();
      return;
    }

    // ── SUCCESS path ─────────────────────────────────────────────────────────
    const attack = report.evaluators?.[0]?.attacks?.[0];
    const judgment = attack
      ? adaptJudgeResult(attack.judge)
      : { verdict: "UNKNOWN", summary: "No complete turns.", findings: [] };

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
      transcript: fullTranscript,
      turns: fullTurnLog,
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
    // Setup errors: LLM config failures, locate failures, resume load failures, etc.
    const msg = e instanceof Error ? e.message : String(e);
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
    }).catch(() => {});
    sendResponse({
      ok: false,
      error: msg,
      debug: { note: "Enable AI in Options; open the site chat if needed." },
    });
    await clearRunStatus();
  } finally {
    endUiRunAbortController();
  }
}
