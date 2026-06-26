import { sleep } from "./utils.js";

export async function collectFrames(tabId) {
  const frameSnapshots = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["frame_collect.js"],
  });

  return (frameSnapshots || [])
    .map((r) => ({
      frameId: r.frameId,
      snapshot: r.result?.snapshot,
      frameUrl: r.result?.frameUrl,
      inputCount: r.result?.inputCount ?? 0,
      chatScore: r.result?.chatScore ?? 0,
      bestInputSelector: r.result?.bestInputSelector ?? "",
      bestInputScore: r.result?.bestInputScore ?? 0,
      bestSendSelector: r.result?.bestSendSelector ?? "",
    }))
    .filter((f) => typeof f.snapshot === "string" && f.snapshot.length > 0);
}

/** Boost score for frames that are clearly dedicated chat surfaces (not the parent page). */
export function embeddedChatBoost(frame) {
  const url = String(frame?.frameUrl || "").toLowerCase();
  const s = String(frame?.snapshot || "");

  try {
    const path = new URL(url).pathname.toLowerCase();
    if (
      /\/chat(\/|$|\?|#)/.test(path) ||
      /\/myra\//.test(path) ||
      /\/messages?\//.test(path) ||
      /\/support\/chat/.test(path) ||
      /\/livechat/.test(path)
    ) {
      return 500;
    }
  } catch {
    /* swallowed */
  }

  if (/chat|livechat|helpchat|chatbot|helpchatbot|support-chat|chat-widget/.test(url)) return 400;
  if (
    /intercom|zendesk|drift|crisp|freshchat|genesys|hubspot|tawk|tidio|ada\.cx|forethought|kore\.ai|salesforce|gorgias|gladly|dixa|richpanel|reamaze|re:amaze|helpscout|front\.com|olark|liveperson|kayako/.test(
      url
    )
  )
    return 350;

  if (s.includes("CHAT_SIGNALS:") && (frame.chatScore || 0) >= 8) return 200;

  return 0;
}

/**
 * Collect frames sorted by chat relevance. Does NOT retry — caller handles timing.
 */
export async function pickChatFrame(tabId) {
  const frames = await collectFrames(tabId);
  if (!frames.length) throw new Error("No frames collected.");

  frames.sort(sortByChatRelevance);
  return { frames, best: frames[0] };
}

/**
 * Collect frames, retrying until a frame with chatScore > 0 appears or maxRetries expires.
 * Use after a launcher click to wait for the chat widget/iframe to load.
 */
export async function pickChatFrameWithRetry(tabId, { maxRetries = 6, intervalMs = 1200 } = {}) {
  let frames = [];
  for (let i = 0; i < maxRetries; i++) {
    await sleep(i === 0 ? 600 : intervalMs);
    frames = await collectFrames(tabId);
    // Wait for the chat INPUT itself, not merely a chat signal. chatScore can go
    // positive from container markup while the composer is still mounting (open
    // animation, lazy render, input shown only after a greeting) — breaking on
    // chatScore alone snapshots too early and misses the input.
    if (frames.some((f) => (f.bestInputScore || 0) > 0)) break;
  }
  if (!frames.length) throw new Error("No frames collected.");

  frames.sort(sortByChatRelevance);
  return { frames, best: frames[0] };
}

// Shared ranking: embedded-chat URL boost, then a real input, then chat signal.
function sortByChatRelevance(a, b) {
  const boost = embeddedChatBoost(b) - embeddedChatBoost(a);
  if (boost !== 0) return boost;
  return (
    (b.bestInputScore || 0) - (a.bestInputScore || 0) ||
    (b.chatScore || 0) - (a.chatScore || 0) ||
    (b.inputCount || 0) - (a.inputCount || 0)
  );
}
