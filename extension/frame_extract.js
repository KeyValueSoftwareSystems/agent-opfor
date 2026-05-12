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

    if (
      node instanceof ShadowRoot ||
      node instanceof Document ||
      node instanceof DocumentFragment
    ) {
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
    if (
      tag === "BUTTON" ||
      tag === "A" ||
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA"
    )
      return true;
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
  return /[.?!]\s+\S/.test(t) || /\n/.test(t);
}

/**
 * Classify an element as a "user" bubble vs "bot/agent" bubble.
 * Returns "user", "bot", or "unknown".
 */
function classifyBubble(el) {
  if (!(el instanceof Element)) return "unknown";

  // --- Data attributes (strongest signal) ---
  const role = (el.getAttribute("data-message-author-role") || "").toLowerCase();
  if (role === "user" || role === "customer" || role === "visitor") return "user";
  if (role === "assistant" || role === "bot" || role === "agent" || role === "system") return "bot";

  const from = (el.getAttribute("data-from") || el.getAttribute("data-sender") || "").toLowerCase();
  if (from === "user" || from === "customer" || from === "visitor" || from === "me") return "user";
  if (from === "bot" || from === "agent" || from === "assistant" || from === "system") return "bot";

  const author = (el.getAttribute("data-author") || "").toLowerCase();
  if (author === "user" || author === "customer") return "user";
  if (author === "assistant" || author === "bot" || author === "agent") return "bot";

  // --- Class name patterns (walk up a few parents) ---
  for (let n = el, hops = 0; n instanceof Element && hops < 4; n = n.parentElement, hops++) {
    const cls = ((n.className || "") + "").toLowerCase();
    // User patterns
    if (
      cls.includes("user-message") ||
      cls.includes("usermessage") ||
      cls.includes("from-user") ||
      cls.includes("from_user") ||
      cls.includes("visitor-message") ||
      cls.includes("customer-message") ||
      cls.includes("message--user") ||
      cls.includes("message-user") ||
      cls.includes("outgoing") ||
      cls.includes("self-message") ||
      cls.includes("sent-message") ||
      cls.includes("is-user") ||
      cls.includes("human-message") ||
      cls.includes("humanmessage") ||
      cls.includes("mine")
    )
      return "user";
    // Bot patterns
    if (
      cls.includes("bot-message") ||
      cls.includes("botmessage") ||
      cls.includes("from-bot") ||
      cls.includes("from-agent") ||
      cls.includes("from_agent") ||
      cls.includes("agent-message") ||
      cls.includes("agentmessage") ||
      cls.includes("assistant-message") ||
      cls.includes("assistantmessage") ||
      cls.includes("message--bot") ||
      cls.includes("message-bot") ||
      cls.includes("message--agent") ||
      cls.includes("message-agent") ||
      cls.includes("incoming") ||
      cls.includes("received-message") ||
      cls.includes("is-bot") ||
      cls.includes("is-agent") ||
      cls.includes("system-message")
    )
      return "bot";
  }

  // --- ARIA label ---
  const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
  if (/\b(you|your message|sent)\b/.test(ariaLabel)) return "user";
  if (/\b(bot|agent|assistant|support|received)\b/.test(ariaLabel)) return "bot";

  // --- Alignment heuristic (user bubbles right-aligned, bot left-aligned) ---
  try {
    const style = window.getComputedStyle(el);
    const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
    const selfAlign = style.textAlign || style.alignSelf || "";
    const parentJustify = parentStyle?.justifyContent || "";
    const marginLeft = style.marginLeft || "";
    const marginRight = style.marginRight || "";

    if (
      selfAlign === "right" ||
      selfAlign === "flex-end" ||
      selfAlign === "end" ||
      parentJustify === "flex-end" ||
      parentJustify === "end" ||
      (marginLeft === "auto" && marginRight !== "auto")
    )
      return "user";
    if (
      selfAlign === "left" ||
      selfAlign === "flex-start" ||
      selfAlign === "start" ||
      parentJustify === "flex-start" ||
      parentJustify === "start" ||
      (marginRight === "auto" && marginLeft !== "auto")
    )
      return "bot";
  } catch {}

  return "unknown";
}

/**
 * Check if an extracted text is too similar to the last user message we sent.
 * Uses normalized comparison to catch minor formatting differences.
 */
