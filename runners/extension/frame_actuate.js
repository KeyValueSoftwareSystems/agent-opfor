function isVisible(el) {
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  if (rect.width < 18 || rect.height < 18) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeCssValue(v) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(v);
  return String(v).replace(/["\\]/g, "\\$&");
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

function getShadowRoot(el) {
  if (el.shadowRoot) return el.shadowRoot;
  if (el.__closedShadowRoot) return el.__closedShadowRoot;
  return null;
}

function resolveDeepSelector(sel) {
  // Supports custom syntax produced by frame_collect:
  // shadow(<hostSel>) >> shadow(<hostSel2>) >> <innerSel>
  if (typeof sel !== "string" || !sel.trim()) return null;
  const parts = sel
    .split(">>")
    .map((p) => p.trim())
    .filter(Boolean);

  const queryOne = (root, selector) => {
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  };

  const queryAll = (root, selector) => {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const resolveFrom = (root, idx) => {
    if (idx >= parts.length) return root instanceof Element ? root : null;

    const part = parts[idx];
    const shadowMatch = part.match(/^shadow\((.*)\)$/);
    if (shadowMatch) {
      const hostSel = shadowMatch[1]?.trim();
      if (!hostSel) return null;

      const hosts = queryAll(root, hostSel).filter((h) => h instanceof Element && getShadowRoot(h));
      for (const host of hosts) {
        const out = resolveFrom(getShadowRoot(host), idx + 1);
        if (out) return out;
      }
      return null;
    }

    const next = queryOne(root, part);
    if (!(next instanceof Element)) return null;
    return resolveFrom(next, idx + 1);
  };

  return resolveFrom(document, 0);
}

function safeQuerySelector(root, selector) {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function setInputValue(el, value) {
  el.focus?.();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    // React tracks the value via an internal property; override it so React's
    // change detection sees the update. The native setter above handles this
    // for most React versions, but dispatch multiple event types to be safe.
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: value,
          inputType: "insertText",
        })
      );
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // Some frameworks also listen for keyup to finalize state.
    try {
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
    } catch {}
    return { kind: el.tagName.toLowerCase() };
  }

  if (el.isContentEditable) {
    // Clear existing content and select all so execCommand replaces it.
    el.focus?.();
    el.textContent = "";
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}

    // execCommand('insertText') is the most framework-compatible way to set
    // text in contenteditable — React, Vue, Angular all pick it up correctly.
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch {}

    // Fallback: use a clipboard-style DataTransfer InputEvent (works in Chromium).
    if (!inserted || getInputText(el).length < value.length * 0.8) {
      el.textContent = "";
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", value);
        el.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            composed: true,
            data: value,
            inputType: "insertFromPaste",
            dataTransfer: dt,
          })
        );
      } catch {}
      el.textContent = value;
      try {
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            data: value,
            inputType: "insertText",
          })
        );
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    // Move cursor to end.
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}

    return { kind: "contenteditable" };
  }

  // Safety: refuse to set textContent on large container elements (e.g. #root, body, main)
  // that would destroy the entire page. Only write to leaf-ish elements.
  const tag = el.tagName?.toLowerCase() || "";
  const role = el.getAttribute?.("role") || "";
  const children = el.children?.length || 0;
  const rect = el.getBoundingClientRect?.();
  const area = rect ? rect.width * rect.height : 0;
  const looksLikeContainer =
    tag === "body" ||
    tag === "main" ||
    tag === "section" ||
    tag === "article" ||
    tag === "header" ||
    tag === "footer" ||
    tag === "nav" ||
    el.id === "root" ||
    el.id === "app" ||
    el.id === "__next" ||
    el.id === "__nuxt" ||
    children > 5 ||
    area > window.innerWidth * window.innerHeight * 0.3;

  if (looksLikeContainer) {
    return { kind: "rejected", reason: "element_is_container" };
  }

  if (role === "textbox" || role === "combobox") {
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { kind: role };
  }

  el.textContent = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return { kind: "unknown" };
}

