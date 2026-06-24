import { sleep } from "./utils.js";
import { state } from "./state.js";
import { actClickSelector, actVerifyInputVisible, preparePageForChat } from "./domActions.js";
import { collectFrames } from "./frameDiscovery.js";
import { aiUiNextAction } from "./llmUiActions.js";

/**
 * Locate an open chat widget input using accessibility-tree-first LLM actions.
 *
 * @param {number} tabId
 * @param {import("./config.js").LlmProfile} readerCfg
 * @param {{ openWidget?: boolean, maxAiAttempts?: number }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   plan?: { inputSelector: string, submit?: object, confidence?: number },
 *   best?: { frameId: number, frameUrl?: string, snapshot?: string },
 *   siteSnapshot?: string,
 * }>}
 */
export async function locateChatWidget(tabId, readerCfg, options = {}) {
  const openWidget = options.openWidget !== false;
  const maxAiAttempts = Math.max(2, Math.min(12, Number(options.maxAiAttempts ?? 8)));
  if (state.OPFOR_STOP) return { ok: false, error: "Run stopped." };

  if (openWidget) {
    await preparePageForChat(tabId);
  }

  const clickedLaunchers = [];
  let lastErr = "";

  const collectAxSnapshots = async () => {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const MAX_NODES = 1400;
          const MAX_LINES = 700;
          const MAX_NAME = 140;

          const escapeCss = (v) => {
            if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(v));
            return String(v).replace(/["\\]/g, "\\$&");
          };

          const short = (s, n) => {
            const str = String(s || "");
            return str.length > n ? str.slice(0, n) : str;
          };

          const isVisible = (el) => {
            if (!(el instanceof Element)) return false;
            if (!el.isConnected) return false;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none") return false;
            if (style.visibility === "hidden") return false;
            if (style.opacity === "0") return false;
            return true;
          };

          const selectorFromEl = (el) => {
            if (!(el instanceof Element)) return null;
            const testid = el.getAttribute("data-testid");
            if (testid) return `[data-testid="${escapeCss(testid)}"]`;
            const aria = el.getAttribute("aria-label");
            if (aria) return `${el.tagName.toLowerCase()}[aria-label="${escapeCss(aria)}"]`;
            const id = el.getAttribute("id");
            if (id) return `#${escapeCss(id)}`;
            const name = el.getAttribute("name");
            if (name) return `${el.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
            const ph = el.getAttribute("placeholder");
            if (ph) return `${el.tagName.toLowerCase()}[placeholder="${escapeCss(ph)}"]`;

            try {
              const parts = [];
              let cur = el;
              for (let i = 0; i < 4 && cur && cur instanceof Element && cur.tagName; i++) {
                const tag = cur.tagName.toLowerCase();
                const parent = cur.parentElement;
                if (!parent) {
                  parts.unshift(tag);
                  break;
                }
                const sibs = Array.from(parent.children).filter(
                  (c) => c instanceof Element && c.tagName.toLowerCase() === tag
                );
                const idx = Math.max(1, sibs.indexOf(cur) + 1);
                parts.unshift(`${tag}:nth-of-type(${idx})`);
                if (cur.id) break;
                cur = parent;
              }
              const sel = parts.join(" > ");
              if (sel && document.querySelector(sel)) return sel;
            } catch {
              /* swallowed */
            }

            return el.tagName.toLowerCase();
          };

          const roleForEl = (el) => {
            if (!(el instanceof Element)) return "";
            const ariaRole = (el.getAttribute("role") || "").trim().toLowerCase();
            if (ariaRole) return ariaRole;
            const tag = el.tagName.toLowerCase();
            if (tag === "textarea") return "textbox";
            if (tag === "input") {
              const t = (el.getAttribute("type") || "text").toLowerCase();
              if (t === "search") return "searchbox";
              if (t === "button" || t === "submit") return "button";
              return "textbox";
            }
            if (tag === "button") return "button";
            if (tag === "a") return "link";
            if (tag === "select") return "combobox";
            if (tag === "summary") return "button";
            if (el.isContentEditable) return "textbox";
            return tag;
          };

          const nameForEl = (el) => {
            if (!(el instanceof Element)) return "";
            const aria = el.getAttribute("aria-label");
            if (aria) return aria;
            const title = el.getAttribute("title");
            if (title) return title;
            const alt = el.getAttribute("alt");
            if (alt) return alt;
            const ph = el.getAttribute("placeholder");
            if (ph) return ph;
            const tc = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (tc) return tc;
            return "";
          };

          const isNavigatingLink = (el) => {
            if (!(el instanceof HTMLAnchorElement)) return false;
            const raw = (el.getAttribute("href") || "").trim();
            if (!raw) return false;
            if (raw.startsWith("#")) return false;
            if (/^javascript:/i.test(raw)) return false;
            if (/^(https?:|\/)/i.test(raw)) return true;
            return false;
          };

          const isInteractive = (el, role) => {
            if (!(el instanceof Element)) return false;
            const tag = el.tagName.toLowerCase();
            if (tag === "button" || tag === "textarea" || tag === "select") return true;
            if (tag === "input") return true;
            if (tag === "a") return true;
            if (role === "button" || role === "link" || role === "textbox" || role === "combobox")
              return true;
            if (el.isContentEditable) return true;
            if (typeof el.onclick === "function") return true;
            if (el.hasAttribute("tabindex")) return true;
            return false;
          };

          const getShadowRoot = (el) => {
            if (el?.shadowRoot) return el.shadowRoot;
            if (el?.__closedShadowRoot) return el.__closedShadowRoot;
            return null;
          };

          function* walkNodes(root) {
            const stack = [root];
            while (stack.length) {
              const node = stack.pop();
              if (!node) continue;
              yield node;

              if (node instanceof Element) {
                const shadow = getShadowRoot(node);
                if (shadow) stack.push(shadow);
                const children = node.children;
                for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
                continue;
              }

              if (
                node instanceof ShadowRoot ||
                node instanceof Document ||
                node instanceof DocumentFragment
              ) {
                const children = node.children || node.childNodes;
                if (!children) continue;
                for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
              }
            }
          }

          const deepPathSelector = (el) => {
            if (!(el instanceof Element)) return null;
            const parts = [selectorFromEl(el)];
            let cur = el;
            while (cur) {
              const root = cur.getRootNode?.();
              if (root instanceof ShadowRoot) {
                const hostSel = selectorFromEl(root.host);
                parts.unshift(`shadow(${hostSel})`);
                cur = root.host;
                continue;
              }
              break;
            }
            return parts.join(" >> ");
          };

          const lines = [];
          const push = (line) => {
            if (lines.length >= MAX_LINES) return;
            lines.push(line);
          };

          push(`frame_url="${location.href}"`);
          const title = document.title || "";
          if (title) push(`title="${short(title, 140)}"`);

          // Prioritize inputs first so we don't truncate them away.
          const inputs = [];
          const others = [];
          let seen = 0;

          for (const node of walkNodes(document)) {
            if (!(node instanceof Element)) continue;
            if (!isVisible(node)) continue;
            const role = roleForEl(node);
            if (!isInteractive(node, role)) continue;

            const entry = {
              el: node,
              role,
            };
            const roleKey = String(role || "").toLowerCase();
            const tag = node.tagName.toLowerCase();
            const isInput =
              roleKey === "textbox" ||
              roleKey === "combobox" ||
              roleKey === "searchbox" ||
              tag === "textarea" ||
              tag === "input" ||
              node.isContentEditable;
            (isInput ? inputs : others).push(entry);
            seen++;
            if (seen >= MAX_NODES * 2) break;
          }

          const emit = (entry) => {
            const el = entry.el;
            const role = entry.role;
            const name = short(nameForEl(el), MAX_NAME).replace(/\n/g, " ");
            const sel = deepPathSelector(el) || selectorFromEl(el);
            const href =
              el instanceof HTMLAnchorElement ? short(el.getAttribute("href") || "", 160) : "";
            const nav = el instanceof HTMLAnchorElement && isNavigatingLink(el) ? " nav=true" : "";
            const disabled = el instanceof HTMLButtonElement && el.disabled ? " disabled=true" : "";
            push(
              `- role=${role || "unknown"} name="${name}" selector="${sel}"${
                href ? ` href="${href}"` : ""
              }${nav}${disabled}`
            );
          };

          let emitted = 0;
          for (const e of inputs) {
            if (lines.length >= MAX_LINES) break;
            emit(e);
            emitted++;
            if (emitted >= MAX_NODES) break;
          }
          for (const e of others) {
            if (lines.length >= MAX_LINES) break;
            emit(e);
            emitted++;
            if (emitted >= MAX_NODES) break;
          }

          return {
            frameUrl: location.href,
            axSnapshot: lines.join("\n").slice(0, 60_000),
          };
        },
      });
    } catch (err) {
      console.error("[chatLocator] executeScript failed:", err);
      return [];
    }

    const mapped = (results || []).map((r) => ({
      frameId: r.frameId,
      frameUrl: r.result?.frameUrl || "",
      axSnapshot: r.result?.axSnapshot || "",
      error: r.error || null,
    }));

    return mapped.filter((x) => typeof x.axSnapshot === "string" && x.axSnapshot.length > 0);
  };

  let chosen = null;
  for (let attempt = 0; attempt < maxAiAttempts; attempt++) {
    if (state.OPFOR_STOP) return { ok: false, error: "Run stopped." };

    // eslint-disable-next-line no-useless-assignment
    let frames = [];
    try {
      frames = await collectAxSnapshots();
    } catch (err) {
      console.error("[chatLocator] collectAxSnapshots threw:", err);
      frames = [];
    }

    // Vendor fast-path: Ada chat uses a postMessage command rather than responding to synthetic clicks.
    // If we can see the Ada "button" iframe, send the same command manual clicks send.
    if (openWidget) {
      try {
        const adaButton = frames.find((f) =>
          String(f.frameUrl || "").includes("ada.support/embed/button/")
        );
        if (adaButton) {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [adaButton.frameId] },
            func: () => {
              try {
                window.parent.postMessage(
                  JSON.stringify({
                    name: "button",
                    type: "DISPATCH",
                    payload: { actionKey: "toggleChat", payload: { isTrusted: true } },
                    id: String(Date.now()),
                  }),
                  "*"
                );
                return { ok: true };
              } catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
              }
            },
          });
          // Give the chat iframe time to mount / update state.
          await sleep(900);
        }
      } catch {
        /* swallowed */
      }
    }

    const combinedSnapshot = [
      "### ACCESSIBILITY_TREE_SNAPSHOT",
      "Each FRAME lists visible interactive nodes as: role/name/selector. Avoid clicking nodes with nav=true unless absolutely necessary.",
      "",
      ...frames
        .slice(0, 12)
        .map(
          (f) =>
            `## FRAME frameId=${f.frameId} url=${String(f.frameUrl || "").slice(0, 200)}\n${String(
              f.axSnapshot || ""
            ).slice(0, 55_000)}`
        ),
    ].join("\n\n");

    const decision = await aiUiNextAction(readerCfg, {
      frameUrl: frames.find((f) => f.frameId === 0)?.frameUrl || "",
      snapshot: combinedSnapshot,
      lastError: lastErr,
      attempts: attempt,
      clickedLaunchers,
    });

    if (decision?.action === "set_input" && typeof decision.inputSelector === "string") {
      // We don't know which frame the selector belongs to; verify across frames.
      for (const f of frames) {
        const visible = await actVerifyInputVisible(tabId, f.frameId, decision.inputSelector);
        if (visible) {
          chosen = {
            frameId: f.frameId,
            frameUrl: f.frameUrl,
            inputSelector: decision.inputSelector,
            submit: decision.submit,
            confidence: Number(decision.confidence ?? 0.7),
          };
          break;
        }
      }
      if (chosen) break;
      lastErr = "LLM picked input but it was not visible in any frame.";
      continue;
    }

    if (decision?.action === "click_launcher" && typeof decision.launcherSelector === "string") {
      if (!openWidget) {
        lastErr = "openWidget=false; refusing to click launcher.";
        continue;
      }

      // If the LLM picked the Ada launcher, use vendor postMessage open (synthetic clicks are ignored).
      try {
        const adaButton = frames.find((f) =>
          String(f.frameUrl || "").includes("ada.support/embed/button/")
        );
        const sel = String(decision.launcherSelector || "");
        const looksLikeAda =
          sel.includes("ada-chat-button") ||
          sel.includes('aria-label="Chat with us"') ||
          sel.includes("Chat with us");
        if (adaButton && looksLikeAda) {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [adaButton.frameId] },
            func: () => {
              window.parent.postMessage(
                JSON.stringify({
                  name: "button",
                  type: "DISPATCH",
                  payload: { actionKey: "toggleChat", payload: { isTrusted: true } },
                  id: String(Date.now()),
                }),
                "*"
              );
            },
          });
          clickedLaunchers.push(decision.launcherSelector);
          await sleep(1200);
          continue;
        }
      } catch {
        /* swallowed */
      }

      let clicked = false;
      const ordered = [
        ...frames.filter((f) => f.frameId === 0),
        ...frames.filter((f) => f.frameId !== 0),
      ];
      for (const f of ordered) {
        const res = await actClickSelector(tabId, f.frameId, decision.launcherSelector);
        if (res?.ok) {
          clicked = true;
          clickedLaunchers.push(decision.launcherSelector);
          break;
        }
      }
      if (!clicked) {
        lastErr = "LLM picked launcher but click failed in all frames.";
      }
      await sleep(2200);
      continue;
    }

    if (decision?.action === "wait") {
      await sleep(Math.max(500, Math.min(5000, Number(decision.waitMs || 1500))));
      continue;
    }

    if (decision?.action === "give_up") {
      lastErr = String(decision.notes || "LLM gave up.");
      break;
    }

    lastErr = String(decision?.notes || "Unexpected action.");
  }

  if (!chosen?.inputSelector) {
    return { ok: false, error: lastErr || "Could not find (or open) the chat input." };
  }

  // Collect a normal DOM snapshot for the attacker model.
  let siteSnapshot = "";
  try {
    const collected = await collectFrames(tabId);
    siteSnapshot =
      collected.find((f) => f.frameId === 0)?.snapshot ||
      collected.find((f) => f.frameId === chosen.frameId)?.snapshot ||
      collected[0]?.snapshot ||
      "";
  } catch {
    /* swallowed */
  }

  return {
    ok: true,
    plan: {
      inputSelector: chosen.inputSelector,
      submit: chosen.submit,
      confidence: Math.min(1, Math.max(0, Number(chosen.confidence || 0.7))),
    },
    best: { frameId: chosen.frameId, frameUrl: chosen.frameUrl || "", snapshot: siteSnapshot },
    siteSnapshot,
  };
}
