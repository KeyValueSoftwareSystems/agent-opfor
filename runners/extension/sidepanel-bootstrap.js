/**
 * Mount popup.html UI inside the Chrome side panel (same logic as the old popup,
 * but the panel stays open while browsing — like MetaMask).
 */
import { preferRightSidePanel } from "./sidepanel-layout.js";

async function mountSidePanel() {
  const res = await fetch(chrome.runtime.getURL("popup.html"));
  if (!res.ok) throw new Error(`popup.html fetch failed (${res.status})`);

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const node of doc.head.querySelectorAll("style, link[rel='stylesheet']")) {
    document.head.appendChild(document.importNode(node, true));
  }

  const moduleScripts = [];
  for (const node of doc.body.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node;
    if (el.tagName === "SCRIPT") {
      const src = el.getAttribute("src");
      if (src) moduleScripts.push(src);
      continue;
    }
    document.body.appendChild(document.importNode(el, true));
  }

  for (const src of moduleScripts) {
    const url = new URL(src, chrome.runtime.getURL("popup.html")).href;
    await import(url);
  }

  await preferRightSidePanel();
}

mountSidePanel().catch((err) => {
  document.body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.style.cssText =
    "padding:16px;color:#ff8295;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap";
  pre.textContent = `Failed to load Opfor side panel:\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(pre);
});
