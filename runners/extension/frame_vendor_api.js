// Runs in MAIN world to access vendor-specific chat widget APIs
// and find inputs inside closed shadow DOM that content scripts cannot reach.
(() => {
  const result = { ok: false, vendor: null, inputFound: false, inputTag: null, method: null };

  function walkShadowRoots(root, depth = 0) {
    if (depth > 15 || !root) return [];
    const found = [];
    const children = root.children || root.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!(child instanceof Element)) continue;
      found.push(child);
      const shadow = child.shadowRoot || child.__closedShadowRoot;
      if (shadow) {
        found.push(...walkShadowRoots(shadow, depth + 1));
      }
      if (depth < 10) {
        found.push(...walkShadowRoots(child, depth + 1));
      }
    }
    return found;
  }

  function findInputInShadowTree(rootEl) {
    const shadow = rootEl.shadowRoot || rootEl.__closedShadowRoot;
    if (!shadow) return null;
    const allEls = walkShadowRoots(shadow);
    for (const el of allEls) {
      const tag = el.tagName?.toLowerCase() || "";
      if (
        tag === "textarea" ||
        tag === "input" ||
        el.isContentEditable ||
        el.getAttribute?.("role") === "textbox"
      ) {
        const rect = el.getBoundingClientRect?.();
        if (rect && rect.width > 20 && rect.height > 10) return el;
      }
    }
    return null;
  }

  // ── Salesforce Embedded Service / Agentforce / MIAW ──
  try {
    const sfWidgets = document.querySelectorAll(
      "embeddedservice-app, embeddedservice-chat-widget, embeddedservice-bootstrap, " +
        "[class*='embeddedServiceHelpButton'], [class*='embeddedServiceSidebar'], " +
        "[class*='embeddedServiceLiveAgent'], [id*='embeddedMessagingFrame'], " +
        "messaging-web-app, messaging-conversation"
    );
    if (sfWidgets.length) {
      result.vendor = "salesforce";
      for (const widget of sfWidgets) {
        const input = findInputInShadowTree(widget);
        if (input) {
          result.inputFound = true;
          result.inputTag = input.tagName?.toLowerCase();
          // Store reference globally so frame_actuate can use it
          globalThis.__opforVendorInput = input;
          result.method = "shadow_traversal";
          result.ok = true;
          return result;
        }
      }
      // Try iframe approach - Salesforce sometimes uses iframes
      const sfIframes = document.querySelectorAll(
        "iframe[name*='chat' i], iframe[src*='salesforce' i], iframe[src*='force.com' i], " +
          "iframe[id*='embeddedMessaging' i], iframe[name*='embeddedMessaging' i]"
      );
      if (sfIframes.length) {
        result.method = "iframe_detected";
        result.ok = true;
        return result;
      }
    }
  } catch {
    /* swallowed */
  }

  // ── Gorgias ──
  try {
    if (typeof window.GorgiasChat !== "undefined") {
      result.vendor = "gorgias";
      result.ok = true;
      result.method = "api";
      return result;
    }
    const gorgiasEl = document.querySelector("[id*='gorgias' i], [class*='gorgias' i]");
    if (gorgiasEl) {
      const input =
        findInputInShadowTree(gorgiasEl) ||
        gorgiasEl.querySelector?.("textarea, input[type='text'], [contenteditable='true']");
      if (input) {
        result.vendor = "gorgias";
        result.inputFound = true;
        result.inputTag = input.tagName?.toLowerCase();
        globalThis.__opforVendorInput = input;
        result.method = "dom_query";
        result.ok = true;
        return result;
      }
    }
  } catch {
    /* swallowed */
  }

  // ── Generic: find any input inside any custom element with shadow root ──
  try {
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      const shadow = el.shadowRoot || el.__closedShadowRoot;
      if (!shadow) continue;
      const tag = el.tagName?.toLowerCase() || "";
      // Skip known non-chat custom elements
      if (tag.startsWith("iron-") || tag.startsWith("paper-") || tag.startsWith("vaadin-"))
        continue;
      const input = findInputInShadowTree(el);
      if (input) {
        const rect = input.getBoundingClientRect?.();
        if (rect && rect.width > 50 && rect.height > 20) {
          result.vendor = "custom_element";
          result.inputFound = true;
          result.inputTag = input.tagName?.toLowerCase();
          result.hostTag = tag;
          globalThis.__opforVendorInput = input;
          result.method = "generic_shadow_scan";
          result.ok = true;
          return result;
        }
      }
    }
  } catch {
    /* swallowed */
  }

  return result;
})();