function getInputText(el) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)
    return String(el.value || "");
  if (el?.isContentEditable) return String(el.textContent || "");
  return String(el?.textContent || "");
}

async function waitForInputToClear(el, { originalText, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = getInputText(el).trim();
    if (now === "" || now !== originalText.trim()) return true;
    await sleep(80);
  }
  return false;
}

function pressEnter(el, extra = {}) {
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
        ...extra,
      })
    );
  fire("keydown");
  fire("keypress");
  fire("keyup");
}

function robustClick(el) {
  if (!(el instanceof Element)) return;
  const rect = el.getBoundingClientRect?.();
  const clientX = rect ? Math.round(rect.left + Math.min(10, rect.width / 2)) : 1;
  const clientY = rect ? Math.round(rect.top + Math.min(10, rect.height / 2)) : 1;
  const fireMouse = (type) =>
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
      })
    );
  fireMouse("pointerdown");
  fireMouse("mousedown");
  fireMouse("pointerup");
  fireMouse("mouseup");
  fireMouse("click");
}

function isDisabledButton(el) {
  if (!(el instanceof Element)) return false;
  if (el instanceof HTMLButtonElement) return el.disabled;
  if (el.getAttribute?.("aria-disabled") === "true") return true;
  return el.getAttribute?.("disabled") != null;
}

function findGlobalSendButton() {
  const selectors = [
    "button[data-testid='send-button']",
    "button[data-testid='fruitjuice-send-button']",
    "button[aria-label*='Send' i]",
    "button[type='submit']",
    "input[type='submit']",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el instanceof Element && isVisible(el)) return el;
  }
  return null;
}

/**
 * Detect if the input is showing a length validation error AFTER submit attempts
 * have already failed. Only checks strong signals to avoid false positives.
 */
function detectLengthError(inputEl) {
  const currentLen = getInputText(inputEl).length;
  if (!currentLen) return null;

  // Hard signal: maxlength attribute exceeded
  const maxLen = inputEl.getAttribute?.("maxlength");
  if (maxLen && currentLen > Number(maxLen)) {
    return { error: "message_too_long", maxLength: Number(maxLen), currentLength: currentLen };
  }

  // Look for visible error text explicitly about length in the nearest container
  const parent = inputEl.closest?.("form") || inputEl.parentElement;
  if (parent) {
    const errorEls = parent.querySelectorAll(
      "[class*='error' i], [class*='invalid' i], [class*='limit' i], [role='alert']"
    );
    for (const el of errorEls) {
      if (!el.offsetParent && el.offsetWidth === 0) continue;
      const text = (el.textContent || "").trim().toLowerCase();
      if (
        text.includes("too long") ||
        text.includes("too many char") ||
        text.includes("character limit") ||
        text.includes("max length") ||
        text.includes("exceeds")
      ) {
        const limitMatch =
          text.match(/(\d+)\s*\/\s*(\d+)/) || text.match(/(?:max|limit|maximum)\D*(\d+)/i);
        const maxLength = limitMatch ? Number(limitMatch[2] || limitMatch[1]) : undefined;
        return {
          error: "message_too_long",
          maxLength,
          hint: text.slice(0, 120),
          currentLength: currentLen,
        };
      }
      // Counter pattern like "523/500" where first > second means over limit
      const counter = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (counter && Number(counter[1]) > Number(counter[2])) {
        return {
          error: "message_too_long",
          maxLength: Number(counter[2]),
          currentLength: currentLen,
          hint: text.slice(0, 120),
        };
      }
    }
  }

  // Check aria-invalid BUT only if text is long enough that it's plausibly a length issue
  if (currentLen > 150 && inputEl.getAttribute?.("aria-invalid") === "true") {
    return { error: "message_too_long", hint: "aria-invalid", currentLength: currentLen };
  }

  return null;
}

