import { sleep } from "./utils.js";
import { state } from "./state.js";
import { dbg } from "./debugLog.js";

// ── Timestamp normalization ───────────────────────────────────────────────────
// Many widgets prepend a changing timestamp to each message element's
// textContent ("Just now" → "1:04 am" → "Mon 3:45 PM"). Strip those before
// comparing so a timestamp flip doesn't look like a brand-new node.

function stripLeadingTimestamp(text) {
  return text
    .replace(/^\d{1,2}:\d{2}\s*(?:[ap]m)?\s*/i, "")
    .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\s+\d{1,2}:\d{2}.*?\s*/i, "")
    .replace(/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\s*/i, "")
    .replace(/^yesterday\s*(?:at\s*)?\d{1,2}:\d{2}.*?\s*/i, "")
    .replace(/^yesterday\s*/i, "")
    .replace(/^today\s*(?:at\s*)?\d{1,2}:\d{2}.*?\s*/i, "")
    .replace(/^just now\s*/i, "")
    .replace(/^\d+\s*(?:second|minute|hour|day)s?\s*ago\s*/i, "")
    .trim();
}

// Returns true if `text` is an entire line/node of date/time/read-receipt chrome
// ("Seen at 3:45 PM", "Delivered", "Today", "Aug 13, 2026") rather than reply
// content. Unlike stripLeadingTimestamp (which only strips a timestamp that's
// glued as a PREFIX onto real content on the same line), this catches a whole
// separate node rendered above/below the reply bubble — the shapes vary too
// much to enumerate ("Seen at HH:MM", "Read HH:MM", bare "Delivered", a lone
// date header) so this strips every date/time/status token out and checks
// whether anything is left over, same technique as isTypingIndicator below.
function isDateOrStatusLine(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length > 40) return false; // these footers/headers are always short
  const rest = t
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ") // clock time, e.g. "3:45 pm"
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\b/g, " ") // day-of-month number
    .replace(/\b\d{4}\b/g, " ") // year
    .replace(/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/gi, " ") // weekday
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, " ") // month
    .replace(/\b(seen|delivered|read|sent|today|yesterday|now|ago|just|at|on|by|am|pm)\b/gi, " ")
    .replace(/[^\w\s]/g, " ") // leftover punctuation (commas, dashes, dots)
    .replace(/\s+/g, " ")
    .trim();
  return rest === "";
}

// ── Text-node diff ────────────────────────────────────────────────────────────

function diffTextNodes(pre, post) {
  const preNorm = pre.map(stripLeadingTimestamp);
  const postNorm = post.map(stripLeadingTimestamp);

  let i = 0;
  while (i < preNorm.length && i < postNorm.length && preNorm[i] === postNorm[i]) i++;

  // Clean append: the common prefix covered every prior node, so the new nodes
  // are exactly the appended tail. Use this POSITIONAL diff directly — do NOT
  // value-filter against the whole prior transcript, or a reply that repeats an
  // earlier message verbatim (e.g. the same canned answer on two turns) gets
  // deduped away, leaving only the user echo → "could not extract".
  if (i >= preNorm.length) {
    return { text: post.slice(i).join("\n") };
  }

  // Prefix diverged (full re-render / reordered / virtualized transcript): fall
  // back to a value diff — surface post nodes whose text isn't present in pre.
  const preSet = new Set(preNorm);
  const valueNew = post.filter((t) => !preSet.has(stripLeadingTimestamp(t)));
  return { text: (valueNew.length ? valueNew : post.slice(i)).join("\n") };
}

// ── Scan all frames, return the best container snapshot ───────────────────────

async function scanBestFrame(tabId) {
  let results;
  try {
    results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["frame_snapshot.js"],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("scanBestFrame timed out")), 15_000)
      ),
    ]);
  } catch {
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["frame_snapshot.js"],
      });
    } catch {
      return null;
    }
  }

  const hits = (results || [])
    .filter((r) => r.result?.ok)
    .map((r) => ({ frameId: r.frameId, ...r.result }))
    .sort((a, b) => b.score - a.score);

  const iframeHits = hits.filter((h) => h.frameId !== 0);
  return iframeHits.length > 0 ? iframeHits[0] : hits[0] || null;
}

