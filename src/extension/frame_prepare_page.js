/**
 * Scroll the page so lazy-loaded chat widgets (bottom-right, after scroll) appear.
 * Run in the top frame before frame_open_chat.js
 */
(() => {
  try {
    const docEl = document.documentElement;
    const body = document.body;
    const h = Math.max(docEl.scrollHeight, body?.scrollHeight || 0, docEl.clientHeight);
    const view = window.innerHeight;
    const maxScroll = Math.max(0, h - view * 0.9);

    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      window.scrollTo({ left: 0, top: (maxScroll * i) / steps, behavior: "instant" });
    }
    window.scrollTo({ left: 0, top: maxScroll, behavior: "instant" });

    window.dispatchEvent(new Event("scroll", { bubbles: true }));
    window.dispatchEvent(new Event("resize", { bubbles: true }));
    document.dispatchEvent(new Event("scroll", { bubbles: true }));

    return { ok: true, scrollHeight: h, maxScroll };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
})();
