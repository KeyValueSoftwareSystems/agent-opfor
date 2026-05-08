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

// True if `el` is itself an interactive control or sits inside one
// (action chips, quick-reply pills, "Chat with Sales now" CTAs, etc.).
function isInteractive(el) {
  for (let n = el; n instanceof Element; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return true;
    const role = (n.getAttribute && n.getAttribute("role")) || "";
    if (/^(button|link|menuitem|option|tab)$/i.test(role)) return true;
    const cls = ((n.className || "") + "").toLowerCase();
    if (
      cls.includes("suggestion") ||
      cls.includes("quick-repl") ||
      cls.includes("quickrepl") ||
      cls.includes("quick_repl") ||
      cls.includes("cta") ||
      cls.includes("call-to-action") ||
      cls.includes("action-button") ||
      cls.includes("action_button") ||
      cls.includes("chips") ||
      cls.includes("chip-")
    )
      return true;
  }
  return false;
}

// Boilerplate / disclaimer / branding text that frequently sticks to the
// bottom of embedded chat widgets (Chili Piper, Drift, Intercom, etc.).
function looksLikeFooter(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("provides this chat") ||
    t.includes("you agree this chat") ||
    t.includes("may be recorded") ||
    t.includes("privacy statement") ||
    t.includes("privacy policy") ||
    t.includes("terms of service") ||
    t.includes("powered by") ||
    /^©\s/.test(text) ||
    t.startsWith("by chatting") ||
    t.includes("cookie policy")
  );
}

// Skip pinned/sticky chrome (footer disclaimers, persistent CTA bars).
function isPinned(el) {
  for (let n = el, hops = 0; n instanceof Element && hops < 6; n = n.parentElement, hops++) {
    try {
      const pos = window.getComputedStyle(n).position;
      if (pos === "sticky" || pos === "fixed") return true;
    } catch {}
  }
  return false;
}

function isExtractable(el, text) {
  if (!(el instanceof Element)) return false;
  if (isInteractive(el)) return false;
  if (isPinned(el)) return false;
  if (isLikelyButtonRow(el)) return false;
  if (looksLikeFooter(text || textOf(el))) return false;
  return true;
}

// Returns true when most of the element's visible text actually lives inside
// <button> or role="button" descendants — i.e. it's an action-chip row, not
// a message bubble. Treats <a> as content (legit links inside replies).
function isLikelyButtonRow(el) {
  if (!(el instanceof Element)) return false;
  const total = textOf(el);
  if (!total) return false;
  const buttons = Array.from(el.querySelectorAll('button, [role="button"]')).filter(
    (b) => b instanceof Element && isVisible(b)
  );
  if (buttons.length === 0) return false;
  let buttonText = 0;
  for (const b of buttons) buttonText += textOf(b).length;
  // Two or more buttons + dominant share of the element's text.
  if (buttons.length >= 2 && buttonText / total.length > 0.6) return true;
  // Single button that is essentially the entire content (a lone CTA).
  if (buttons.length === 1 && buttonText / total.length > 0.8 && total.length < 80) return true;
  return false;
}