// Snapshot one specific frame (the frame the message is actually sent into).
async function snapshotFrame(tabId, frameId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ["frame_snapshot.js"],
  });
  const r = results?.[0];
  return r?.result ? { frameId: r.frameId, ...r.result } : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Take a pre-send snapshot of the chat container.
 * Returns an object suitable for passing as prevSnapshot to extractResponse.
 */
export async function snapshotCurrentResponse(tabId, frameId) {
  const empty = (containerFrameId) => ({
    text: "",
    messageCount: 0,
    botCount: 0,
    textNodes: [],
    nodeCount: 0,
    containerFrameId,
  });
  try {
    // Anchor the response read to the SAME frame the message is sent into. The
    // response always appears in the send frame's transcript, so reading from a
    // different (higher-"scoring") iframe is the main cause of missed replies.
    // Only when no send frame is known do we fall back to scanning all frames.
    let snap = null;
    const hasFrame = frameId !== null && frameId !== undefined;
    if (hasFrame) {
      snap = await snapshotFrame(tabId, frameId);
      // Send frame has no chat container yet (e.g. empty transcript on turn 1):
      // still anchor reads to it — polling picks up the container once a reply renders.
      if (!snap?.ok) return empty(frameId);
    } else {
      snap = await scanBestFrame(tabId);
      if (!snap) return empty(null);
    }
    return {
      text: snap.fullText || "",
      messageCount: snap.nodeCount,
      botCount: snap.nodeCount,
      textNodes: snap.textNodes,
      nodeCount: snap.nodeCount,
      fullText: snap.fullText,
      lastNodeText: snap.lastNodeText,
      containerFrameId: snap.frameId ?? (hasFrame ? frameId : null),
      containerSel: snap.sel,
    };
  } catch {
    return empty(hasFrameIdSafe(frameId));
  }
}

function hasFrameIdSafe(frameId) {
  return frameId === null || frameId === undefined ? null : frameId;
}

/**
 * Poll until a new, complete bot response appears, then return it via text-node diff.
 *
 * prevSnapshot should be the value returned by snapshotCurrentResponse.
 * Falls back gracefully if prevSnapshot is a plain string or missing textNodes.
 */
