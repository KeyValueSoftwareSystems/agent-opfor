function isVisible(el) {
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  if (rect.width < 10 || rect.height < 10) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function* walkNodes(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    yield node;

    if (node instanceof Element) {
      if (node.shadowRoot) stack.push(node.shadowRoot);
      const children = node.children;
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      continue;
    }

    if (node instanceof ShadowRoot || node instanceof Document || node instanceof DocumentFragment) {
      const children = node.children || node.childNodes;
      if (!children) continue;
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
}

function queryAllDeep(selector) {
  const results = [];
  for (const node of walkNodes(document)) {
    if (!(node instanceof Element)) continue;
    try {
      if (node.matches(selector)) results.push(node);
    } catch {}
  }
  return results;
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function extractFromRoleLog() {
  const logs = queryAllDeep("[role='log']")
    .filter((el) => el instanceof Element && isVisible(el))
    .map((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const score = (label.includes("chat") ? 5 : 0) + (label.includes("message") ? 3 : 0) + (label.includes("messages") ? 3 : 0);
      return { el, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = logs[0]?.el;
  if (!best) return null;

  // Try list items first (common chat transcript structure)
  const items = Array.from(best.querySelectorAll("li, article, div"))
    .map((n) => ({ n, t: textOf(n) }))
    .filter((x) => x.t.length > 0);
  const last = items[items.length - 1]?.t;
  return last || textOf(best) || null;
}

function extractByCommonLabels() {
  const candidates = queryAllDeep("[aria-label]")
    .filter((el) => el instanceof Element && isVisible(el))
    .map((el) => ({ el, label: (el.getAttribute("aria-label") || "").toLowerCase() }))
    .filter((x) => x.label.includes("chat") && (x.label.includes("message") || x.label.includes("messages")));
  if (!candidates.length) return null;
  const best = candidates[0].el;
  return textOf(best) || null;
}

/** AOL ais-chatbot / similar: ul.chatbot__dialogue + li.chatbot__message--is-bot (no role=log). */
function extractFromVendorChatbotDialogue() {
  const dialogues = queryAllDeep('[class*="chatbot__dialogue"]').filter((el) => el instanceof Element && isVisible(el));
  const dialogue = dialogues[0];
  if (!dialogue) return null;

  const botMsgs = Array.from(dialogue.querySelectorAll('[class*="chatbot__message--is-bot"]')).filter(
    (el) => el instanceof Element && isVisible(el)
  );
  const lastBot = botMsgs[botMsgs.length - 1];
  if (!lastBot) return null;

  const textNode =
    lastBot.querySelector('[class*="chatbot__message__text"]') ||
    lastBot.querySelector(".chatbot__message__text");
  const t = textOf(textNode || lastBot);
  return t.length ? t : null;
}

/** Generic assistant bubbles (data attrs, common class names). */
function extractFromAssistantBubbles() {
  const sel = [
    "[data-message-author-role='assistant']",
    "[data-author='assistant']",
    "[data-from='agent']",
    "[data-from='bot']",
    "[data-sender='agent']",
    "[class*='assistant-message']",
    "[class*='AgentMessage']",
    "[class*='from-agent']",
    "[class*='bot-message']",
    "[class*='incoming-message']",
    "[class*='cp-message' i]",
    "[class*='chilipiper' i]"
  ].join(", ");
  const els = queryAllDeep(sel).filter((el) => el instanceof Element && isVisible(el));
  if (!els.length) return null;
  const sorted = els.slice().sort((a, b) => {
    const ra = a.getBoundingClientRect().bottom;
    const rb = b.getBoundingClientRect().bottom;
    return ra - rb;
  });
  const last = sorted[sorted.length - 1];
  const inner =
    last.querySelector("[class*='message-content'], [class*='markdown'], [class*='text'], p") || last;
  const t = textOf(inner);
  return t.length ? t : null;
}

function findComposerElement() {
  const candidates = queryAllDeep('textarea:not([readonly]), [contenteditable="true"]').filter(
    (el) => el instanceof HTMLElement && isVisible(el)
  );
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const ra = a.getBoundingClientRect().top;
    const rb = b.getBoundingClientRect().top;
    return rb - ra;
  })[0];
}

/** Sales/chat embeds (Chili Piper, Intercom-style): message rows with "message" / "bubble" in class, above the composer. */
function extractFromMessageLikeRows() {
  const composer = findComposerElement();
  const composerTop = composer?.getBoundingClientRect?.().top ?? Infinity;
  const patterns = [
    '[class*="message" i]',
    '[class*="Message"]',
    '[class*="bubble" i]',
    '[class*="Bubble"]',
    '[data-testid*="message" i]'
  ];
  const seen = new Set();
  const candidates = [];
  for (const pat of patterns) {
    for (const el of queryAllDeep(pat)) {
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      const cls = ((el.className || "") + "").toLowerCase();
      if (cls.includes("composer") || cls.includes("input-area") || cls.includes("textarea-wrap")) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > composerTop - 6) continue;
      if (r.height > 900 || r.width < 24) continue;
      const t = textOf(el);
      if (t.length < 12 || t.length > 12_000) continue;
      candidates.push({ el, bottom: r.bottom, area: r.width * r.height, t });
    }
  }
  const leaves = candidates.filter((a) => !candidates.some((b) => a !== b && b.el.contains(a.el)));
  if (!leaves.length) return null;
  leaves.sort((a, b) => b.bottom - a.bottom);
  const best = leaves[0];
  return best?.t || null;
}

/** Bottom-most text block sitting above the composer (fallback when vendors use hashed CSS). */
function extractLeafAboveComposer() {
  const composer = findComposerElement();
  if (!(composer instanceof HTMLElement)) return null;
  const cTop = composer.getBoundingClientRect().top;
  const blocks = [];
  for (const el of queryAllDeep("div, p, li, article, section")) {
    if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
    if (composer.contains(el) || el.contains(composer)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > cTop - 8) continue;
    if (r.height > 700 || r.height < 14) continue;
    const t = textOf(el);
    if (t.length < 15 || t.length > 10_000) continue;
    blocks.push({ el, bottom: r.bottom, area: r.width * r.height, t });
  }
  const leaves = blocks.filter((a) => !blocks.some((b) => a !== b && b.el.contains(a.el)));
  if (!leaves.length) return null;
  leaves.sort((a, b) => {
    const d = b.bottom - a.bottom;
    if (Math.abs(d) > 2) return d;
    return a.area - b.area;
  });
  return leaves[0]?.t || null;
}

/** Live regions sometimes mirror the latest bot line (Drift, Chili Piper, etc.). */
function extractFromAriaLiveRegion() {
  const regions = queryAllDeep('[aria-live="polite"], [aria-live="assertive"]')
    .filter((el) => el instanceof Element && isVisible(el))
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  for (const region of regions) {
    const t = textOf(region);
    if (t.length >= 15 && t.length < 8000) return t;
    const ps = Array.from(region.querySelectorAll("p, div")).filter((x) => isVisible(x));
    const lastP = ps[ps.length - 1];
    if (lastP) {
      const tp = textOf(lastP);
      if (tp.length >= 12) return tp;
    }
  }
  return null;
}

function extractFromRoleFeed() {
  const feeds = queryAllDeep('[role="feed"], [role="list"][aria-label*="message" i]')
    .filter((el) => el instanceof Element && isVisible(el));
  const feed = feeds[0];
  if (!feed) return null;
  const items = Array.from(feed.querySelectorAll("[role='article'], li, [class*='message' i]"))
    .filter((el) => el instanceof Element && isVisible(el));
  const last = items[items.length - 1];
  if (!last) return null;
  const t = textOf(last);
  return t.length >= 10 ? t : null;
}

(() => {
  const text =
    extractFromVendorChatbotDialogue() ||
    extractFromAssistantBubbles() ||
    extractFromMessageLikeRows() ||
    extractLeafAboveComposer() ||
    extractFromAriaLiveRegion() ||
    extractFromRoleFeed() ||
    extractFromRoleLog() ||
    extractByCommonLabels();
  if (!text) return { ok: false, error: "No transcript text found in this frame." };
  return { ok: true, text };
})();

