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

export async function actReloadTopFrame(tabId) {
  const res = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["frame_reload.js"],
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
        const resolve = (s) => {
          if (!s || typeof s !== "string") return null;
          try {
            return document.querySelector(s);
          } catch {
            return null;
          }
        };
        const el = resolve(sel);
        if (!(el instanceof Element)) return { visible: false, reason: "not_found" };
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width < 5 || rect.height < 5)
          return { visible: false, reason: "too_small" };
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
          return { visible: false, reason: "hidden_css" };
        return { visible: true };
      },
      args: [selector],
    });
    return res?.[0]?.result?.visible === true;
  } catch {
    return false;
  }
}
