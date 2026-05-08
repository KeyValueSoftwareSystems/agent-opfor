function isVisible(el) {
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  if (rect.width < 20 || rect.height < 20) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function scoreInput(el) {
  let score = 0;

  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();
  const formRole = el.closest?.("form")?.getAttribute?.("role")?.toLowerCase?.() || "";
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();
  const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
  const name = (el.getAttribute("name") || "").toLowerCase();
  const id = (el.id || "").toLowerCase();
  const cls = (el.className || "").toString().toLowerCase();

  const blob = `${aria} ${placeholder} ${name} ${id} ${cls}`.trim();

  if (!isVisible(el)) score -= 5;
  if (tag === "textarea") score += 5;
  if (tag === "input" && (type === "text" || type === "")) score += 3;
  if (el.isContentEditable) score += 4;
  if (role === "textbox") score += 2;
  if (blob.includes("message")) score += 4;
  if (blob.includes("chat")) score += 3;
  if (blob.includes("prompt")) score += 2;
  if (blob.includes("compose")) score += 2;
  if (blob.includes("comment")) score += 1;
  // Strongly de-rank search bars (common false positive on support pages)
  if (type === "search") score -= 8;
  if (role === "searchbox") score -= 10;
  if (formRole === "search") score -= 8;
  if (blob.includes("search")) score -= 6;
  if (blob.includes("email")) score -= 2;
  if (blob.includes("password")) score -= 10;

  // Prefer inputs near the bottom (common chat layouts)
  const rect = el.getBoundingClientRect?.();
  if (rect) {
    const yRatio = rect.top / Math.max(1, window.innerHeight);
    if (yRatio > 0.55) score += 2;
  }

  return score;
}

function findBestChatInput() {
  const candidates = [];
  for (const el of document.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']")) {
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "").toLowerCase();
      if (["hidden", "checkbox", "radio", "file", "submit", "button", "range", "color", "date", "datetime-local"].includes(t)) {
        continue;
      }
    }
    candidates.push(el);
  }

  candidates.sort((a, b) => scoreInput(b) - scoreInput(a));
  const best = candidates[0];
  return best || null;
}

function findLikelyChatLauncherButtons() {
  const btns = Array.from(document.querySelectorAll("button, [role='button'], a[role='button'], a, summary")).filter(
    (el) => el instanceof Element && isVisible(el)
  );

  const scored = btns
    .map((el) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
      const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
      const blob = `${text} ${aria}`.trim();
      let s = 0;
      if (blob.includes("live chat")) s += 8;
      if (blob.includes("start a conversation")) s += 10;
      if (blob.includes("start conversation")) s += 10;
      if (blob.includes("chat")) s += 4;
      if (blob.includes("help")) s += 2;
      if (blob.includes("support")) s += 2;
      if (blob.includes("contact")) s += 1;
      // avoid nav/search buttons
      if (blob.includes("search")) s -= 6;
      if (blob.includes("sign in") || blob.includes("log in")) s -= 2;
      return { el, s, blob };
    })
    .filter((x) => x.s >= 6)
    .sort((a, b) => b.s - a.s);

  return scored.map((x) => x.el).slice(0, 3);
}

function isProbablyFloatingWidget(el) {
  if (!(el instanceof Element)) return false;
  const style = window.getComputedStyle(el);
  const pos = style.position;
  if (pos !== "fixed" && pos !== "sticky") return false;
  const rect = el.getBoundingClientRect?.();
  if (!rect) return false;
  // Typically bottom-right bubble/button
  const nearRight = rect.right > window.innerWidth * 0.7;
  const nearBottom = rect.bottom > window.innerHeight * 0.7;
  if (!nearRight || !nearBottom) return false;
  // Reasonable widget size (avoid full-width sticky bars)
  if (rect.width > window.innerWidth * 0.6) return false;
  if (rect.height > window.innerHeight * 0.4) return false;
  return true;
}

