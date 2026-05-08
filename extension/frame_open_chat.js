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

/** Links to AOL product/checkout pages — clicking these navigates away instead of opening chat. */
function isProductOrSignupNavLink(el) {
  if (!(el instanceof HTMLAnchorElement)) return false;
  const raw = el.getAttribute("href") || "";
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return false;
  try {
    const u = new URL(raw, location.href);
    const p = u.pathname.toLowerCase();
    const h = u.hostname.toLowerCase();
    if (h.includes("aol.com") && p.includes("/products/")) return true;
    if (p.includes("live-support-plus") || p.includes("live_support_plus")) return true;
    if (p.includes("/products/") && (p.includes("tech-support") || p.includes("bundle")))
      return true;
  } catch {
    if (/\/products\/|live-support-plus/i.test(raw)) return true;
  }
  return false;
}

function robustClick(el) {
  if (!(el instanceof Element)) return;
  try {
    el.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  } catch {}
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

function findLikelyChatLauncherButtons() {
  const btns = Array.from(
    document.querySelectorAll("button, [role='button'], a[role='button'], a, summary")
  ).filter((el) => el instanceof Element && isVisible(el) && !isProductOrSignupNavLink(el));

  const scored = btns
    .map((el) => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
      const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
      const title = (el.getAttribute?.("title") || "").toLowerCase();
      const blob = `${text} ${aria} ${title}`.trim();
      let s = 0;
      // Prefer real controls over marketing links (same keywords often appear on "Try Live Support Plus" CTAs)
      if (el instanceof HTMLAnchorElement) s -= 6;
      if (
        blob.includes("try it free") ||
        blob.includes("try free") ||
        /\border\b.*\bnow\b/.test(blob)
      )
        s -= 15;
      if (blob.includes("start a conversation") || blob.includes("start conversation")) s += 12;
      if (blob.includes("live expert") || blob.includes("get live")) s += 12;
      if (blob.includes("live chat")) s += 10;
      if (blob.includes("chat now") || blob.includes("message us")) s += 9;
      if (blob.includes("need help")) s += 7;
      // "Contact us" is frequently a navigation CTA, not a chat launcher.
      if (blob.includes("contact us") || blob.includes("contact")) s -= 6;
      if (blob.includes("virtual assistant") || blob.includes("ask us")) s += 8;
      if (blob.includes("chat")) s += 5;
      if (blob.includes("help")) s += 2;
      if (blob.includes("support")) s += 3;
      if (blob.includes("search")) s -= 8;
      if (blob.includes("sign in") || blob.includes("log in")) s -= 2;
      return { el, s };
    })
    .filter((x) => x.s >= 5)
    .sort((a, b) => b.s - a.s);

  return scored.map((x) => x.el).slice(0, 5);
}

function isProbablyFloatingWidget(el) {
  if (!(el instanceof Element)) return false;
  const style = window.getComputedStyle(el);
  const pos = style.position;
  const rect = el.getBoundingClientRect?.();
  if (!rect) return false;

  const cls = ((el.className || "") + "").toLowerCase();
  const id = (el.id || "").toLowerCase();
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const vendorHint =
    /chat|messenger|support|widget|intercom|zendesk|drift|genesys|salesforce|qualified|ada|forethought/.test(
      `${cls} ${id} ${aria}`
    );

  // Bottom-right overlays (fixed/sticky) — typical embed chat launchers
  if (pos === "fixed" || pos === "sticky") {
    const nearRight = rect.right > window.innerWidth * 0.62;
    const nearBottom =
      rect.bottom > window.innerHeight * 0.72 || rect.top > window.innerHeight * 0.55;
    if (
      nearRight &&
      nearBottom &&
      rect.width <= window.innerWidth * 0.55 &&
      rect.height <= window.innerHeight * 0.45
    )
      return true;
  }

  // Fixed bubble hugging bottom edge (some AOL / legacy widgets)
  if (
    pos === "fixed" &&
    rect.bottom >= window.innerHeight - 140 &&
    rect.right >= window.innerWidth * 0.55 &&
    rect.width < 120 &&
    rect.height < 120
  )
    return true;

  if (
    vendorHint &&
    pos === "fixed" &&
    rect.width < window.innerWidth * 0.45 &&
    rect.height < window.innerHeight * 0.35
  )
    return true;

  return false;
}

function scoreFloatingWidget(el) {
  let s = 0;
  const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
  const title = (el.getAttribute?.("title") || "").toLowerCase();
  const id = (el.getAttribute?.("id") || "").toLowerCase();
  const cls = (el.getAttribute?.("class") || "").toLowerCase();
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
  const blob = `${aria} ${title} ${id} ${cls} ${text}`.trim();

  if (blob.includes("live expert") || blob.includes("chat")) s += 8;
  if (blob.includes("help") || blob.includes("support") || blob.includes("assistant")) s += 5;
  if (blob.includes("conversation")) s += 2;
  if (blob.includes("search") || blob.includes("cookie")) s -= 6;

  const rect = el.getBoundingClientRect?.();
  if (rect) {
    const area = rect.width * rect.height;
    if (area >= 900 && area <= 40_000) s += 2;
    const nearCorner =
      rect.right > window.innerWidth * 0.9 && rect.bottom > window.innerHeight * 0.9;
    if (nearCorner) s += 2;
  }

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
    if (isProductOrSignupNavLink(el)) continue;
    if (!isProbablyFloatingWidget(el)) continue;
    const tag = el.tagName.toLowerCase();
    const clickable =
      tag === "button" ||
      tag === "a" ||
      el.getAttribute("role") === "button" ||
      typeof el.onclick === "function";
    if (!clickable) continue;
    candidates.push(el);
  }

  return candidates
    .map((el) => ({ el, s: scoreFloatingWidget(el) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.el)
    .slice(0, 5);
}

(() => {
  // Singtel: if the Ask Shirley widget iframe is already present, do NOT click anything.
  // Clicking other “support/contact” CTAs can navigate away and break the run.
  try {
    const shirleyFrame =
      document.querySelector("iframe#ChatWindow[src*='shirley-prod.singtel.com']") ||
      document.querySelector("iframe[src*='shirley-prod.singtel.com']");
    if (shirleyFrame) {
      return { ok: true, clicked: false, reason: "shirley_iframe_present" };
    }
  } catch {}

  const launchers = findLikelyChatLauncherButtons();
  const floaters = findFloatingWidgetCandidates();

  const candidates = [];
  // Floaters first: bottom-right chat bubble is usually the real widget; launchers often duplicate "Live support" promos that are `<a href=/products/...>`.
  for (const el of floaters)
    candidates.push({ kind: "floating", el, s: scoreFloatingWidget(el) + 120 });
  for (const el of launchers) candidates.push({ kind: "launcher", el, s: 100 });

  if (!candidates.length) return { ok: true, clicked: false };

  const best = candidates.sort((a, b) => b.s - a.s)[0];
  try {
    // Some sites ignore programmatic .click() for overlays; use both.
    try {
      best.el.click();
    } catch {}
    robustClick(best.el);
    return { ok: true, clicked: true, kind: best.kind, selector: selectorFromEl(best.el) };
  } catch (e) {
    return { ok: true, clicked: false, error: e instanceof Error ? e.message : String(e) };
  }
})();