// Heuristic: prefer text that reads like a sentence (or a multi-line bot
// reply) over short, choppy chip labels.
function looksSentencey(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length >= 80) return true;
  // Mid-text terminator (avoid trailing-only punctuation).
  return /[\.\?!]\s+\S/.test(t) || /\n/.test(t);
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
    .filter((x) => x.t.length > 0 && isExtractable(x.n, x.t));
  const last = items[items.length - 1]?.t;
  if (last) return last;
  const fallback = textOf(best);
  return fallback && !looksLikeFooter(fallback) ? fallback : null;
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
  const els = queryAllDeep(sel).filter(
    (el) =>
      el instanceof Element &&
      isVisible(el) &&
      !isInteractive(el) &&
      !isPinned(el) &&
      !isLikelyButtonRow(el)
  );
  if (!els.length) return null;
  const sorted = els.slice().sort((a, b) => {
    const ra = a.getBoundingClientRect().bottom;
    const rb = b.getBoundingClientRect().bottom;
    return rb - ra;
  });
  // Walk from the bottom and prefer a sentence-like reply over a chip row.
  for (const candidate of sorted.slice(0, 4)) {
    const inner =
      candidate.querySelector(
        "[class*='message-content'], [class*='markdown'], [class*='text'], p"
      ) || candidate;
    const t = textOf(inner);
    if (!t.length || looksLikeFooter(t) || isLikelyButtonRow(candidate)) continue;
    if (looksSentencey(t)) return t;
  }
  // Fallback: bottom-most that survived the filters, even if not sentencey.
  for (const candidate of sorted) {
    const inner =
      candidate.querySelector(
        "[class*='message-content'], [class*='markdown'], [class*='text'], p"
      ) || candidate;
    const t = textOf(inner);
    if (t.length && !looksLikeFooter(t)) return t;
  }
  return null;
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
      if (
        cls.includes("composer") ||
        cls.includes("input-area") ||
        cls.includes("textarea-wrap") ||
        cls.includes("footer") ||
        cls.includes("disclaimer") ||
        cls.includes("branding") ||
        cls.includes("powered") ||
        cls.includes("consent") ||
        cls.includes("privacy") ||
        cls.includes("suggestion") ||
        cls.includes("quick-repl") ||
        cls.includes("cta") ||
        cls.includes("button") ||
        cls.includes("btn-") ||
        cls.includes("-btn") ||
        cls.includes("pill") ||
        cls.includes("options-") ||
        cls.includes("-options") ||
        cls.includes("actions") ||
        cls.includes("answer-opt") ||
        cls.includes("choice")
      )
        continue;
      if (isInteractive(el) || isPinned(el) || isLikelyButtonRow(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > composerTop - 6) continue;
      if (r.height > 900 || r.width < 24) continue;
      const t = textOf(el);
      if (t.length < 12 || t.length > 12_000) continue;
      if (looksLikeFooter(t)) continue;
      candidates.push({ el, bottom: r.bottom, area: r.width * r.height, t });
    }
  }
  const leaves = candidates.filter((a) => !candidates.some((b) => a !== b && b.el.contains(a.el)));
  if (!leaves.length) return null;
  // Prefer the bottom-most leaf, but if the lowest one is a short chip-like
  // label and there's a recent "sentencey" leaf right above it, take that.
  leaves.sort((a, b) => b.bottom - a.bottom);
  for (const leaf of leaves.slice(0, 4)) {
    if (looksSentencey(leaf.t)) return leaf.t;
  }
  return leaves[0]?.t || null;
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
    if (isInteractive(el) || isPinned(el) || isLikelyButtonRow(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > cTop - 8) continue;
    if (r.height > 700 || r.height < 14) continue;
    const t = textOf(el);
    if (t.length < 15 || t.length > 10_000) continue;
    if (looksLikeFooter(t)) continue;
    blocks.push({ el, bottom: r.bottom, area: r.width * r.height, t });
  }
  const leaves = blocks.filter((a) => !blocks.some((b) => a !== b && b.el.contains(a.el)));
  if (!leaves.length) return null;
  leaves.sort((a, b) => {
    const d = b.bottom - a.bottom;
    if (Math.abs(d) > 2) return d;
    return a.area - b.area;
  });
  // Walk from the bottom up to 4 candidates, picking the first that reads
  // like a real reply rather than a short chip/label.
  for (const leaf of leaves.slice(0, 4)) {
    if (looksSentencey(leaf.t)) return leaf.t;
  }
  return leaves[0]?.t || null;
}

/** Live regions sometimes mirror the latest bot line (Drift, Chili Piper, etc.). */
function extractFromAriaLiveRegion() {
  const regions = queryAllDeep('[aria-live="polite"], [aria-live="assertive"]')
    .filter((el) => el instanceof Element && isVisible(el) && !isPinned(el))
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  for (const region of regions) {
    const t = textOf(region);
    if (t.length >= 15 && t.length < 8000 && !looksLikeFooter(t)) return t;
    const ps = Array.from(region.querySelectorAll("p, div")).filter(
      (x) => isVisible(x) && !isInteractive(x) && !isPinned(x)
    );
    const lastP = ps[ps.length - 1];
    if (lastP) {
      const tp = textOf(lastP);
      if (tp.length >= 12 && !looksLikeFooter(tp)) return tp;
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
    .filter((el) => el instanceof Element && isVisible(el) && !isInteractive(el) && !isPinned(el));
  const last = items[items.length - 1];
  if (!last) return null;
  const t = textOf(last);
  if (t.length < 10 || looksLikeFooter(t)) return null;
  return t;
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

