// Injected into a page frame via chrome.scripting.executeScript({ files: ["frame_snapshot.js"] }).
// Scans the frame for the best chat container and returns a text-node snapshot.
//
// Fast path: if globalThis.__OPFOR_CONTAINER_SEL__ is set (by a prior full scan),
// the expensive walkDOM + scoring is skipped and the container is queried directly.
//
// Returns:
//   { ok: true,  sel, score, textNodes, fullText, nodeCount, lastNodeText }
//   { ok: false, error }

(() => {
  const SKIP_ROLES = new Set([
    "button",
    "radio",
    "radiogroup",
    "checkbox",
    "slider",
    "toolbar",
    "tab",
    "tablist",
    "menuitem",
    "option",
  ]);
  const MIN_MSG = 20;
  const MAX_MSG = 1000;

  // ── Text collector (shared by both fast and full paths) ──────────────────────
  function collectText(node, depth, out) {
    if (!node || depth > 15) return;
    if (node.nodeType === 1) {
      try {
        const st = window.getComputedStyle(node);
        if (st.display === "none" || st.visibility === "hidden") return;
      } catch {}
      const tag = node.tagName?.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "button"
      )
        return;
      const role = (node.getAttribute?.("role") || "").toLowerCase();
      if (SKIP_ROLES.has(role)) return;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length >= MIN_MSG && text.length <= MAX_MSG) {
        out.push(text);
        return;
      }
    }
    for (const child of node.childNodes || []) collectText(child, depth + 1, out);
    if (node.shadowRoot) {
      for (const child of node.shadowRoot.childNodes || []) collectText(child, depth + 1, out);
    }
  }

  function snapshotEl(el, sel) {
    const raw = [];
    for (const child of el.childNodes || []) collectText(child, 0, raw);
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes || []) collectText(child, 0, raw);
    }
    const textNodes = raw.filter((t, i) => i === 0 || t !== raw[i - 1]);
    return {
      ok: true,
      sel,
      score: 0,
      textNodes,
      fullText: textNodes.join("\n"),
      nodeCount: textNodes.length,
      lastNodeText: textNodes[textNodes.length - 1] || "",
    };
  }

  // ── Fast path: reuse selector from previous full scan ────────────────────────
  const cachedSel = globalThis.__OPFOR_CONTAINER_SEL__;
  if (cachedSel) {
    try {
      const el = document.querySelector(cachedSel);
      if (el) {
        const result = snapshotEl(el, cachedSel);
        if (result.nodeCount > 0) return result;
        // Container found but empty — fall through to full scan
      }
    } catch {}
  }

  // ── Full scan ─────────────────────────────────────────────────────────────────
  const CHAT_CLS = /message[s_-]|chat[_-]|conversation|transcript|chatlog|msg[_-]list/i;
  const CHAT_ARIA = /message|chat|conversation/i;

  function scoreEl(el) {
    let s = 0;
    const role = (el.getAttribute?.("role") || "").toLowerCase();
    const aria = el.getAttribute?.("aria-label") || "";
    const cls = typeof el.className === "string" ? el.className : "";
    const tid = el.getAttribute?.("data-testid") || "";
    const id = el.id || "";
    if (role === "log" || role === "feed") s += 10;
    if (CHAT_ARIA.test(aria)) s += 8;
    if (CHAT_CLS.test(tid)) s += 7;
    if (CHAT_CLS.test(cls)) s += 6;
    if (CHAT_CLS.test(id)) s += 6;
    try {
      const ov = window.getComputedStyle(el).overflowY;
      if (ov === "auto" || ov === "scroll") s += 4;
    } catch {}
    return s;
  }

  const candidates = [];

  function walkDOM(root) {
    const all = root.querySelectorAll?.("*") || [];
    for (const el of all) {
      const s = scoreEl(el);
      if (s >= 4) {
        try {
          const r = el.getBoundingClientRect();
          if (r.width > 80 && r.height > 80) candidates.push({ el, score: s });
        } catch {}
      }
      if (el.shadowRoot) walkDOM(el.shadowRoot);
    }
  }
  walkDOM(document);

  if (!candidates.length) return { ok: false, error: "no candidates found" };

  // Pass 2a: promote parents of 2+ scored children
  const parentMap = new Map();
  for (const c of candidates) {
    const p = c.el.parentElement;
    if (p) {
      if (!parentMap.has(p)) parentMap.set(p, []);
      parentMap.get(p).push(c);
    }
  }
  for (const [parent, children] of parentMap) {
    if (children.length >= 2) {
      candidates.push({ el: parent, score: scoreEl(parent) + children.length * 4 });
    }
  }

  // Pass 2b: repeated attribute VALUE under same parent (data-testid, data-automation)
  const REPEATED_VALUE_ATTRS = ["data-testid", "data-automation"];
  for (const attrName of REPEATED_VALUE_ATTRS) {
    const attrMap = new Map();
    try {
      for (const el of document.querySelectorAll(`[${attrName}]`)) {
        const val = el.getAttribute(attrName);
        if (!val) continue;
        if (!attrMap.has(val)) attrMap.set(val, []);
        attrMap.get(val).push(el);
      }
    } catch {}
    for (const [, els] of attrMap) {
      if (els.length < 2) continue;
      const parent = els[0].parentElement;
      if (!parent || !els.every((e) => e.parentElement === parent)) continue;
      try {
        const r = parent.getBoundingClientRect();
        if (r.width > 80 && r.height > 80) {
          candidates.push({ el: parent, score: scoreEl(parent) + els.length * 5 });
        }
      } catch {}
    }
  }

  // Pass 2c: unique-per-message ID attributes (data-message-id, etc.)
  const MSG_ID_ATTRS = ["data-message-id", "data-node-id", "data-message-author", "data-item-id"];
  for (const attrName of MSG_ID_ATTRS) {
    try {
      const els = [...document.querySelectorAll(`[${attrName}]`)];
      if (els.length < 2) continue;
      const msgParent = new Map();
      for (const el of els) {
        const p = el.parentElement;
        if (!p) continue;
        if (!msgParent.has(p)) msgParent.set(p, []);
        msgParent.get(p).push(el);
      }
      for (const [parent, children] of msgParent) {
        if (children.length < 2) continue;
        try {
          const r = parent.getBoundingClientRect();
          if (r.width > 80 && r.height > 80) {
            candidates.push({ el: parent, score: scoreEl(parent) + children.length * 6 });
          }
        } catch {}
      }
    } catch {}
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.el.textContent?.length || 0) - (a.el.textContent?.length || 0);
  });

  const best = candidates[0].el;

  // Build selector and cache it for fast subsequent polls
  let sel = best.tagName.toLowerCase();
  if (best.id) {
    sel = "#" + best.id;
  } else if (typeof best.className === "string" && best.className.trim()) {
    const parts = best.className.trim().split(/\s+/).slice(0, 2);
    sel = best.tagName.toLowerCase() + "." + parts.join(".");
  }
  globalThis.__OPFOR_CONTAINER_SEL__ = sel;

  const result = snapshotEl(best, sel);
  result.score = candidates[0].score;
  return result;
})();