async function submitWithRetries({ inputEl, desiredMethod, buttonEl, originalText }) {
  const attempts = [];

  const tryClick = async (btn) => {
    if (!btn) return false;
    attempts.push({ action: "click" });
    await sleep(80);
    const disabled = isDisabledButton(btn);
    if (!disabled && typeof btn.click === "function") btn.click();
    else robustClick(btn);
    return await waitForInputToClear(inputEl, { originalText, timeoutMs: 2500 });
  };

  const tryEnterSequential = async () => {
    attempts.push({ action: "enter" });
    pressEnter(inputEl);
    if (await waitForInputToClear(inputEl, { originalText, timeoutMs: 1200 })) return true;
    attempts.push({ action: "meta+enter" });
    pressEnter(inputEl, { metaKey: true });
    if (await waitForInputToClear(inputEl, { originalText, timeoutMs: 1200 })) return true;
    attempts.push({ action: "ctrl+enter" });
    pressEnter(inputEl, { ctrlKey: true });
    return await waitForInputToClear(inputEl, { originalText, timeoutMs: 1200 });
  };

  const globalBtn = findGlobalSendButton();
  const clickTargets = Array.from(new Set([buttonEl, globalBtn].filter(Boolean)));

  for (let i = 0; i < 4; i++) {
    if (desiredMethod === "click") {
      for (const b of clickTargets) if (await tryClick(b)) return { ok: true, attempts };
      if (await tryEnterSequential()) return { ok: true, attempts };
    } else {
      if (await tryEnterSequential()) return { ok: true, attempts };
      for (const b of clickTargets) if (await tryClick(b)) return { ok: true, attempts };
    }
    await sleep(200);
  }

  // All submit attempts failed — now check if the reason is a length validation error.
  const lengthErr = detectLengthError(inputEl);
  if (lengthErr) {
    return {
      ok: false,
      error: "message_too_long",
      maxLength: lengthErr.maxLength,
      currentLength: lengthErr.currentLength,
      hint: lengthErr.hint,
      attempts,
    };
  }

  return { ok: false, attempts };
}

(() => {
  try {
    const plan = globalThis.__OPFOR_PLAN__;
    if (!plan?.inputSelector) return { ok: false, error: "Missing plan.inputSelector" };
    // Never pass deep-selector syntax into querySelector (it will throw). Use deep resolver first.
    const input =
      resolveDeepSelector(plan.inputSelector) || safeQuerySelector(document, plan.inputSelector);
    if (!input) return { ok: false, error: "inputSelector did not match" };

    const injectedText = String(plan.text ?? "hi");
    const setResult = setInputValue(input, injectedText);
    const kind = setResult.kind;

    if (kind === "rejected") {
      return { ok: false, error: "input_is_container", reason: setResult.reason };
    }

    const method = plan?.submit?.method === "click" ? "click" : "enter";
    const btn =
      method === "click" &&
      typeof plan?.submit?.buttonSelector === "string" &&
      plan.submit.buttonSelector
        ? resolveDeepSelector(plan.submit.buttonSelector) ||
          safeQuerySelector(document, plan.submit.buttonSelector)
        : null;

    return (async () => {
      // Give framework time to process the input events before submitting.
      await sleep(250);

      // Verify text was fully set; if truncated, re-attempt with the fallback path.
      const currentText = getInputText(input);
      if (currentText.length < injectedText.length * 0.8 && injectedText.length > 20) {
        setInputValue(input, injectedText);
        await sleep(250);
      }

      const res = await submitWithRetries({
        inputEl: input,
        desiredMethod: method,
        buttonEl: btn instanceof Element ? btn : null,
        originalText: injectedText,
      });
      const result = { ok: res.ok, inputKind: kind, attempts: res.attempts };
      if (res.error === "message_too_long") {
        result.error = "message_too_long";
        result.maxLength = res.maxLength;
        result.currentLength = res.currentLength;
        result.hint = res.hint;
      }
      return result;
    })();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
})();
