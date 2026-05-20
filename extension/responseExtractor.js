import { sleep } from "./utils.js";
import { state } from "./state.js";

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

// ── Text-node diff ────────────────────────────────────────────────────────────

function diffTextNodes(pre, post) {
  const preNorm  = pre.map(stripLeadingTimestamp);
  const postNorm = post.map(stripLeadingTimestamp);

  let i = 0;
  while (i < preNorm.length && i < postNorm.length && preNorm[i] === postNorm[i]) i++;

  const candidates  = post.slice(i);
  const preNormSet  = new Set(preNorm);
  const filtered    = candidates.filter(t => !preNormSet.has(stripLeadingTimestamp(t)));
  const result      = filtered.length > 0 ? filtered : candidates;

  if (result.length > post.length * 0.8 && post.length > 5) {
    const fullFiltered = post.filter(t => !preNormSet.has(stripLeadingTimestamp(t)));
    return { text: fullFiltered.join("\n") };
  }
  return { text: result.join("\n") };
}

// ── Scan all frames, return the best container snapshot ───────────────────────

async function scanBestFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["frame_snapshot.js"],
  });

  const hits = results
    .filter(r => r.result?.ok)
    .map(r => ({ frameId: r.frameId, ...r.result }))
    .sort((a, b) => b.score - a.score);

  // Chat containers almost always live in iframes — prefer them over main frame
  const iframeHits = hits.filter(h => h.frameId !== 0);
  return iframeHits.length > 0 ? iframeHits[0] : hits[0] || null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Take a pre-send snapshot of the chat container.
 * Returns an object suitable for passing as prevSnapshot to extractResponse.
 */
export async function snapshotCurrentResponse(tabId, _frameId) {
  try {
    const snap = await scanBestFrame(tabId);
    if (!snap) return { text: "", messageCount: 0, botCount: 0, textNodes: [], nodeCount: 0, containerFrameId: null };
    return {
      text            : snap.fullText || "",
      messageCount    : snap.nodeCount,
      botCount        : snap.nodeCount,
      textNodes       : snap.textNodes,
      nodeCount       : snap.nodeCount,
      fullText        : snap.fullText,
      lastNodeText    : snap.lastNodeText,
      containerFrameId: snap.frameId,
      containerSel    : snap.sel,
    };
  } catch {
    return { text: "", messageCount: 0, botCount: 0, textNodes: [], nodeCount: 0, containerFrameId: null };
  }
}

/**
 * Poll until a new, complete bot response appears, then return it via text-node diff.
 *
 * prevSnapshot should be the value returned by snapshotCurrentResponse.
 * Falls back gracefully if prevSnapshot is a plain string or missing textNodes.
 */