function scoreFloatingWidget(el) {
  let s = 0;
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const title = (el.getAttribute?.("title") || "").toLowerCase();
  const id = (el.getAttribute?.("id") || "").toLowerCase();
  const cls = (el.getAttribute?.("class") || "").toLowerCase();
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
  const blob = `${aria} ${title} ${id} ${cls} ${text}`.trim();

  if (blob.includes("chat") || blob.includes("help") || blob.includes("support") || blob.includes("assistant")) s += 6;
  if (blob.includes("live")) s += 1;
  if (blob.includes("conversation")) s += 2;
  if (blob.includes("message")) s += 1;
  if (blob.includes("search")) s -= 6;
  if (blob.includes("cookie")) s -= 6;

  const rect = el.getBoundingClientRect?.();
  if (rect) {
    const area = rect.width * rect.height;
    if (area >= 900 && area <= 40_000) s += 2; // typical icon/button bubble
    const nearCorner = rect.right > window.innerWidth * 0.9 && rect.bottom > window.innerHeight * 0.9;
    if (nearCorner) s += 2;
  }

  // Prefer actual buttons/links
  const tag = el.tagName.toLowerCase();
  if (tag === "button") s += 2;
  if (tag === "a") s += 1;
  if (el.getAttribute?.("role") === "button") s += 1;

  return s;
}

function findFloatingWidgetCandidates() {
  const candidates = [];
  for (const el of document.querySelectorAll("button, [role='button'], a, div")) {
    if (!(el instanceof Element)) continue;
    if (!isVisible(el)) continue;
    if (!isProbablyFloatingWidget(el)) continue;
    // Must be clickable-ish
    const tag = el.tagName.toLowerCase();
    const clickable = tag === "button" || tag === "a" || el.getAttribute("role") === "button" || typeof el.onclick === "function";
    if (!clickable) continue;
    candidates.push(el);
  }

  return candidates
    .map((el) => ({ el, s: scoreFloatingWidget(el) }))
    .filter((x) => x.s >= 4)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.el)
    .slice(0, 5);
}

async function maybeOpenChatWidget() {
  // Click a likely launcher if present (Brex-style pages often require opening the widget first).
  const launchers = findLikelyChatLauncherButtons();
  const floating = findFloatingWidgetCandidates();

  const candidates = [];
  for (const el of launchers) candidates.push({ kind: "launcher", el });
  for (const el of floating) candidates.push({ kind: "floating", el });

  if (candidates.length === 0) return { clicked: false };

  // Prefer explicit launcher text over generic floating widgets.
  const best = candidates[0];
  try {
    best.el.click();
    // Widgets can render async (iframe load, animation, etc.)
    await sleep(700);
    return { clicked: true, kind: best.kind, selector: selectorFromEl(best.el) };
  } catch {
    return { clicked: false };
  }
}

function setInputValue(el, value) {
  el.focus?.();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // Use the native value setter to trigger React/controlled-input listeners reliably.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;

    // Fire an InputEvent if possible; many apps rely on it rather than plain Event("input")
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: value, inputType: "insertText" }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { kind: el.tagName.toLowerCase() };
  }

  if (el.isContentEditable) {
    // Many chat UIs rely on beforeinput/input for contenteditable.
    // We try beforeinput → DOM update → input.
    try {
      el.dispatchEvent(
        new InputEvent("beforeinput", { bubbles: true, composed: true, data: value, inputType: "insertText" })
      );
    } catch {
      // ignore
    }

    // Replace contents and move caret to end.
    el.textContent = value;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      // ignore
    }

    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: value, inputType: "insertText" }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { kind: "contenteditable" };
  }

  // Fallback: try to set textContent
  el.textContent = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return { kind: "unknown" };
}