function matchesUserMessage(text) {
  const lastUser = (globalThis.__OPFOR_LAST_USER__ || "").trim();
  if (!lastUser || !text) return false;
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const normUser = normalize(lastUser);
  const normText = normalize(text);
  if (normText === normUser) return true;
  // User message is contained within the extracted text (echo with timestamp/prefix)
  if (
    normText.includes(normUser) &&
    normUser.length > 20 &&
    normUser.length / normText.length > 0.5
  )
    return true;
  // Extracted text is a prefix of the user message (truncated echo)
  if (
    normUser.startsWith(normText) &&
    normText.length > 20 &&
    normText.length / normUser.length > 0.7
  )
    return true;
  return false;
}

/**
 * From a list of message elements, find the last one that is a bot/agent reply.
 * Skips user bubbles using classification + text matching.
 */
function pickLastBotMessage(messageEls) {
  if (!messageEls.length) return null;
  // Walk from the bottom up
  for (let i = messageEls.length - 1; i >= 0; i--) {
    const el = messageEls[i];
    const inner =
      el.querySelector?.(
        "[class*='message-content' i], [class*='markdown' i], [class*='text' i], p"
      ) || el;
    const t = textOf(inner);
    if (!t || t.length < 5 || looksLikeFooter(t)) continue;

    const cls = classifyBubble(el);
    if (cls === "user") continue;
    if (cls === "unknown" && matchesUserMessage(t)) continue;
    return t;
  }
  return null;
}

