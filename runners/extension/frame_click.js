function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

      const hosts = queryAll(root, hostSel).filter((h) => h instanceof Element && h.shadowRoot);
      for (const host of hosts) {
        const out = resolveFrom(host.shadowRoot, idx + 1);
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

function isVisible(el) {
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  if (rect.width < 8 || rect.height < 8) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function robustClick(el) {
  if (!(el instanceof Element)) return;
  try {
    el.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  } catch {
    /* swallowed */
  }
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

(async () => {
  try {
    const sel = globalThis.__OPFOR_CLICK_SELECTOR__;
    if (typeof sel !== "string" || !sel.trim())
      return { ok: false, error: "Missing __OPFOR_CLICK_SELECTOR__" };
    const el = resolveDeepSelector(sel) || safeQuerySelector(document, sel);
    if (!(el instanceof Element)) return { ok: false, error: "Selector did not match" };
    if (!isVisible(el)) return { ok: false, error: "Target not visible" };

    try {
      el.click?.();
    } catch {
      /* swallowed */
    }
    robustClick(el);
    await sleep(250);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
})();