export async function extractResponse(tabId, frameId, lastUserText = "", prevSnapshot = "") {
  const POLL_FAST        = 350;   // ms between polls while waiting / stabilising
  const POLL_SLOW        = 600;   // ms while waiting for the first change
  const GROWTH_COOLDOWN  = 3000;  // ms of no-growth required before accepting stable
  const BASE_MAX_POLLS   = 60;
  const GROWTH_MAX_WAIT  = 180_000;

  // Normalise prevSnapshot — accept both old string format and new object format
  const prev = typeof prevSnapshot === "object" && prevSnapshot !== null
    ? prevSnapshot
    : { text: String(prevSnapshot || ""), textNodes: [], nodeCount: 0, containerFrameId: null };

  // Working baseline — advances past the user-echo stage once detected
  let baseTextNodes = prev.textNodes    || [];
  let baseFullText  = prev.fullText     || prev.text || "";
  let baseNodeCount = prev.nodeCount    || 0;
  let baseLastNode  = prev.lastNodeText || "";

  const targetFrameId = prev.containerFrameId ?? frameId;

  let lastSeenFullText   = baseFullText;
  let stableCount        = 0;
  let newMessageDetected = false;
  let sawTextGrowth      = false;
  let textGrowthStreak   = 0;   // consecutive polls where text grew — ≥2 = streaming
  let lastGrowthAt       = 0;
  let growthStartedAt    = 0;
  let prevTextLen        = baseFullText.length;
  let maxPolls           = BASE_MAX_POLLS;
  let bestSnap           = null;

  // Pre-set the cached container selector so every poll takes the fast path
  // (skips walkDOM + scoring — just queries the known element directly).
  if (prev.containerSel) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [targetFrameId] },
        func: (sel) => { globalThis.__OPFOR_CONTAINER_SEL__ = sel; },
        args: [prev.containerSel],
      });
    } catch {}
  }

  // Returns true if `text` is a transient typing/thinking indicator, not a real reply.
  function isTypingIndicator(text) {
    if (!text) return false;
    const t = text.trim();
    const tl = t.toLowerCase();
    if (t.length > 120) return false;
    // Explicit "is typing" / "is thinking" patterns
    if (/\bis\s+typing\b|\bare\s+typing\b/i.test(t)) return true;
    // Short placeholder patterns
    if (/^(typing|thinking|loading|generating|please wait|one moment|working on it)\.{0,3}$/i.test(tl)) return true;
    // Dots / ellipsis only
    if (/^[.…·•\s]+$/.test(t)) return true;
    // Streaming cursor
    if (/^▋?$/.test(t)) return true;
    // "Agent/Assistant/Bot is typing…"
    if (/\b(agent|assistant|bot|support|virtual assistant)\b.*\b(typing|thinking|responding|writing)\b/i.test(tl)) return true;
    return false;
  }

  // Returns true if `text` looks like the user's own sent message echoed back.
  function isUserEcho(text) {
    if (!lastUserText || !text) return false;
    const norm = s => s.toLowerCase().replace(/\s+/g, " ").trim();
    const n = norm(text), u = norm(lastUserText);
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

    const curFullText  = snap.fullText     || "";
    const curNodeCount = snap.nodeCount    || 0;
    const curLastNode  = snap.lastNodeText || "";
    const curTextLen   = curFullText.length;

    // Text-growth tracking (implicit streaming detection).
    // Require 2+ consecutive growing polls before marking as streaming —
    // a single large jump is an atomic node appearing, not word-by-word streaming.
    if (curTextLen > prevTextLen + 5) {
      textGrowthStreak++;
      lastGrowthAt = Date.now();
      if (textGrowthStreak >= 2 && !sawTextGrowth) {
        sawTextGrowth   = true;
        growthStartedAt = Date.now();
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
      const changed = curFullText  !== baseFullText  ||
                      curNodeCount !== baseNodeCount ||
                      curLastNode  !== baseLastNode;
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
      stableCount      = 0;
      lastSeenFullText = curFullText;
    }

    bestSnap = snap;

    // Streaming needs more confirmation; atomic node appearance needs just 1 stable poll
    const neededStable = sawTextGrowth ? 2 : 1;
    if (stableCount >= neededStable) {
      const { text: rawDiff } = diffTextNodes(baseTextNodes, snap.textNodes);
      const diffLines = rawDiff.split("\n").filter(l => l.trim());
      const botLines  = diffLines.filter(l => !isUserEcho(l) && !isTypingIndicator(l));

      if (botLines.length > 0) {
        return {
          ok          : true,
          text        : botLines.join("\n"),
          typing      : false,
          intermediate: false,
          counts      : { total: curNodeCount, botCount: curNodeCount, userCount: 0 },
        };
      }

      // Diff contained only user echo and/or typing indicators — advance baseline
      // past this transient state and keep polling for the real reply.
      baseTextNodes = snap.textNodes;
      baseFullText  = curFullText;
      baseNodeCount = curNodeCount;
      baseLastNode  = curLastNode;
      lastSeenFullText   = curFullText;
      stableCount        = 0;
      newMessageDetected = false;
      await sleep(POLL_FAST);
      continue;
    }

    await sleep(sawTextGrowth ? POLL_FAST : POLL_SLOW);
  }

  // Timeout — return whatever diff we have (without echo-filtering so we don't
  // silently drop content when lastUserText wasn't available or didn't match)
  if (bestSnap) {
    const { text } = diffTextNodes(baseTextNodes, bestSnap.textNodes);
    if (text.trim()) {
      return {
        ok          : true,
        text        : text.trim(),
        typing      : false,
        intermediate: false,
        counts      : { total: bestSnap.nodeCount, botCount: bestSnap.nodeCount, userCount: 0 },
      };
    }
  }
  return { ok: false, error: "Timeout waiting for response", text: "" };
}