function extractFromRoleLog() {
  const logs = queryAllDeep("[role='log']")
    .filter((el) => el instanceof Element && isVisible(el))
    .map((el) => {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const score =
        (label.includes("chat") ? 5 : 0) +
        (label.includes("message") ? 3 : 0) +
        (label.includes("messages") ? 3 : 0);
      return { el, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = logs[0]?.el;
  if (!best) return null;

  const items = Array.from(best.querySelectorAll("li, article, [class*='message' i], div")).filter(
    (n) => n instanceof Element && isVisible(n) && isExtractable(n, textOf(n))
  );
  const bot = pickLastBotMessage(items);
  if (bot) return bot;

  const fallback = textOf(best);
  return fallback && !looksLikeFooter(fallback) ? fallback : null;
}

function extractByCommonLabels() {
  const candidates = queryAllDeep("[aria-label]")
    .filter((el) => el instanceof Element && isVisible(el))
    .map((el) => ({ el, label: (el.getAttribute("aria-label") || "").toLowerCase() }))
    .filter(
      (x) =>
        x.label.includes("chat") && (x.label.includes("message") || x.label.includes("messages"))
    );
  if (!candidates.length) return null;
  const best = candidates[0].el;
  const t = textOf(best);
  return t && !matchesUserMessage(t) ? t : null;
}

/**
 * Generic embedded dialogue extractor.
 * Finds any visible conversation/transcript container and pulls the last bot/agent message.
 * Works for any vendor that uses "dialogue", "conversation", "transcript", or "message-list"
 * class patterns.
 */
function extractFromEmbeddedDialogue() {
  const dialogueSelectors = [
    '[class*="dialogue" i]',
    '[class*="conversation" i]',
    '[class*="transcript" i]',
    '[class*="message-list" i]',
    '[class*="chat-history" i]',
    '[class*="chatlog" i]',
  ];

  let dialogue = null;
  for (const sel of dialogueSelectors) {
    const found = queryAllDeep(sel).filter((el) => el instanceof Element && isVisible(el));
    if (found.length) {
      dialogue = found[0];
      break;
    }
  }
  if (!dialogue) return null;

  // Collect all message-like children in the dialogue container
  const allMsgs = Array.from(
    dialogue.querySelectorAll(
      "li, article, [class*='message' i], [class*='bubble' i], [role='row'], div"
    )
  ).filter((el) => {
    if (!(el instanceof Element) || !isVisible(el)) return false;
    const t = textOf(el);
    return t.length >= 10 && t.length < 5000 && !looksLikeFooter(t) && !isInteractive(el);
  });

  // De-dup: remove ancestors that contain a more specific child
  const leaves = allMsgs.filter((a) => !allMsgs.some((b) => a !== b && a.contains(b)));

  const bot = pickLastBotMessage(leaves);
  if (bot) return bot;

  // Legacy fallback: try explicit bot selectors
  const botSelectors = [
    '[class*="bot-message" i]',
    '[class*="assistant-message" i]',
    '[class*="from-bot" i]',
    '[class*="from-agent" i]',
    '[class*="incoming" i]',
    '[data-from="bot"]',
    '[data-from="agent"]',
    '[data-message-author-role="assistant"]',
  ];
  for (const sel of botSelectors) {
    const msgs = Array.from(dialogue.querySelectorAll(sel)).filter(
      (el) => el instanceof Element && isVisible(el)
    );
    if (msgs.length) {
      const lastEl = msgs[msgs.length - 1];
      const textNode = lastEl.querySelector('[class*="text" i], [class*="content" i], p') || lastEl;
      const t = textOf(textNode);
      if (t.length && !matchesUserMessage(t)) return t;
    }
  }
  return null;
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
    "[class*='chilipiper' i]",
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
  for (const candidate of sorted.slice(0, 6)) {
    const inner =
      candidate.querySelector(
        "[class*='message-content'], [class*='markdown'], [class*='text'], p"
      ) || candidate;
    const t = textOf(inner);
    if (!t.length || looksLikeFooter(t) || isLikelyButtonRow(candidate)) continue;
    if (matchesUserMessage(t)) continue;
    if (looksSentencey(t)) return t;
  }
  for (const candidate of sorted) {
    const inner =
      candidate.querySelector(
        "[class*='message-content'], [class*='markdown'], [class*='text'], p"
      ) || candidate;
    const t = textOf(inner);
    if (t.length && !looksLikeFooter(t) && !matchesUserMessage(t)) return t;
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
    '[data-testid*="message" i]',
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

  // Sort bottom-most first, then use classification + text matching to skip user bubbles.
  leaves.sort((a, b) => b.bottom - a.bottom);
  for (const leaf of leaves.slice(0, 6)) {
    if (classifyBubble(leaf.el) === "user") continue;
    if (matchesUserMessage(leaf.t)) continue;
    if (looksSentencey(leaf.t)) return leaf.t;
  }
  // Fallback: any non-user bubble
  for (const leaf of leaves) {
    if (classifyBubble(leaf.el) === "user") continue;
    if (matchesUserMessage(leaf.t)) continue;
    if (leaf.t.length) return leaf.t;
  }
  return null;
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
  // Walk from the bottom, skip user bubbles, pick the first bot reply.
  for (const leaf of leaves.slice(0, 6)) {
    if (classifyBubble(leaf.el) === "user") continue;
    if (matchesUserMessage(leaf.t)) continue;
    if (looksSentencey(leaf.t)) return leaf.t;
  }
  // Fallback: any non-user text
  for (const leaf of leaves.slice(0, 6)) {
    if (classifyBubble(leaf.el) === "user") continue;
    if (matchesUserMessage(leaf.t)) continue;
    if (leaf.t.length) return leaf.t;
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
    if (t.length >= 15 && t.length < 8000 && !looksLikeFooter(t) && !matchesUserMessage(t))
      return t;
    const ps = Array.from(region.querySelectorAll("p, div")).filter(
      (x) => isVisible(x) && !isInteractive(x) && !isPinned(x)
    );
    const lastP = ps[ps.length - 1];
    if (lastP) {
      const tp = textOf(lastP);
      if (tp.length >= 12 && !looksLikeFooter(tp) && !matchesUserMessage(tp)) return tp;
    }
  }
  return null;
}

function extractFromRoleFeed() {
  const feeds = queryAllDeep('[role="feed"], [role="list"][aria-label*="message" i]').filter(
    (el) => el instanceof Element && isVisible(el)
  );
  const feed = feeds[0];
  if (!feed) return null;
  const items = Array.from(
    feed.querySelectorAll("[role='article'], li, [class*='message' i]")
  ).filter((el) => el instanceof Element && isVisible(el) && !isInteractive(el) && !isPinned(el));

  const bot = pickLastBotMessage(items);
  if (bot) return bot;

  // Legacy: grab last item if classification didn't work
  const last = items[items.length - 1];
  if (!last) return null;
  const t = textOf(last);
  if (t.length < 10 || looksLikeFooter(t) || matchesUserMessage(t)) return null;
  return t;
}

(() => {
  const text =
    extractFromEmbeddedDialogue() ||
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
