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
  // Lowered from 20 → 2 so terse bot replies ("Done.", "Order #4521 shipped.")
  // are captured instead of being silently dropped. MAX raised to a large sanity
  // bound because per-message granularity now comes from block-structure (see
  // collectText), not an arbitrary character cap.
  const MIN_MSG = 2;
  const MAX_MSG = 20000;

  // Inline tags never count as block-level message containers — their text is
  // part of the surrounding block, so we must NOT recurse past their parent
  // (that would lose the plain-text siblings around <strong>, <a>, etc.).
  const INLINE_TAGS = new Set([
    "a",
    "b",
    "i",
    "em",
    "strong",
    "span",
    "code",
    "small",
    "sub",
    "sup",
    "mark",
    "u",
    "s",
    "abbr",
    "cite",
    "q",
    "time",
    "label",
    "kbd",
    "samp",
    "var",
    "wbr",
    "bdi",
    "bdo",
    "del",
    "ins",
    "br",
    "img",
    "svg",
    "picture",
  ]);

  function isBlockish(el) {
    const tag = el.tagName?.toLowerCase();
    if (tag && INLINE_TAGS.has(tag)) return false;
    try {
      const d = window.getComputedStyle(el).display;
      return !(d === "inline" || d === "inline-block" || d === "contents" || d === "none");
    } catch {
      return true; // assume block when style is unavailable
    }
  }

  // Count block-level child elements that carry their own text. ≥1 means this node
  // is a CONTAINER of sub-blocks (transcript, message list, message row) and we
  // should recurse into it; 0 means it's a leaf text block (a single message /
  // paragraph) safe to capture as one node. This is what stops a short transcript
  // from collapsing into a single mega-node (which broke the diff + echo filter).
  function blockTextChildren(node) {
    let n = 0;
    for (const c of node.children || []) {
      if (!isBlockish(c)) continue;
      const t = (c.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= MIN_MSG) {
        n++;
        if (n >= 1) break;
      }
    }
    return n;
  }

  // Structure-aware replacement for a leaf node's flat textContent. Raw textContent
  // drops every boundary, so a <br>-separated list or stacked <p>s collapse into one
  // run-on string ("...structured.""Ask one..." welded together). Inserts a newline
  // at <br> and block-element edges, and bullet/number markers for list items, so the
  // captured text keeps the shape the agent actually rendered.
  // Ordered-list label for `li`: an explicit value="N" wins, otherwise its position
  // in the parent plus the list's start="N" (default 1).
  function liMarker(li) {
    const p = li.parentElement;
    if (!p || p.tagName?.toLowerCase() !== "ol") return "- ";
    const explicit = parseInt(li.getAttribute("value") || "", 10);
    if (Number.isFinite(explicit)) return explicit + ". ";
    const start = parseInt(p.getAttribute("start") || "1", 10) || 1;
    return Array.prototype.indexOf.call(p.children, li) + start + ". ";
  }

  function blockAwareText(el) {
    let s = "";
    // One break per boundary — emitting unconditionally around every block would put
    // a blank line between adjacent list items; the guard also leaves literal blank
    // lines already inside text nodes (e.g. code blocks) untouched.
    const nl = () => {
      if (s && !s.endsWith("\n")) s += "\n";
    };
    // collectText can hand us a single <li> as the leaf itself (no block-level
    // children of its own) — walk() below only adds markers for <li>s it meets while
    // iterating a parent's children, so the root's own marker has to be seeded here.
    if (el.tagName?.toLowerCase() === "li") s += liMarker(el);
    const walk = (node) => {
      for (const n of node.childNodes || []) {
        if (n.nodeType === 3) {
          s += n.nodeValue || "";
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName?.toLowerCase();
        if (tag === "script" || tag === "style") continue;
        if (tag === "br") {
          s += "\n";
          continue;
        }
        const isCell = tag === "td" || tag === "th";
        // Cells stay on one line — the row (<tr>) supplies the break.
        const block = isBlockish(n) && !isCell;
        if (block) nl();
        if (tag === "li") {
          s += liMarker(n);
        } else if (isCell && n.previousElementSibling) {
          s += " | ";
        }
        walk(n);
        if (block) nl();
      }
    };
    walk(el);
    return s;
  }

  // Collapse horizontal whitespace but keep line breaks (max one blank line).
  function normalizeBlockText(s) {
    return s
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ── Text collector (shared by both fast and full paths) ──────────────────────
  function collectText(node, depth, out) {
    if (!node || depth > 25) return;
    if (node.nodeType === 1) {
      try {
        const st = window.getComputedStyle(node);
        if (st.display === "none" || st.visibility === "hidden") return;
      } catch {
        /* swallowed */
      }
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
      const rawText = (node.textContent || "").replace(/\s+/g, " ").trim();
      // Capture only LEAF text blocks (no block-level child carries its own text).
      // Containers fall through and recurse, so each message becomes its own node.
      if (rawText.length >= MIN_MSG && rawText.length <= MAX_MSG && blockTextChildren(node) === 0) {
        const text = normalizeBlockText(blockAwareText(node));
        // blockAwareText adds markers/separators after the rawText length check above,
        // so re-check MAX_MSG here too — a large table/list can push it back over.
        if (text.length >= MIN_MSG && text.length <= MAX_MSG) out.push(text);
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

  // ── Fast path: reuse the container from a previous full scan ─────────────────
  // Prefer a direct reference to the element over re-running querySelector on a
  // cached string. String selectors are brittle: hashed/CSS-module class names,
  // dynamic ids (radix-:r3:, which is also invalid CSS and throws), and
  // first-match ambiguity all make the string resolve to the wrong element or
  // none. Holding the node itself is stable until the framework re-renders it.
  const cachedEl = globalThis.__OPFOR_CONTAINER_EL__;
  if (cachedEl && cachedEl.isConnected) {
    try {
      const result = snapshotEl(cachedEl, globalThis.__OPFOR_CONTAINER_SEL__ || "");
      if (result.nodeCount > 0) return result;
      // Element still present but empty — fall through to full scan.
    } catch {
      /* swallowed */
    }
  }

  // Secondary fast path: the cached selector string (used when the page-world
  // element ref was lost, e.g. seeded by the orchestrator across calls).
  const cachedSel = globalThis.__OPFOR_CONTAINER_SEL__;
  if (cachedSel) {
    try {
      const el = document.querySelector(cachedSel);
      if (el) {
        const result = snapshotEl(el, cachedSel);
        if (result.nodeCount > 0) {
          globalThis.__OPFOR_CONTAINER_EL__ = el;
          return result;
        }
      }
    } catch {
      /* swallowed (invalid/dynamic selector) — fall through to full scan */
    }
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
    } catch {
      /* swallowed */
    }
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
        } catch {
          /* swallowed */
        }
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
    } catch {
      /* swallowed */
    }
    for (const [, els] of attrMap) {
      if (els.length < 2) continue;
      const parent = els[0].parentElement;
      if (!parent || !els.every((e) => e.parentElement === parent)) continue;
      try {
        const r = parent.getBoundingClientRect();
        if (r.width > 80 && r.height > 80) {
          candidates.push({ el: parent, score: scoreEl(parent) + els.length * 5 });
        }
      } catch {
        /* swallowed */
      }
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
        } catch {
          /* swallowed */
        }
      }
    } catch {
      /* swallowed */
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.el.textContent?.length || 0) - (a.el.textContent?.length || 0);
  });

  const best = candidates[0].el;

  // Cache the element itself for fast subsequent polls (stable across re-renders
  // that only change attributes). Keep a best-effort selector string as backup.
  let sel = best.tagName.toLowerCase();
  if (best.id && /^[A-Za-z][\w-]*$/.test(best.id)) {
    // Only use #id when it's a static, valid CSS identifier (skip dynamic ids
    // like "radix-:r3:" / ":r0:" that change per render and break querySelector).
    sel = "#" + best.id;
  } else if (typeof best.className === "string" && best.className.trim()) {
    const parts = best.className.trim().split(/\s+/).slice(0, 2);
    sel = best.tagName.toLowerCase() + "." + parts.join(".");
  }
  globalThis.__OPFOR_CONTAINER_EL__ = best;
  globalThis.__OPFOR_CONTAINER_SEL__ = sel;

  const result = snapshotEl(best, sel);
  result.score = candidates[0].score;
  return result;
})();