export async function extractResponse(tabId, frameId, lastUserText = "", prevSnapshot = "") {
  const POLL_FAST = 350;
  const POLL_SLOW = 600;
  const GROWTH_COOLDOWN = 3000;
  const BASE_MAX_POLLS = 60;
  const GROWTH_MAX_WAIT = 180_000;

  dbg("extract", "extractResponse started", {
    frameId,
    lastUserTextLen: lastUserText?.length,
    prevSnapshotType: typeof prevSnapshot === "object" ? "object" : "string",
    prevNodeCount: typeof prevSnapshot === "object" ? prevSnapshot?.nodeCount : undefined,
  });

  // Normalise prevSnapshot — accept both old string format and new object format
  const prev =
    typeof prevSnapshot === "object" && prevSnapshot !== null
      ? prevSnapshot
      : { text: String(prevSnapshot || ""), textNodes: [], nodeCount: 0, containerFrameId: null };

  // Working baseline — advances past the user-echo stage once detected
  let baseTextNodes = prev.textNodes || [];
  let baseFullText = prev.fullText || prev.text || "";
  let baseNodeCount = prev.nodeCount || 0;
  let baseLastNode = prev.lastNodeText || "";

  const targetFrameId = prev.containerFrameId ?? frameId;

  let lastSeenFullText = baseFullText;
  let stableCount = 0;
  let newMessageDetected = false;
  let sawTextGrowth = false;
  let textGrowthStreak = 0; // consecutive polls where text grew — ≥2 = streaming
  let lastGrowthAt = 0;
  let growthStartedAt = 0;
  let prevTextLen = baseFullText.length;
  let maxPolls = BASE_MAX_POLLS;
  let bestSnap = null;

  // Pre-set the cached container selector so every poll takes the fast path
  // (skips walkDOM + scoring — just queries the known element directly).
  if (prev.containerSel) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [targetFrameId] },
        func: (sel) => {
          globalThis.__OPFOR_CONTAINER_SEL__ = sel;
        },
        args: [prev.containerSel],
      });
    } catch {
      /* swallowed */
    }
  }

  // Words that only ever show up wrapping a placeholder ("Agent is thinking...",
  // "Kai: still generating", "one moment please") — never inside a real reply's
  // opening words, since a real reply is addressing the user's actual question.
  const PLACEHOLDER_FILLER_WORDS = new Set([
    "agent",
    "assistant",
    "bot",
    "ai",
    "support",
    "system",
    "virtual",
    "is",
    "are",
    "am",
    "currently",
    "still",
    "now",
    "just",
    "please",
    "a",
  ]);
  const PLACEHOLDER_CORE_WORDS = new Set([
    "typing",
    "thinking",
    "loading",
    "generating",
    "responding",
    "writing",
    "processing",
    "analyzing",
    "searching",
    "fetching",
    "working",
    "wait",
    "waiting",
    "moment",
    "hold",
    "on",
    "one",
    "sec",
    "second",
    "it",
  ]);

  // Returns true if `text` is a transient typing/thinking indicator, not a real reply.
  // Dot/ellipsis count and exact wording vary by UI ("Thinking…", "Thinking....",
  // "Agent is thinking", "Kai: still generating") so this normalizes rather than
  // matching a fixed string list: strip punctuation and known filler words, then
  // check whether every remaining word is a known placeholder word AND at least
  // one of them is a "core" placeholder verb (so real short replies like "Yes,
  // I can help with that" don't get swallowed just for being short).
  function isTypingIndicator(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length > 80) return false;
    // Dots / ellipsis only, or a bare streaming cursor
    if (/^[.…·•\s]+$/.test(t)) return true;
    if (/^▋?$/.test(t)) return true;

    const words = t
      .toLowerCase()
      .replace(/[…]/g, " ") // ellipsis char
      .replace(/[^a-z\s]/g, " ") // strip remaining punctuation/digits
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return false;

    const hasCore = words.some((w) => PLACEHOLDER_CORE_WORDS.has(w));
    const allKnown = words.every(
      (w) => PLACEHOLDER_CORE_WORDS.has(w) || PLACEHOLDER_FILLER_WORDS.has(w)
    );
    return hasCore && allKnown;
  }

  // Returns true if `text` looks like the user's own sent message echoed back.
  function isUserEcho(text) {
    if (!lastUserText || !text) return false;
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const n = norm(text),
      u = norm(lastUserText);
    if (!n || !u) return false;
    if (n === u) return true;
    if (u.length > 8 && n.includes(u)) return true;
    if (n.length > 8 && u.includes(n)) return true;
    return false;
  }

  async function pollFrame() {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [targetFrameId] },
      files: ["frame_snapshot.js"],
    });
    return results?.[0]?.result || null;
  }

  for (let poll = 0; poll < maxPolls; poll++) {
    if (state.OPFOR_STOP) break;

    const snap = await pollFrame().catch(() => null);
    if (!snap?.ok) {
      await sleep(POLL_FAST);
      continue;
    }

    const curFullText = snap.fullText || "";
    const curNodeCount = snap.nodeCount || 0;
    const curLastNode = snap.lastNodeText || "";
    const curTextLen = curFullText.length;

    // Text-growth tracking (implicit streaming detection).
    // Require 2+ consecutive growing polls before marking as streaming —
    // a single large jump is an atomic node appearing, not word-by-word streaming.
    if (curTextLen > prevTextLen + 5) {
      textGrowthStreak++;
      lastGrowthAt = Date.now();
      if (textGrowthStreak >= 2 && !sawTextGrowth) {
        sawTextGrowth = true;
        growthStartedAt = Date.now();
        dbg("extract", "Streaming detected (text growing across polls)", { poll, curTextLen });
      }
      if (sawTextGrowth && poll >= maxPolls - 5) {
        const elapsed = Date.now() - growthStartedAt;
        if (elapsed < GROWTH_MAX_WAIT) maxPolls = Math.min(maxPolls + 10, 200);
      }
    } else {
      textGrowthStreak = 0;
    }
    prevTextLen = Math.max(prevTextLen, curTextLen);

    // Phase A: wait for any change from the current baseline
    if (!newMessageDetected) {
      const changed =
        curFullText !== baseFullText ||
        curNodeCount !== baseNodeCount ||
        curLastNode !== baseLastNode;
      if (!changed) {
        await sleep(POLL_SLOW);
        continue;
      }
      newMessageDetected = true;
    }

    // Respect streaming growth cooldown before declaring stable
    if (sawTextGrowth && lastGrowthAt && Date.now() - lastGrowthAt < GROWTH_COOLDOWN) {
      stableCount = 0;
      await sleep(POLL_FAST);
      continue;
    }

    // Phase C: stability check
    if (curFullText === lastSeenFullText) {
      stableCount++;
    } else {
      stableCount = 0;
      lastSeenFullText = curFullText;
    }

    bestSnap = snap;

    // Streaming needs more confirmation; atomic node appearance needs just 1 stable poll
    const neededStable = sawTextGrowth ? 2 : 1;
    if (stableCount >= neededStable) {
      const { text: rawDiff } = diffTextNodes(baseTextNodes, snap.textNodes);
      const diffLines = rawDiff.split("\n").filter((l) => l.trim());
      // Drop pure-timestamp lines (e.g. message-bubble "3:45 PM" footers) that now
      // surface as their own nodes — they strip to empty and aren't real reply text.
      const isTimestampOnly = (l) => stripLeadingTimestamp(l).trim() === "";
      const botLines = diffLines.filter(
        (l) =>
          !isUserEcho(l) && !isTypingIndicator(l) && !isTimestampOnly(l) && !isDateOrStatusLine(l)
      );

      if (botLines.length > 0) {
        dbg("extract", "Response extracted successfully", {
          poll,
          botLineCount: botLines.length,
          textLen: botLines.join("\n").length,
          textPreview: botLines.join("\n").slice(0, 200),
          streaming: sawTextGrowth,
        });
        return {
          ok: true,
          text: botLines.join("\n"),
          typing: false,
          intermediate: false,
          counts: { total: curNodeCount, botCount: curNodeCount, userCount: 0 },
        };
      }

      // Diff contained only user echo and/or typing indicators — advance baseline
      // past this transient state and keep polling for the real reply.
      dbg("extract", "Skipped noise diff, advancing baseline", {
        poll,
        droppedLines: diffLines.slice(0, 5),
      });
      baseTextNodes = snap.textNodes;
      baseFullText = curFullText;
      baseNodeCount = curNodeCount;
      baseLastNode = curLastNode;
      lastSeenFullText = curFullText;
      stableCount = 0;
      newMessageDetected = false;
      await sleep(POLL_FAST);
      continue;
    }

    await sleep(sawTextGrowth ? POLL_FAST : POLL_SLOW);
  }

  dbg("extract", "Polling exhausted — checking for partial result", {
    maxPolls,
    sawTextGrowth,
    hasBestSnap: !!bestSnap,
  });
  if (bestSnap) {
    const { text } = diffTextNodes(baseTextNodes, bestSnap.textNodes);
    if (text.trim()) {
      return {
        ok: true,
        text: text.trim(),
        typing: false,
        intermediate: false,
        counts: { total: bestSnap.nodeCount, botCount: bestSnap.nodeCount, userCount: 0 },
      };
    }
  }
  dbg("extract", "TIMEOUT — no response extracted");
  return { ok: false, error: "Timeout waiting for response", text: "" };
}
