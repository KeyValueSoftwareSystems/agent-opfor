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
    .filter((x) => x.t.length > 0);
  const last = items[items.length - 1]?.t;
  return last || textOf(best) || null;
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

(() => {
  const text = extractFromRoleLog() || extractByCommonLabels();
  if (!text) return { ok: false, error: "No transcript text found in this frame." };
  return { ok: true, text };
})();

