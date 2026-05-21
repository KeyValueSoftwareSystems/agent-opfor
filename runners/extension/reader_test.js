// ── Reader Test — snapshot-diff extraction harness ───────────────────────────
// Stand-alone debug page. No AI, no widget finding.
// 1. "Take Snapshot"  → scan active tab for chat container, store text nodes
// 2. "Extract Reply"  → scan again, diff against snapshot, log new text
// ─────────────────────────────────────────────────────────────────────────────

// ── State ────────────────────────────────────────────────────────────────────

let preSnap = null; // { frameId, sel, score, textNodes[], nodeCount, lastNodeText }

async function saveSnap(snap) {
  await chrome.storage.session.set({ readerPreSnap: snap });
}
async function loadSnap() {
  const { readerPreSnap } = await chrome.storage.session.get("readerPreSnap");
  return readerPreSnap ?? null;
}
async function clearSnap() {
  await chrome.storage.session.remove("readerPreSnap");
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $log = document.getElementById("log");
const $snapDot = document.getElementById("snapDot");
const $snapLabel = document.getElementById("snapLabel");
const $snapDetail = document.getElementById("snapDetail");
const $tabUrl = document.getElementById("tabUrl");
const btnSnap = document.getElementById("btnSnap");
const btnExtract = document.getElementById("btnExtract");

// ── Logging ──────────────────────────────────────────────────────────────────

function clearLog() {
  $log.innerHTML = "";
}

function log(msg, kind = "info") {
  if ($log.querySelector(".empty-hint")) $log.innerHTML = "";
  const ts = new Date().toLocaleTimeString("en", { hour12: false });
  const line = document.createElement("span");
  line.className = `log-line ${kind}`;
  line.innerHTML = `<span class="ts">[${ts}]</span> <span class="msg">${escHtml(String(msg))}</span>\n`;
  $log.appendChild(line);
  $log.scrollTop = $log.scrollHeight;
}

function logResult(text) {
  if ($log.querySelector(".empty-hint")) $log.innerHTML = "";
  const line = document.createElement("span");
  line.className = "log-line result";
  line.innerHTML = `<span class="msg">${escHtml(text)}</span>`;
  $log.appendChild(line);
  $log.scrollTop = $log.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Snap status UI ───────────────────────────────────────────────────────────

function setSnapStatus(snap) {
  if (snap) {
    $snapDot.classList.add("ready");
    $snapLabel.textContent = `Snapshot ready — frame ${snap.frameId}`;
    $snapDetail.textContent = `selector: ${snap.sel}  |  score: ${snap.score}  |  ${snap.nodeCount} text nodes  |  last: "${snap.lastNodeText.slice(0, 60)}"`;
    btnExtract.disabled = false;
  } else {
    $snapDot.classList.remove("ready");
    $snapLabel.textContent = "No snapshot taken";
    $snapDetail.textContent = 'Click "Take Snapshot" before sending a message in the chat widget';
    btnExtract.disabled = true;
  }
}

// ── Container scanner (injected into page) ───────────────────────────────────
// Must be a plain serialisable function — no outer-scope references.

function scanFrameForContainer() {
  const CHAT_CLS = /message[s_-]|chat[_\b-]|conversation|transcript|chatlog|msg[_-]list/i;
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

  // ── Pass 2: promote parents of repeated children ─────────────────────────
  // Works for TWO cases:
  //
  // A) Semantic sites: multiple scored <li class="chatbot__message"> share a
  //    parent — promote that parent (original fix).
  //
  // B) Tailwind/utility sites: elements sharing the same data-testid (e.g.
  //    data-testid="ai-search-results" × 5) or the same tag+class fingerprint
  //    under ONE parent — promote that parent even if it scored 0 itself.

  const parentMap = new Map(); // parent → scored children[]
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

  // B) Repeated attribute VALUE under same parent (Tailwind/headless: data-testid,
  //    data-automation, etc.)
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

  // C) Elements carrying a unique-per-message ID attribute are individual messages —
  //    promote their direct parent as the message list.  Handles hashed-CSS sites like
  //    TripAdvisor (data-message-id) where message divs score 0 on semantic signals.
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

  // Sort: higher score first; on ties prefer more text content
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.el.textContent?.length || 0) - (a.el.textContent?.length || 0);
  });

  // Top 5 for logging
  const top = candidates.slice(0, 5).map((c) => ({
    score: c.score,
    tag: c.el.tagName.toLowerCase(),
    role: c.el.getAttribute?.("role") || "",
    aria: c.el.getAttribute?.("aria-label") || "",
    cls: (typeof c.el.className === "string" ? c.el.className : "").slice(0, 80),
    id: c.el.id || "",
    testid: c.el.getAttribute?.("data-testid") || "",
  }));

  const best = candidates[0].el;

  // Collect text at MESSAGE level — not raw text nodes, not giant wrappers.
  //
  // Rules:
  //   text >= 20 AND <= 1000 chars → this element is one message unit, capture it
  //   text > 1000 chars            → wrapper containing multiple messages, recurse deeper
  //   text < 20 chars              → word span / icon / short label, recurse deeper
  //
  // This handles:
  //   - Typing-animated widgets (Ada): words in individual <span>s, parent <li>
  //     has full message text in 20-1000 range → captured as one string ✓
  //   - Standard chat lists: <li class="message"> 50-300 chars → captured ✓
  //   - Wrapper divs holding all messages (2000+ chars) → recursed through ✓
  const rawNodes = [];
  const MIN_MSG = 20;
  const MAX_MSG = 1000;

  // Interactive ARIA roles that are never message content
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

  function collectText(node, depth) {
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
      if (SKIP_ROLES.has(role)) return; // skip rating widgets, toolbars, etc.
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length >= MIN_MSG && text.length <= MAX_MSG) {
        rawNodes.push(text);
        return; // message-sized unit — stop here
      }
      // Too big (wrapper) or too small (word span) — keep recursing
    }
    for (const child of node.childNodes || []) collectText(child, depth + 1);
    if (node.shadowRoot)
      for (const child of node.shadowRoot.childNodes || []) collectText(child, depth + 1);
  }

  for (const child of best.childNodes || []) collectText(child, 0);
  if (best.shadowRoot) for (const child of best.shadowRoot.childNodes || []) collectText(child, 0);

  // Deduplicate consecutive identical strings
  const textNodes = rawNodes.filter((t, i) => i === 0 || t !== rawNodes[i - 1]);

  // Build a readable selector for the best element
  let sel = best.tagName.toLowerCase();
  if (best.id) {
    sel = "#" + best.id;
  } else if (typeof best.className === "string" && best.className.trim()) {
    const parts = best.className.trim().split(/\s+/).slice(0, 2);
    sel = best.tagName.toLowerCase() + "." + parts.join(".");
  }

  return {
    ok: true,
    sel,
    score: candidates[0].score,
    top,
    textNodes,
    fullText: textNodes.join("\n"),
    nodeCount: textNodes.length,
    lastNodeText: textNodes[textNodes.length - 1] || "",
  };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