function findGlobalSendButton() {
  const selectors = [
    // ChatGPT
    "button[data-testid='send-button']",
    "button[data-testid='fruitjuice-send-button']",
    "button[aria-label*='Send' i]",
    "button[aria-label*='send' i]",
    // Generic
    "button[type='submit']",
    "input[type='submit']"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el instanceof Element && isVisible(el)) return el;
  }
  return null;
}

function looksLikeSendButton(el) {
  if (!(el instanceof Element)) return false;
  const testid = (el.getAttribute?.("data-testid") || "").toLowerCase();
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const text = (el.textContent || "").trim().toLowerCase();
  const blob = `${testid} ${aria} ${text}`.trim();
  const sendish = blob.includes("send") || blob.includes("submit");
  const bad = blob.includes("plus") || blob.includes("attach") || blob.includes("paperclip") || blob.includes("mic") || blob.includes("microphone");
  return sendish && !bad;
}

function isDisabledButton(el) {
  if (!(el instanceof Element)) return false;
  if (el instanceof HTMLButtonElement) return el.disabled;
  const aria = el.getAttribute?.("aria-disabled");
  if (aria === "true") return true;
  return el.getAttribute?.("disabled") != null;
}

function getInputText(el) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return String(el.value || "");
  if (el?.isContentEditable) return String(el.textContent || "");
  return String(el?.textContent || "");
}

async function waitForInputToClear(el, { originalText, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = getInputText(el).trim();
    // "Sent" signal: composer cleared or no longer equals the text we injected.
    if (now === "" || now !== originalText.trim()) return true;
    await sleep(80);
  }
  return false;
}

function findSendButtonNear(el) {
  // Try nearest form first
  const form = el.closest?.("form");
  if (form) {
    const btn =
      form.querySelector("button[type='submit']") ||
      form.querySelector("button[aria-label*='Send' i]") ||
      form.querySelector("button[aria-label*='send' i]");
    if (btn) return btn;
  }

  // Otherwise, global heuristic
  const btn =
    document.querySelector("button[type='submit']") ||
    document.querySelector("button[aria-label*='send' i]") ||
    document.querySelector("button[data-testid*='send' i]") ||
    document.querySelector("button[class*='send' i]");
  return btn || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function trySubmit(el) {
  const btn = findSendButtonNear(el);
  if (btn && isVisible(btn)) {
    btn.click();
    return "button.click";
  }

  // Try Enter (common in chat inputs)
  pressEnterToSubmit(el);
  return "enter.key";
}

function pressEnterToSubmit(el) {
  const fire = (type, extra = {}) =>
    el.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        ...extra
      })
    );
  fire("keydown");
  fire("keypress");
  fire("keyup");
}

function pressShortcutEnterToSubmit(el) {
  // Some chat UIs send on Cmd/Ctrl+Enter.
  const combos = [
    { metaKey: true, ctrlKey: false, label: "meta+enter" },
    { metaKey: false, ctrlKey: true, label: "ctrl+enter" }
  ];

  for (const combo of combos) {
    const fire = (type) =>
      el.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          metaKey: combo.metaKey,
          ctrlKey: combo.ctrlKey
        })
      );
    fire("keydown");
    fire("keypress");
    fire("keyup");
  }
}

function robustClick(el) {
  if (!(el instanceof Element)) return;
  const rect = el.getBoundingClientRect?.();
  const clientX = rect ? Math.round(rect.left + Math.min(10, rect.width / 2)) : 1;
  const clientY = rect ? Math.round(rect.top + Math.min(10, rect.height / 2)) : 1;

  const fireMouse = (type) =>
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY })
    );
  fireMouse("pointerdown");
  fireMouse("mousedown");
  fireMouse("pointerup");
  fireMouse("mouseup");
  fireMouse("click");
}

