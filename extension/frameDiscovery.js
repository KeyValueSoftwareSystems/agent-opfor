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
  } catch {}

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

  frames.sort((a, b) => {
    const boost = embeddedChatBoost(b) - embeddedChatBoost(a);
    if (boost !== 0) return boost;
    return (b.chatScore || 0) - (a.chatScore || 0) || (b.inputCount || 0) - (a.inputCount || 0);
  });
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
    if (frames.some((f) => (f.chatScore || 0) > 0)) break;
  }
  if (!frames.length) throw new Error("No frames collected.");

  frames.sort((a, b) => {
    const boost = embeddedChatBoost(b) - embeddedChatBoost(a);
    if (boost !== 0) return boost;
    return (b.chatScore || 0) - (a.chatScore || 0) || (b.inputCount || 0) - (a.inputCount || 0);
  });
  return { frames, best: frames[0] };
}