// Some widgets prepend changing timestamps ("Just now" → "1:04 am") to the
// message element's textContent. Strip those before comparing so a timestamp
// flip doesn't look like a brand-new node and trigger full-divergence.
function stripLeadingTimestamp(text) {
  return text
    .replace(/^\d{1,2}:\d{2}\s*(?:[ap]m)?\s*/i, "") // "1:04 am", "12:30 PM"
    .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\s+\d{1,2}:\d{2}.*?\s*/i, "") // "Mon 3:45 PM"
    .replace(/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\s*/i, "") // "May 19"
    .replace(/^yesterday\s*(?:at\s*)?\d{1,2}:\d{2}.*?\s*/i, "") // "Yesterday at 1:04 pm"
    .replace(/^yesterday\s*/i, "") // bare "Yesterday"
    .replace(/^today\s*(?:at\s*)?\d{1,2}:\d{2}.*?\s*/i, "") // "Today at 1:04 pm"
    .replace(/^just now\s*/i, "") // "Just now"
    .replace(/^\d+\s*(?:second|minute|hour|day)s?\s*ago\s*/i, "") // "2 min ago"
    .trim();
}

function diffTextNodes(pre, post) {
  // Normalised copies used only for comparison; original text is returned.
  const preNorm = pre.map(stripLeadingTimestamp);
  const postNorm = post.map(stripLeadingTimestamp);

  // Find first divergence index
  let i = 0;
  while (i < preNorm.length && i < postNorm.length && preNorm[i] === postNorm[i]) i++;

  const candidates = post.slice(i);

  // Sticky UI elements (footer buttons, legal text, etc.) exist in pre AND post.
  // Compare using normalised forms so a timestamp change doesn't bypass the filter.
  const preNormSet = new Set(preNorm);
  const filtered = candidates.filter((t) => !preNormSet.has(stripLeadingTimestamp(t)));

  // If filtering removed everything (bot echoed existing text), fall back to unfiltered
  const result = filtered.length > 0 ? filtered : candidates;

  // Guard: if result is almost everything, DOM re-rendered — filter from full post
  if (result.length > post.length * 0.8 && post.length > 5) {
    const fullFiltered = post.filter((t) => !preNormSet.has(stripLeadingTimestamp(t)));
    return {
      text: fullFiltered.join("\n"),
      note: `full-rerender, filtered ${post.length - fullFiltered.length} existing nodes`,
    };
  }

  return {
    text: result.join("\n"),
    note: `diverged at index ${i}, removed ${candidates.length - result.length} sticky nodes`,
  };
}

// ── Core actions ─────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runScanAllFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: scanFrameForContainer,
  });

  const all = results
    .filter((r) => r.result?.ok)
    .map((r) => ({ frameId: r.frameId, ...r.result }))
    .sort((a, b) => b.score - a.score);

  // Chat containers almost always live in iframes (frameId !== 0).
  // The main frame often has nav/button elements whose class names or IDs
  // accidentally match the chat heuristics — prefer iframe results first.
  const iframeHits = all.filter((h) => h.frameId !== 0);
  return iframeHits.length > 0 ? iframeHits : all;
}

