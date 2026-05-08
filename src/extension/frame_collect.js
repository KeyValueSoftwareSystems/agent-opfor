function isVisible(el) {
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  if (rect.width < 18 || rect.height < 18) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
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
    } catch {
      // ignore invalid selector in matches()
    }
  }
  return results;
}

function deepPathSelector(el) {
  if (!(el instanceof Element)) return null;
  const parts = [selectorFromEl(el)];
  let cur = el;
  while (cur) {
    const root = cur.getRootNode?.();
    if (root instanceof ShadowRoot) {
      parts.unshift(`shadow(${selectorFromEl(root.host)})`);
      cur = root.host;
      continue;
    }
    break;
  }
  return parts.join(" >> ");
}

function looksLikeSiteSearch(el) {
  if (!(el instanceof Element)) return false;
  const type = (el.getAttribute("type") || "").toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (type === "search") return true;
  if (role === "searchbox") return true;

  const name = (el.getAttribute("name") || "").toLowerCase();
  const id = (el.id || "").toLowerCase();
  const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();

  if (/^(q|query|keyword|search|find|st)$/.test(name) || /\b(search|query)\b/.test(id)) return true;
  if (placeholder.includes("search") && !placeholder.includes("message") && !placeholder.includes("chat")) return true;
  if (aria.includes("search") && !aria.includes("message") && !aria.includes("chat")) return true;

  let p = el.parentElement;
  for (let i = 0; i < 10 && p; i++) {
    const tag = p.tagName?.toLowerCase();
    const pr = p.getAttribute?.("role")?.toLowerCase() || "";
    const cls = (p.className || "").toString().toLowerCase();
    const pid = (p.id || "").toLowerCase();
    if (pr === "search" || tag === "header") return true;
    if (cls.includes("header-search") || cls.includes("site-search") || cls.includes("global-search")) return true;
    if (/\bsearch\b/.test(pid) && !pid.includes("chat")) return true;
    p = p.parentElement;
  }
  return false;
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

  // Help-center site search (AOL, etc.) — never prefer over chat composer
  if (looksLikeSiteSearch(el)) score -= 40;

  if (tag === "textarea") score += 5;
  if (tag === "input" && (type === "text" || type === "")) score += 3;
  if (el.isContentEditable) score += 4;
  if (role === "textbox") score += 2;
  if (blob.includes("message")) score += 4;
  if (blob.includes("chat")) score += 3;
  if (blob.includes("prompt")) score += 2;
  if (blob.includes("compose")) score += 2;
  if (blob.includes("comment")) score += 1;
  // Strongly de-rank search bars
  if (type === "search") score -= 8;
  if (role === "searchbox") score -= 10;
  if (formRole === "search") score -= 8;
  if (blob.includes("search")) score -= 6;
  if (blob.includes("password")) score -= 10;

  // Header/nav search regions (unless clearly chat-labeled)
  if (!blob.includes("chat") && !blob.includes("message")) {
    if (el.closest?.("header, [role='banner'], nav")) score -= 15;
  }

  const rect = el.getBoundingClientRect?.();
  if (rect) {
    const yRatio = rect.top / Math.max(1, window.innerHeight);
    if (yRatio > 0.55) score += 2;
    // Site search often lives in top band
    if (yRatio < 0.22 && looksLikeSiteSearch(el)) score -= 10;
  }
  return score;
}

function describeEl(el) {
  const tag = el.tagName.toLowerCase();
  const attrs = [];
  for (const k of ["id", "name", "role", "aria-label", "placeholder", "data-testid"]) {
    const v = el.getAttribute?.(k);
    if (v) attrs.push(`${k}="${String(v).slice(0, 80)}"`);
  }
  const cls = (el.getAttribute?.("class") || "").trim();
  if (cls) attrs.push(`class="${cls.split(/\s+/).slice(0, 6).join(" ")}"`);
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const textPart = text ? ` text="${text}"` : "";
  return `<${tag} ${attrs.join(" ")}>${textPart}`.trim();
}

