// Runs in MAIN world to send a message via the vendor input found by frame_vendor_api.js.
// Receives the text to send via globalThis.__astraVendorText.
(() => {
  const text = globalThis.__astraVendorText || "";
  if (!text) return { ok: false, error: "no_text" };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function fireEvents(el) {
    for (const type of ["input", "change", "keyup"]) {
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true }));
    }
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
                  el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
    if (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) { desc.set.call(el, value); fireEvents(el); return true; }
    }
    el.value = value;
    fireEvents(el);
    return true;
  }

  function findSendButton(root) {
    const candidates = [];
    const walk = (node, depth) => {
      if (depth > 12 || !node) return;
      const children = node.children || node.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!(child instanceof Element)) continue;
        candidates.push(child);
        const shadow = child.shadowRoot || child.__closedShadowRoot;
        if (shadow) walk(shadow, depth + 1);
        walk(child, depth + 1);
      }
    };
    walk(root, 0);
    for (const el of candidates) {
      const tag = el.tagName?.toLowerCase() || "";
      const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
      const title = (el.getAttribute?.("title") || "").toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      const blob = `${aria} ${title} ${text}`;
      if ((tag === "button" || el.getAttribute?.("role") === "button") &&
          (blob.includes("send") || blob.includes("submit"))) {
        const rect = el.getBoundingClientRect?.();
        if (rect && rect.width > 10 && rect.height > 10) return el;
      }
    }
    return null;
  }

  async function run() {
    const input = globalThis.__astraVendorInput;
    if (!input || !(input instanceof Element)) return { ok: false, error: "no_vendor_input_ref" };

    const rect = input.getBoundingClientRect?.();
    if (!rect || rect.width < 5) return { ok: false, error: "input_not_visible" };

    input.focus?.();
    await sleep(100);

    if (input.isContentEditable) {
      input.textContent = "";
      document.execCommand("insertText", false, text);
      if (!input.textContent.includes(text.slice(0, 20))) {
        input.textContent = text;
      }
      fireEvents(input);
    } else {
      setNativeValue(input, text);
    }
    await sleep(200);

    // Find and click send button
    let root = input;
    for (let i = 0; i < 10 && root.parentElement; i++) root = root.parentElement;
    const rootShadow = root.getRootNode?.();
    const sendBtn = findSendButton(rootShadow || root) || findSendButton(document);
    if (sendBtn) {
      sendBtn.click();
      sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
      await sleep(300);
      return { ok: true, method: "vendor_click" };
    }

    // Fallback: press Enter
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, composed: true }));
    await sleep(300);
    return { ok: true, method: "vendor_enter" };
  }

  return run();
})();