async function handleTakeSnapshot() {
  btnSnap.disabled = true;
  try {
    const tab = await getActiveTab();
    $tabUrl.textContent = tab.url || "—";

    log("── Take Snapshot ──────────────────────────────", "head");
    log(`tab ${tab.id}  ${tab.url}`);

    const hits = await runScanAllFrames(tab.id);

    if (!hits.length) {
      log("No container candidates found in any frame", "warn");
      preSnap = null;
      await clearSnap();
      setSnapStatus(null);
      return;
    }

    // Log all frames that found something
    for (const h of hits) {
      log(
        `frame ${h.frameId}  score=${h.score}  sel="${h.sel}"  nodes=${h.nodeCount}  last="${h.lastNodeText.slice(0, 60)}"`,
        "data"
      );
      log(`  top candidates:`, "data");
      for (const c of h.top) {
        log(
          `    score=${c.score} <${c.tag}> role="${c.role}" aria="${c.aria}" cls="${c.cls.slice(0, 60)}" id="${c.id}" testid="${c.testid}"`,
          "data"
        );
      }
    }

    // Best across all frames
    preSnap = hits[0];
    await saveSnap(preSnap);
    setSnapStatus(preSnap);

    log(`Selected: frame ${preSnap.frameId}  "${preSnap.sel}"  ${preSnap.nodeCount} nodes`, "ok");
    log(`Last node: "${preSnap.lastNodeText.slice(0, 100)}"`, "data");
    log("Snapshot stored. Now send your message, then click Extract Reply.", "info");
  } catch (e) {
    log(`Error: ${e.message}`, "err");
    console.error("[reader_test] snapshot error", e);
  } finally {
    btnSnap.disabled = false;
  }
}

async function handleExtract() {
  if (!preSnap) {
    log("No snapshot — take one first", "warn");
    return;
  }
  btnExtract.disabled = true;
  try {
    const tab = await getActiveTab();

    log("── Extract Reply ──────────────────────────────", "head");

    const hits = await runScanAllFrames(tab.id);

    // Find the same frame we snapshotted
    let cur = hits.find((h) => h.frameId === preSnap.frameId);
    if (!cur) {
      log(`frame ${preSnap.frameId} not found — trying best available`, "warn");
      cur = hits[0];
    }

    if (!cur) {
      log("No container found in current scan", "err");
      return;
    }

    log(
      `Current scan: frame ${cur.frameId}  sel="${cur.sel}"  nodes=${cur.nodeCount}  last="${cur.lastNodeText.slice(0, 80)}"`,
      "data"
    );

    const delta = {
      nodeCountDelta: cur.nodeCount - preSnap.nodeCount,
      lastChanged: cur.lastNodeText !== preSnap.lastNodeText,
      fullTextChanged: cur.fullText !== preSnap.fullText,
    };

    log(
      `Δ nodes: ${delta.nodeCountDelta > 0 ? "+" : ""}${delta.nodeCountDelta}  lastChanged: ${delta.lastChanged}  textChanged: ${delta.fullTextChanged}`,
      "data"
    );

    // Always dump first/last few nodes of pre and post so we can see what's captured
    log(`PRE  [0..2]: ${JSON.stringify(preSnap.textNodes.slice(0, 3))}`, "data");
    log(`PRE  [last]: ${JSON.stringify(preSnap.textNodes.slice(-3))}`, "data");
    log(`POST [0..2]: ${JSON.stringify(cur.textNodes.slice(0, 3))}`, "data");
    log(`POST [last]: ${JSON.stringify(cur.textNodes.slice(-3))}`, "data");

    if (!delta.fullTextChanged) {
      log("No change detected — container content identical pre/post.", "warn");
      log(
        "Possible causes: wrong container selected (check sel above), chat in nested iframe, or shadow DOM not traversed.",
        "warn"
      );
      return;
    }

    const { text, note } = diffTextNodes(preSnap.textNodes, cur.textNodes);

    log(`Diff note: ${note}`, "data");

    if (text.trim()) {
      log("── Extracted reply ──────────────────────────────", "ok");
      logResult(text.trim());
    } else {
      log("Diff produced empty text — inspect candidates above", "warn");
    }
  } catch (e) {
    log(`Error: ${e.message}`, "err");
    console.error("[reader_test] extract error", e);
  } finally {
    btnExtract.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

btnSnap.addEventListener("click", handleTakeSnapshot);
btnExtract.addEventListener("click", handleExtract);
document.getElementById("btnClearLog").addEventListener("click", () => {
  clearLog();
});

// Restore snapshot and tab URL on open
(async () => {
  try {
    const tab = await getActiveTab();
    if (tab?.url) $tabUrl.textContent = tab.url;
  } catch {}

  try {
    const saved = await loadSnap();
    if (saved) {
      preSnap = saved;
      setSnapStatus(preSnap);
      log("Snapshot restored from previous session.", "data");
    }
  } catch {}
})();
