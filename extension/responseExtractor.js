import { sleep } from "./utils.js";
import { state } from "./state.js";

export async function extractResponseOnce(tabId, frameId, lastUserText = "") {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (t) => {
        globalThis.__OPFOR_LAST_USER__ = String(t || "");
      },
      args: [lastUserText],
    });
  } catch {}

  const res = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ["frame_extract.js"],
  });
  return res?.[0]?.result;
}

export async function snapshotCurrentResponse(tabId, frameId) {
  try {
    const result = await extractResponseOnce(tabId, frameId, "");
    return {
      text: result?.ok ? (result.text || "").trim() : "",
      messageCount: result?.counts?.total || 0,
      botCount: result?.counts?.botCount || 0,
    };
  } catch {
    return { text: "", messageCount: 0, botCount: 0 };
  }
}

/**
 * Smart polling extractor that waits for a NEW, COMPLETE bot response.
 *
 * Three-phase detection:
 *   Phase A — "New message appeared": messageCount increased or text differs from pre-send snapshot.
 *   Phase B — "Bot finished typing": no typing/streaming indicators visible.
 *   Phase C — "Response is stable": text unchanged for N consecutive polls.
 */
export async function extractResponse(tabId, frameId, lastUserText = "", prevSnapshot = "") {
  const POLL_FAST = 800;
  const POLL_SLOW = 1500;
  const POLL_CONFIRM = 1200;
  const BASE_MAX_POLLS = 50;
  const TYPING_MAX_WAIT = 90_000;
  const GROWTH_MAX_WAIT = 180_000;

  const normalize = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const normUserMsg = normalize(lastUserText);

  function looksLikeOurMessage(text) {
    if (!normUserMsg || !text) return false;
    const n = normalize(text);
    if (!n) return false;
    if (n === normUserMsg) return true;
    if (normUserMsg.length > 10 && n.includes(normUserMsg)) return true;
    if (n.length > 10 && normUserMsg.includes(n)) return true;
    if (normUserMsg.length > 15 && n.length > 15) {
      const uWords = new Set(normUserMsg.split(/\s+/));
      const tWords = n.split(/\s+/);
      if (tWords.length >= 3) {
        const overlap = tWords.filter((w) => uWords.has(w)).length;
        if (overlap / tWords.length > 0.7) return true;
      }
    }
    return false;
  }

  const prev =
    typeof prevSnapshot === "object" && prevSnapshot !== null
      ? prevSnapshot
      : { text: String(prevSnapshot || ""), messageCount: 0, botCount: 0 };
  const prevNorm = normalize(prev.text);
  const prevMsgCount = prev.messageCount || 0;
  const prevBotCount = prev.botCount || 0;

  let lastSeenText = "";
  let stableCount = 0;
  let newMessageDetected = false;
  let typingStartedAt = 0;
  let sawTypingIndicator = false;
  let sawIntermediate = false;
  let bestResult = null;
  let lastTextChangeAt = 0;

  // Text-growth tracking: implicit streaming detection for sites without CSS indicators.
  let prevTextLen = 0;
  let textGrowthStreak = 0;
  let sawTextGrowth = false;
  let lastGrowthAt = 0;
  let growthStartedAt = 0;
  let maxPolls = BASE_MAX_POLLS;

  for (let poll = 0; poll < maxPolls; poll++) {
    if (state.OPFOR_STOP) break;

    const result = await extractResponseOnce(tabId, frameId, lastUserText);
    const curCounts = result?.counts || {};
    const curTotal = curCounts.total || 0;
    const curBot = curCounts.botCount || 0;
    const isTyping = !!(result?.typing || result?.error === "bot_still_typing");
    const isIntermediate = !!result?.intermediate;

    if (isTyping) sawTypingIndicator = true;
    if (isIntermediate) sawIntermediate = true;

    // --- Text growth detection ---
    const curTextLen = result?.ok ? (result.text || "").length : 0;
    if (curTextLen > prevTextLen + 5) {
      textGrowthStreak++;
      lastGrowthAt = Date.now();
      if (textGrowthStreak >= 2 && !sawTextGrowth) {
        sawTextGrowth = true;
        growthStartedAt = Date.now();
      }
      if (sawTextGrowth && poll >= maxPolls - 5) {
        const elapsed = Date.now() - growthStartedAt;
        if (elapsed < GROWTH_MAX_WAIT) {
          maxPolls = Math.min(maxPolls + 10, 200);
        }
      }
    } else if (curTextLen <= prevTextLen) {
      textGrowthStreak = 0;
    }
    prevTextLen = Math.max(prevTextLen, curTextLen);

    // Echo guard: skip if extracted text is our own message.
    if (result?.ok && result.text && looksLikeOurMessage(result.text)) {
      await sleep(POLL_FAST);
      continue;
    }

    // Phase A: Detect new message.
    if (!newMessageDetected) {
      const botCountIncreased = prevBotCount > 0 && curBot > prevBotCount;
      const totalIncreased = prevMsgCount > 0 && curTotal > prevMsgCount;
      const curNorm = result?.ok ? normalize(result.text) : "";
      const textChanged = curNorm && prevNorm && curNorm !== prevNorm;
      const noPrev = !prevNorm && !prevMsgCount;

      // Prefer bot count increase; total alone may just be the user's message appearing.
      const countIncreased =
        botCountIncreased || (totalIncreased && !looksLikeOurMessage(result?.text));

      if (countIncreased || textChanged || (noPrev && result?.ok && result.text)) {
        newMessageDetected = true;
        lastTextChangeAt = Date.now();
      } else {
        if (isTyping || isIntermediate) {
          if (!typingStartedAt) typingStartedAt = Date.now();
          if (Date.now() - typingStartedAt > TYPING_MAX_WAIT) break;
        }
        await sleep(POLL_FAST);
        continue;
      }
    }

    // Phase B: Wait for typing/streaming to finish.
    if (isTyping || isIntermediate) {
      if (!typingStartedAt) typingStartedAt = Date.now();
      if (Date.now() - typingStartedAt > TYPING_MAX_WAIT) {
        if (result?.ok && result.text && !isIntermediate) return result;
        break;
      }
      stableCount = 0;
      lastSeenText = result?.ok ? result.text : "";
      bestResult = result?.ok && !isIntermediate ? result : bestResult;
      if (result?.ok && result.text) lastTextChangeAt = Date.now();
      await sleep(POLL_FAST);
      continue;
    }
    typingStartedAt = 0;

    if (!result?.ok || !result.text) {
      stableCount = 0;
      await sleep(POLL_FAST);
      continue;
    }

    bestResult = result;

    // Phase C: Stability check.
    const curNorm = normalize(result.text);
    if (curNorm === normalize(lastSeenText)) {
      stableCount++;
    } else {
      stableCount = 0;
      lastSeenText = result.text;
      lastTextChangeAt = Date.now();
    }

    // If text was recently growing, don't accept stability yet — the model
    // may be pausing between sections or waiting on a tool call.
    const growthCooldown = sawTextGrowth ? 8000 : 0;
    if (sawTextGrowth && lastGrowthAt && Date.now() - lastGrowthAt < growthCooldown) {
      stableCount = 0;
      await sleep(POLL_FAST);
      continue;
    }

    const neededStable = sawTextGrowth || sawIntermediate ? 3 : sawTypingIndicator ? 1 : 2;

    if (stableCount >= neededStable) {
      const sinceLast = Date.now() - lastTextChangeAt;
      const confirmWait = sawTextGrowth ? 8000 : sawIntermediate ? 4000 : 3000;
      if (sinceLast < confirmWait) {
        await sleep(confirmWait - sinceLast);
        const verify = await extractResponseOnce(tabId, frameId, lastUserText);
        if (verify?.ok && normalize(verify.text) !== curNorm) {
          stableCount = 0;
          lastSeenText = verify.text;
          lastTextChangeAt = Date.now();
          bestResult = verify.intermediate ? bestResult : verify;
          if (verify.typing || verify.intermediate) {
            sawTypingIndicator = sawTypingIndicator || !!verify.typing;
            sawIntermediate = sawIntermediate || !!verify.intermediate;
          }
          const verifyLen = (verify.text || "").length;
          if (verifyLen > prevTextLen + 5) {
            lastGrowthAt = Date.now();
            prevTextLen = verifyLen;
          }
          continue;
        }
        if (verify?.typing || verify?.intermediate) {
          stableCount = 0;
          sawTypingIndicator = sawTypingIndicator || !!verify.typing;
          sawIntermediate = sawIntermediate || !!verify.intermediate;
          continue;
        }
      }
      if (!looksLikeOurMessage(result.text)) return result;
      stableCount = 0;
      await sleep(POLL_FAST);
      continue;
    }

    await sleep(
      sawTextGrowth || sawIntermediate ? POLL_CONFIRM : sawTypingIndicator ? POLL_FAST : POLL_SLOW
    );
  }

  if (bestResult?.ok && bestResult.text && !looksLikeOurMessage(bestResult.text)) return bestResult;
  const finalResult = await extractResponseOnce(tabId, frameId, lastUserText);
  if (finalResult?.ok && looksLikeOurMessage(finalResult.text)) {
    return { ok: false, error: "Only the user's own message was found.", text: "" };
  }
  return finalResult;
}