function tryRequestSubmit(inputEl, submitButtonEl) {
  const form = inputEl?.closest?.("form");
  if (form && typeof form.requestSubmit === "function") {
    try {
      form.requestSubmit(submitButtonEl instanceof HTMLElement ? submitButtonEl : undefined);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function submitWithRetries({ inputEl, desiredMethod, desiredButtonEl, originalText }) {
  const attempts = [];

  const tryClick = async (btn) => {
    if (!btn) return false;
    const disabled = isDisabledButton(btn);
    attempts.push({ action: "click", selector: selectorFromEl(btn), disabled });
    await sleep(80);
    const didRequestSubmit = tryRequestSubmit(inputEl, btn);
    if (!didRequestSubmit) {
      if (!disabled && typeof btn.click === "function") btn.click();
      else robustClick(btn);
    }
    // Some UIs clear the composer only after async state updates/network.
    return await waitForInputToClear(inputEl, { originalText, timeoutMs: 2500 });
  };

  const tryEnter = async () => {
    // IMPORTANT: do NOT fire multiple Enter variants back-to-back.
    // Some sites treat both Enter and Cmd/Ctrl+Enter as "send", which can create duplicates.
    attempts.push({ action: "enter" });
    pressEnterToSubmit(inputEl);
    if (await waitForInputToClear(inputEl, { originalText, timeoutMs: 1200 })) return true;

    attempts.push({ action: "meta+enter" });
    // Cmd+Enter
    const fireMeta = (type) =>
      inputEl.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          metaKey: true
        })
      );
    fireMeta("keydown");
    fireMeta("keypress");
    fireMeta("keyup");
    if (await waitForInputToClear(inputEl, { originalText, timeoutMs: 1200 })) return true;

    attempts.push({ action: "ctrl+enter" });
    // Ctrl+Enter
    const fireCtrl = (type) =>
      inputEl.dispatchEvent(
        new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          ctrlKey: true
        })
      );
    fireCtrl("keydown");
    fireCtrl("keypress");
    fireCtrl("keyup");
    return await waitForInputToClear(inputEl, { originalText, timeoutMs: 1200 });
  };

  // Order: do what AI asked first, then fallbacks.
  const clickTargets = [];
  if (desiredButtonEl && looksLikeSendButton(desiredButtonEl)) clickTargets.push(desiredButtonEl);
  // Prefer known/global send, then best send-ish, then any nearby form submit.
  const global = findGlobalSendButton();
  if (global) clickTargets.push(global);
  const sendish = findAnySendishButton();
  if (sendish) clickTargets.push(sendish);
  const near = findSendButtonNear(inputEl);
  if (near) clickTargets.push(near);

  // De-dupe by identity
  const uniqClickTargets = Array.from(new Set(clickTargets.filter(Boolean)));

  const maxLoops = 4;
  for (let i = 0; i < maxLoops; i++) {
    if (desiredMethod === "click") {
      for (const btn of uniqClickTargets) {
        if (await tryClick(btn)) return { ok: true, attempts, submitMethod: "button.click" };
      }
      if (await tryEnter()) return { ok: true, attempts, submitMethod: "enter.key" };
    } else {
      if (await tryEnter()) return { ok: true, attempts, submitMethod: "enter.key" };
      for (const btn of uniqClickTargets) {
        if (await tryClick(btn)) return { ok: true, attempts, submitMethod: "button.click" };
      }
    }

    // Some UIs only enable send after a moment.
    await sleep(200);
  }

  return { ok: false, attempts, submitMethod: desiredMethod === "click" ? "button.click" : "enter.key" };
}

