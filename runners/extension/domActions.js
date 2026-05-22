import { sleep } from "./utils.js";

/** Inject shadow DOM patch in MAIN world so closed shadow roots become accessible. */
export async function injectShadowPatch(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["frame_shadow_patch.js"],
      world: "MAIN",
    });
  } catch {}
}

/** Scroll main document so lazy-loaded chat widgets appear before scanning for launchers. */
export async function preparePageForChat(tabId) {
  await injectShadowPatch(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["frame_prepare_page.js"],
    });
  } catch {}
  await sleep(800);
}

export async function actSendText(tabId, frameId, plan) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: (p) => {
      globalThis.__OPFOR_PLAN__ = p;
    },
    args: [plan],
  });
  const act2 = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ["frame_actuate.js"],
  });
  return act2?.[0]?.result;
}

export async function actVendorSendText(tabId, text) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (t) => {
      globalThis.__opforVendorText = t;
    },
    args: [text],
    world: "MAIN",
  });
  // Re-discover vendor input in case page re-rendered.
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["frame_vendor_api.js"],
    world: "MAIN",
  });
  await sleep(200);
  const res = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["frame_vendor_send.js"],
    world: "MAIN",
  });
  return res?.[0]?.result;
}

export async function actClickSelector(tabId, frameId, selector) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: (s) => {
      globalThis.__OPFOR_CLICK_SELECTOR__ = String(s || "");
    },
    args: [selector],
  });
  const res = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ["frame_click.js"],
  });
  return res?.[0]?.result;
}

/**
 * Check if a selector matches a visible element inside the target frame.
 */
export async function actVerifyInputVisible(tabId, frameId, selector) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (sel) => {
        const getShadowRoot = (el) => {
          if (el?.shadowRoot) return el.shadowRoot;
          // Closed shadow root captured by frame_shadow_patch.js (MAIN world)
          if (el?.__closedShadowRoot) return el.__closedShadowRoot;
          return null;
        };

        const resolveDeepSelector = (s) => {
          if (!s || typeof s !== "string" || !s.trim()) return null;
          const parts = s
            .split(">>")
            .map((p) => p.trim())
            .filter(Boolean);

          const queryOne = (root, selector) => {
            try {
              return root.querySelector(selector);
            } catch {
              return null;
            }
          };

          const queryAll = (root, selector) => {
            try {
              return Array.from(root.querySelectorAll(selector));
            } catch {
              return [];
            }
          };

          const resolveFrom = (root, idx) => {
            if (idx >= parts.length) return root instanceof Element ? root : null;
            const part = parts[idx];
            const shadowMatch = part.match(/^shadow\((.*)\)$/);
            if (shadowMatch) {
              const hostSel = shadowMatch[1]?.trim();
              if (!hostSel) return null;
              const hosts = queryAll(root, hostSel).filter(
                (h) => h instanceof Element && getShadowRoot(h)
              );
              for (const host of hosts) {
                const out = resolveFrom(getShadowRoot(host), idx + 1);
                if (out) return out;
              }
              return null;
            }

            const next = queryOne(root, part);
            if (!(next instanceof Element)) return null;
            return resolveFrom(next, idx + 1);
          };

          return resolveFrom(document, 0);
        };

        const safeQuerySelector = (root, s) => {
          try {
            return root.querySelector(s);
          } catch {
            return null;
          }
        };

        const el = resolveDeepSelector(sel) || safeQuerySelector(document, sel);
        if (!(el instanceof Element)) return { visible: false, reason: "not_found" };
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width < 5 || rect.height < 5)
          return { visible: false, reason: "too_small" };
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
          return { visible: false, reason: "hidden_css" };

        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute("role") || "").toLowerCase();
        const isInput =
          tag === "textarea" ||
          tag === "input" ||
          el.isContentEditable ||
          role === "textbox" ||
          role === "combobox";
        if (!isInput) {
          const id = el.id || "";
          const children = el.children?.length || 0;
          const area = rect.width * rect.height;
          const viewportArea = window.innerWidth * window.innerHeight;
          if (
            id === "root" ||
            id === "app" ||
            id === "__next" ||
            id === "__nuxt" ||
            tag === "body" ||
            tag === "main" ||
            tag === "section" ||
            children > 10 ||
            area > viewportArea * 0.3
          ) {
            return { visible: false, reason: "element_is_container" };
          }
        }

        return { visible: true };
      },
      args: [selector],
    });
    return res?.[0]?.result?.visible === true;
  } catch {
    return false;
  }
}