function scoreChatSignals() {
  let score = 0;

  const logs = queryAllDeep("[role='log']").filter((el) => el instanceof Element && isVisible(el));
  for (const el of logs) {
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
    const ariaLive = (el.getAttribute("aria-live") || "").toLowerCase();
    if (ariaLive) score += 2;
    if (ariaLabel.includes("chat")) score += 6;
    if (ariaLabel.includes("message")) score += 4;
    if (ariaLabel.includes("messages")) score += 4;
    score += 1;
  }

  // Common chat semantics
  const ariaChatBoxes = Array.from(queryAllDeep("[aria-label]"))
    .filter((el) => el instanceof Element && isVisible(el))
    .map((el) => (el.getAttribute("aria-label") || "").toLowerCase());
  for (const s of ariaChatBoxes) {
    if (s.includes("chat messages")) score += 8;
    if (s.includes("chat")) score += 1;
  }

  // Some vendors use role markers in classes (best-effort)
  const roleAssistant = queryAllDeep("[class*='role-assistant' i], [class*='assistant' i]").length;
  if (roleAssistant) score += Math.min(6, roleAssistant);

  // Message list structures
  const ols = queryAllDeep("ol li").length;
  if (ols > 5) score += 2;

  return score;
}

function collectSanitizedDomSnapshot() {
  const lines = [];
  lines.push(`frame_url="${location.href}"`);

  const chatScore = scoreChatSignals();
  const chatLogs = Array.from(queryAllDeep("[role='log']")).filter((el) => el instanceof Element && isVisible(el));
  if (chatLogs.length) {
    lines.push("");
    lines.push("CHAT_SIGNALS:");
    for (const el of chatLogs.slice(0, 6)) {
      const ariaLabel = el.getAttribute("aria-label");
      lines.push(
        `- selector="${deepPathSelector(el)}" role="log" aria-label="${String(ariaLabel || "").slice(0, 120)}" ${describeEl(el)}`
      );
    }
  }

  const inputs = Array.from(queryAllDeep("textarea, input, [contenteditable='true'], [role='textbox']"))
    .filter((el) => el instanceof Element && isVisible(el))
    .filter((el) => {
      if (el instanceof HTMLInputElement) {
        const t = (el.type || "").toLowerCase();
        if (["hidden", "checkbox", "radio", "file", "submit", "button", "range", "color", "date", "datetime-local"].includes(t)) return false;
        if (t === "password") return false;
      }
      return true;
    });

  lines.push("");
  lines.push("CANDIDATE_INPUTS:");
  for (const el of inputs.slice(0, 40)) {
    const rect = el.getBoundingClientRect?.();
    const pos = rect ? `pos=${Math.round(rect.left)},${Math.round(rect.top)} size=${Math.round(rect.width)}x${Math.round(rect.height)}` : "";
    const ss = looksLikeSiteSearch(el) ? " site_search_hint=1" : "";
    lines.push(`- score=${scoreInput(el)}${ss} selector="${deepPathSelector(el)}" ${pos} ${describeEl(el)}`);
  }

  const buttons = Array.from(queryAllDeep("button, [role='button'], input[type='submit']"))
    .filter((el) => el instanceof Element && isVisible(el))
    .slice(0, 60);

  lines.push("");
  lines.push("CANDIDATE_BUTTONS:");
  for (const el of buttons) {
    const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
    const text = (el.textContent || "").trim().toLowerCase();
    const looksLikeSend = aria.includes("send") || text === "send" || text.includes("send") || text.includes("submit");
    lines.push(`- ${looksLikeSend ? "sendish=1" : "sendish=0"} selector="${deepPathSelector(el)}" ${describeEl(el)}`);
  }

  return {
    ok: true,
    frameUrl: location.href,
    snapshot: lines.join("\n").slice(0, 60_000),
    inputCount: inputs.length
    ,
    chatScore
  };
}

(() => collectSanitizedDomSnapshot())();