function escapeCssValue(v) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(v);
  return String(v).replace(/["\\]/g, "\\$&");
}

function describeEl(el) {
  const tag = el.tagName.toLowerCase();
  const attrs = [];
  const id = el.getAttribute?.("id");
  if (id) attrs.push(`id="${id}"`);
  const name = el.getAttribute?.("name");
  if (name) attrs.push(`name="${name}"`);
  const role = el.getAttribute?.("role");
  if (role) attrs.push(`role="${role}"`);
  const aria = el.getAttribute?.("aria-label");
  if (aria) attrs.push(`aria-label="${aria}"`);
  const placeholder = el.getAttribute?.("placeholder");
  if (placeholder) attrs.push(`placeholder="${placeholder}"`);
  const testid = el.getAttribute?.("data-testid");
  if (testid) attrs.push(`data-testid="${testid}"`);
  const cls = (el.getAttribute?.("class") || "").trim();
  if (cls) attrs.push(`class="${cls.split(/\s+/).slice(0, 6).join(" ")}"`);

  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const textPart = text ? ` text="${text}"` : "";
  return `<${tag} ${attrs.join(" ")}>${textPart}`.trim();
}

function buildSanitizedDomSnapshot() {
  const lines = [];
  lines.push(`url="${location.href}"`);

  const launchers = findLikelyChatLauncherButtons();
  if (launchers.length) {
    lines.push("");
    lines.push("LIKELY_CHAT_LAUNCHERS:");
    for (const el of launchers) {
      lines.push(`- selector="${selectorFromEl(el)}" ${describeEl(el)}`);
    }
  }

  const floaters = findFloatingWidgetCandidates();
  if (floaters.length) {
    lines.push("");
    lines.push("FLOATING_WIDGET_CANDIDATES:");
    for (const el of floaters) {
      const rect = el.getBoundingClientRect?.();
      const pos = rect ? `pos=${Math.round(rect.left)},${Math.round(rect.top)} size=${Math.round(rect.width)}x${Math.round(rect.height)}` : "";
      lines.push(`- score=${scoreFloatingWidget(el)} selector="${selectorFromEl(el)}" ${pos} ${describeEl(el)}`);
    }
  }

  const inputCandidates = Array.from(
    document.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']")
  ).filter((el) => {
    if (!(el instanceof Element)) return false;
    if (!isVisible(el)) return false;
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "").toLowerCase();
      if (["hidden", "checkbox", "radio", "file", "submit", "button", "range", "color", "date", "datetime-local"].includes(t)) return false;
      if (t === "password") return false;
    }
    return true;
  });

  lines.push("");
  lines.push("CANDIDATE_INPUTS:");
  for (const el of inputCandidates.slice(0, 40)) {
    const rect = el.getBoundingClientRect?.();
    const pos = rect ? `pos=${Math.round(rect.left)},${Math.round(rect.top)} size=${Math.round(rect.width)}x${Math.round(rect.height)}` : "";
    const score = scoreInput(el);
    const sel = selectorFromEl(el);
    lines.push(`- score=${score} selector="${sel}" ${pos} ${describeEl(el)}`);
  }

  const buttonCandidates = Array.from(
    document.querySelectorAll("button, [role='button'], input[type='submit']")
  ).filter((el) => el instanceof Element && isVisible(el));

  lines.push("");
  lines.push("CANDIDATE_BUTTONS:");
  for (const el of buttonCandidates.slice(0, 60)) {
    const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
    const text = (el.textContent || "").trim().toLowerCase();
    const looksLikeSend = aria.includes("send") || text === "send" || text.includes("send") || text.includes("submit");
    const rect = el.getBoundingClientRect?.();
    const pos = rect ? `pos=${Math.round(rect.left)},${Math.round(rect.top)} size=${Math.round(rect.width)}x${Math.round(rect.height)}` : "";
    const sel = selectorFromEl(el);
    lines.push(`- ${looksLikeSend ? "sendish=1" : "sendish=0"} selector="${sel}" ${pos} ${describeEl(el)}`);
  }

  return lines.join("\n").slice(0, 60_000);
}

