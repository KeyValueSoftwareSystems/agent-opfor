// Monkey-patch attachShadow to capture closed shadow roots.
// Must run in MAIN world before the page's scripts create shadow roots.
// Content scripts can then access them via element.__closedShadowRoot.
(() => {
  if (window.__opforShadowPatched) return;
  window.__opforShadowPatched = true;

  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const shadow = origAttachShadow.call(this, init);
    if (init && init.mode === "closed") {
      try {
        Object.defineProperty(this, "__closedShadowRoot", {
          value: shadow,
          configurable: true,
          enumerable: false,
        });
      } catch {}
    }
    return shadow;
  };
})();
