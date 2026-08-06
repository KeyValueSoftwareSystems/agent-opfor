import { sleep } from "./utils.js";
import { dbg } from "./debugLog.js";

/** Inject shadow DOM patch in MAIN world so closed shadow roots become accessible. */
export async function injectShadowPatch(tabId) {
  try {
    await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["frame_shadow_patch.js"],
        world: "MAIN",
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("shadow patch timed out")), 10_000)
      ),
    ]);
  } catch {
    dbg("dom", "injectShadowPatch allFrames failed/timed out, trying main frame only");
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["frame_shadow_patch.js"],
        world: "MAIN",
      });
    } catch {
      /* swallowed */
    }
  }
}

/** Scroll main document so lazy-loaded chat widgets appear before scanning for launchers. */
export async function preparePageForChat(tabId) {
  await injectShadowPatch(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["frame_prepare_page.js"],
    });
  } catch {
    /* swallowed */
  }
  await sleep(800);
}

export async function actSendText(tabId, frameId, plan) {
  dbg("dom", "actSendText", {
    frameId,
    inputSelector: plan?.inputSelector,
    submitMethod: plan?.submit?.method,
    buttonSelector: plan?.submit?.buttonSelector,
    textLen: plan?.text?.length,
  });
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (p) => {
        globalThis.__OPFOR_PLAN__ = p;
      },
      args: [plan],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dbg("dom", "actSendText plan inject FAILED", { frameId, error: msg });
    return {
      ok: false,
      error: `script_inject_failed`,
      detail: `Could not inject plan into frame ${frameId}: ${msg}`,
    };
  }
  try {
    const act2 = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["frame_actuate.js"],
    });
    const result = act2?.[0]?.result;
    if (result === undefined || result === null) {
      dbg("dom", "actSendText frame_actuate returned null", { frameId, result });
      return {
        ok: false,
        error: "script_no_result",
        detail: `frame_actuate.js returned ${result} in frame ${frameId} — the frame may have been removed or navigated`,
      };
    }
    dbg("dom", `actSendText result: ${result.ok ? "OK" : "FAIL"}`, {
      frameId,
      ok: result.ok,
      error: result.error,
      detail: result.detail,
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dbg("dom", "actSendText frame_actuate threw", { frameId, error: msg });
    return {
      ok: false,
      error: "script_exec_failed",
      detail: `frame_actuate.js threw in frame ${frameId}: ${msg}`,
    };
  }
}

export async function actVendorSendText(tabId, text) {
  dbg("dom", "actVendorSendText", { textLen: text?.length });
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (t) => {
        globalThis.__opforVendorText = t;
      },
      args: [text],
      world: "MAIN",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: "vendor_inject_failed",
      detail: `Could not inject text into main frame: ${msg}`,
    };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["frame_vendor_api.js"],
      world: "MAIN",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "vendor_api_failed", detail: `frame_vendor_api.js failed: ${msg}` };
  }
  await sleep(200);
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["frame_vendor_send.js"],
      world: "MAIN",
    });
    const result = res?.[0]?.result;
    if (result === undefined || result === null) {
      return {
        ok: false,
        error: "vendor_no_result",
        detail: "frame_vendor_send.js returned no result — vendor API may have changed",
      };
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "vendor_send_failed", detail: `frame_vendor_send.js threw: ${msg}` };
  }
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