function selectorFromEl(el) {
  if (!(el instanceof Element)) return null;
  const testid = el.getAttribute("data-testid");
  if (testid) return `[data-testid="${escapeCssValue(testid)}"]`;
  const aria = el.getAttribute("aria-label");
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${escapeCssValue(aria)}"]`;
  const id = el.getAttribute("id");
  if (id) return `#${escapeCssValue(id)}`;
  const name = el.getAttribute("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${escapeCssValue(name)}"]`;
  return el.tagName.toLowerCase();
}

async function aiPickInputAndSubmit({ sanitizedDom }) {
  const resp = await chrome.runtime.sendMessage({
    type: "ASTRA_AI_PICK_INPUT",
    task: "Identify the chat prompt/input element and how to submit a message.",
    sanitizedDom
  });
  if (!resp?.ok) throw new Error(resp?.error || "AI fallback failed");
  return resp;
}

function validateAndResolveAiResult(ai) {
  const inputSelector = typeof ai?.inputSelector === "string" ? ai.inputSelector : "";
  if (!inputSelector) throw new Error("AI returned empty inputSelector");
  const input = document.querySelector(inputSelector);
  if (!input) throw new Error("AI inputSelector did not match any element");

  const method = ai?.submit?.method;
  if (method !== "enter" && method !== "click") throw new Error("AI returned invalid submit.method");

  let button = null;
  if (method === "click") {
    const bs = ai?.submit?.buttonSelector;
    if (typeof bs !== "string" || !bs) throw new Error("AI chose click but did not provide buttonSelector");
    button = document.querySelector(bs);
    // Don't hard-fail here; some pages mutate DOM after input events.
  }

  const confidence = typeof ai?.confidence === "number" ? ai.confidence : 0;
  return { input, inputSelector, submit: { method, button, buttonSelector: ai?.submit?.buttonSelector }, confidence, notes: ai?.notes };
}

function findAnySendishButton() {
  const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit']"));
  const sendish = buttons
    .filter((el) => el instanceof Element && isVisible(el))
    .map((el) => {
      const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      const sendishScore =
        (aria.includes("send") ? 3 : 0) +
        (text === "send" ? 3 : 0) +
        (text.includes("send") ? 2 : 0) +
        (text.includes("submit") ? 1 : 0);
      return { el, sendishScore };
    })
    .sort((a, b) => b.sendishScore - a.sendishScore);
  return sendish[0]?.sendishScore ? sendish[0].el : null;
}

(() => {
  // AI-first: sanitize DOM and ask AI for selectors. If AI is disabled/misconfigured, do not guess.
  return (async () => {
    try {
      const launcherResult = await maybeOpenChatWidget();
      const sanitizedDom = buildSanitizedDomSnapshot();
      const ai = await aiPickInputAndSubmit({ sanitizedDom });
      const resolved = validateAndResolveAiResult(ai);

      const injectedText = "hi";
      const { kind } = setInputValue(resolved.input, injectedText);

      // Retry submit attempts until we detect "sent" (composer cleared/changed).
      const desiredButtonEl =
        resolved.submit.method === "click" && resolved.submit.button && looksLikeSendButton(resolved.submit.button)
          ? resolved.submit.button
          : null;

      const submitResult = await submitWithRetries({
        inputEl: resolved.input,
        desiredMethod: resolved.submit.method,
        desiredButtonEl,
        originalText: injectedText
      });

      const submitMethod = submitResult.submitMethod;

      return {
        ok: submitResult.ok,
        inputKind: kind,
        submitMethod,
        via: "ai",
        ai: {
          confidence: resolved.confidence,
          inputSelector: resolved.inputSelector,
          submitMethod: resolved.submit.method,
          buttonSelector: resolved.submit.buttonSelector,
          notes: resolved.notes
        },
        launcherClicked: launcherResult.clicked,
        launcherSelector: launcherResult.selector,
        submitAttempts: submitResult.attempts,
        sentDetected: submitResult.ok
      };
    } catch (e) {
      const heurInput = findBestChatInput();
      const heurMsg = heurInput
        ? `Heuristic candidate existed (selector ${selectorFromEl(heurInput)} score=${scoreInput(heurInput)}), but heuristics are disabled.`
        : "No heuristic candidate found (heuristics are disabled).";
      return { ok: false, error: `${heurMsg}\nAI error: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();

})();

