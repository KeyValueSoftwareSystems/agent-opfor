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
  const MAX_POLLS = 50;
  const TYPING_MAX_WAIT = 90_000;

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

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (state.OPFOR_STOP) break;

    const result = await extractResponseOnce(tabId, frameId, lastUserText);
    const curCounts = result?.counts || {};
    const curTotal = curCounts.total || 0;
    const curBot = curCounts.botCount || 0;
    const isTyping = !!(result?.typing || result?.error === "bot_still_typing");
    const isIntermediate = !!result?.intermediate;

    if (isTyping) sawTypingIndicator = true;
    if (isIntermediate) sawIntermediate = true;

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

    // Needed stable reads: more if we saw intermediate (tool execution).
    const neededStable = sawIntermediate ? 3 : sawTypingIndicator ? 1 : 2;

    if (stableCount >= neededStable) {
      const sinceLast = Date.now() - lastTextChangeAt;
      const confirmWait = sawIntermediate ? 4000 : 3000;
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

    await sleep(sawIntermediate ? POLL_CONFIRM : sawTypingIndicator ? POLL_FAST : POLL_SLOW);
  }

  if (bestResult?.ok && bestResult.text && !looksLikeOurMessage(bestResult.text)) return bestResult;
  const finalResult = await extractResponseOnce(tabId, frameId, lastUserText);
  if (finalResult?.ok && looksLikeOurMessage(finalResult.text)) {
    return { ok: false, error: "Only the user's own message was found.", text: "" };
  }
  return finalResult;
}
