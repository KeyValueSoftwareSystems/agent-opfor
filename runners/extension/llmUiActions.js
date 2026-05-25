import { callLlm } from "./llm.js";

export async function aiPickInputInFrame(cfg, frame) {
  const system = [
    "You are helping a browser extension identify a chat input box INSIDE A SINGLE FRAME.",
    "You receive a SANITIZED DOM snapshot for that frame only.",
    "Return ONLY JSON with this exact schema:",
    `{ "inputSelector"?: string, "submit"?: { "method": "enter" | "click", "buttonSelector"?: string }, "launcherSelector"?: string, "confidence": number, "notes"?: string }`,
    "Selectors must be CSS selectors.",
    'IMPORTANT: Prefer selectors that appear verbatim in selector="..." entries in the snapshot (these may include shadow(...) >> ... syntax).',
    "If CHAT_SIGNALS are present, this frame IS the chat UI. Pick the chat composer (textarea / contenteditable / [role=textbox]) closest to the bottom of the transcript — NOT the page header search.",
    "IMPORTANT: Chat UIs can take many forms: floating widget bubbles, sidebar panels, drawer overlays, embedded chat windows, OR full/dedicated chat pages (URL contains /chat/). On dedicated chat pages and sidebar chat panels, the primary text input IS the chat composer — do not confuse it with site search.",
    "If the snapshot mentions 'dedicated_chat_page', the page IS a chat interface — pick the main visible text input as the chat composer with high confidence.",
    "Reject any input marked site_search_hint=1, type=search, role=searchbox, or whose placeholder/aria mentions searching help articles.",
    "Prefer the highest-scoring entry in CANDIDATE_INPUTS that is not a site search.",
    "For submit, prefer method='click' with a visible send/submit button from CANDIDATE_BUTTONS; fall back to 'enter' if no send button is present.",
    "If no usable chat input is visible yet, return launcherSelector from LIKELY_CHAT_LAUNCHERS or FLOATING_WIDGET_CANDIDATES to open the widget first. If those are empty, pick any visible button whose text/aria suggests 'start chat', 'message us', 'chat with us', or 'virtual assistant'.",
    "Do NOT pick links that navigate to product/checkout/pricing pages.",
    "Never pick plus/attach/microphone buttons as the submit action.",
    "Never include markdown. Never include extra keys.",
  ].join("\n");

  const user = [
    "Task: Identify the chat prompt/input element in this frame and how to submit a message.",
    `Frame URL: ${String(frame.frameUrl || "")}`,
    "",
    "Sanitized DOM snapshot:",
    String(frame.snapshot).slice(0, 60_000),
  ].join("\n");

  return await callLlm({
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
}

function isAccessibilitySnapshot(snapshot) {
  return String(snapshot || "").includes("ACCESSIBILITY_TREE_SNAPSHOT");
}

function axTreePlannerSystem() {
  return [
    "You are a UI automation planner for a browser extension that needs to find and interact with a chat/support widget on a webpage.",
    "You receive an ACCESSIBILITY_TREE_SNAPSHOT: multiple FRAME sections listing visible interactive nodes as lines:",
    '- role=<role> name="<label>" selector="<css>" [href="..."] [nav=true] [disabled=true]',
    "Selectors may use shadow(host) >> child syntax for shadow DOM. Use them verbatim.",
    "",
    "Return ONLY valid JSON with this schema (no markdown, no extra keys):",
    `{ "action": "set_input" | "click_launcher" | "wait" | "give_up", "inputSelector"?: string, "submit"?: { "method": "enter" | "click", "buttonSelector"?: string }, "launcherSelector"?: string, "waitMs"?: number, "confidence": number, "notes"?: string }`,
    "",
    "## Decision rules — apply strictly in this order:",
    "",
    "1. LOOK FOR A CHAT INPUT FIRST. Scan all frames for role=textbox or role=combobox (also contenteditable surfaced as textbox).",
    "   - Prefer nodes whose name/placeholder suggests messaging: chat, message, ask, type, send, support, help, assistant.",
    "   - SKIP role=searchbox and names suggesting site search / help-center article search.",
    "   - SKIP huge container nodes (body, main, #root) — pick the actual composer control.",
    "   - If found → action=set_input with its selector. submit.method='enter' unless you see a nearby role=button named Send/Submit.",
    "",
    "2. NO USABLE INPUT? Find a launcher to open the widget: role=button or role=link (NOT nav=true) with chat/support/contact/message/virtual assistant semantics.",
    "   - Bottom-corner floating bubbles are often launchers — prefer buttons over generic nav links.",
    "   - NEVER click nodes with nav=true (they leave the page).",
    "   - NEVER re-click launchers listed under 'Launchers already clicked'.",
    "   - NEVER click disabled=true nodes.",
    "   → action=click_launcher with launcherSelector from the snapshot line.",
    "",
    "3. IF nothing to click AND attempts > 0 → action=wait with waitMs=1500–2500 (widget may still be loading).",
    "",
    "4. ONLY action=give_up if attempts >= 6 AND nothing resembles a chat widget or launcher.",
    "",
    "## Hard rules:",
    "- NEVER use action=reload.",
    "- NEVER pick attach/plus/microphone/paperclip as submit.",
    '- Copy selector="..." values exactly from the snapshot.',
  ].join("\n");
}

function domSnapshotPlannerSystem() {
  return [
    "You are a UI automation planner for a browser extension that needs to find and interact with a chat/support widget on a webpage.",
    "You receive a SANITIZED DOM snapshot containing: CANDIDATE_INPUTS, CANDIDATE_BUTTONS, LIKELY_CHAT_LAUNCHERS, FLOATING_WIDGET_CANDIDATES, and optional CHAT_SIGNALS.",
    "",
    "Return ONLY valid JSON with this schema (no markdown, no extra keys):",
    `{ "action": "set_input" | "click_launcher" | "wait" | "give_up", "inputSelector"?: string, "submit"?: { "method": "enter" | "click", "buttonSelector"?: string }, "launcherSelector"?: string, "waitMs"?: number, "confidence": number, "notes"?: string }`,
    "",
    "## Decision rules — apply strictly in this order:",
    "",
    "1. LOOK FOR A CHAT INPUT FIRST. Scan CANDIDATE_INPUTS for any entry that is NOT marked site_search_hint=1 and has score > 0. If found → action=set_input with its selector.",
    "   - Even if score is low, if there are CHAT_SIGNALS present AND a non-search textarea/input exists, pick it.",
    "   - Chat inputs can appear inside overlay windows, modals, dialogs, sidebars, or floating panels — not just the main page. If CHAT_SIGNALS mentions 'chat_overlay_modal' or 'vendor_chat_widget', look for the input INSIDE that overlay.",
    "   - For submit: look in CANDIDATE_BUTTONS for one marked sendish=1. If found → submit.method='click' + its selector. Otherwise → submit.method='enter'.",
    "",
    "2. NO USABLE INPUT? Look for something to click open. Check FLOATING_WIDGET_CANDIDATES first (these are positioned bottom-right and are almost always chat launchers), then LIKELY_CHAT_LAUNCHERS. Pick the highest-scored one → action=click_launcher.",
    "   - 'Contact Us' or 'Contact' buttons/links that DON'T navigate away (no href, or href='#') often open chat overlays — these ARE valid launchers.",
    "   - NEVER re-click a launcher that was already clicked (see 'Launchers already clicked' list below).",
    "   - NEVER click anchors whose href contains /products/, /pricing/, /checkout/, /shop/, /subscribe/, /order/.",
    "",
    "3. IF you have nothing to click AND attempts > 0 → action=wait with waitMs=2500 (the widget may still be loading).",
    "",
    "4. ONLY use action=give_up if attempts >= 6 AND there is truly nothing in the snapshot that looks like a chat widget or launcher.",
    "",
    "## Hard rules:",
    "- NEVER use action=reload. Page reloads destroy widget state and accomplish nothing.",
    "- NEVER choose an input marked site_search_hint=1, type=search, role=searchbox, or in a header/nav.",
    "- NEVER pick plus/attach/microphone/paperclip buttons as submit.",
    '- Prefer selectors verbatim from selector="..." in the snapshot.',
  ].join("\n");
}

export async function aiUiNextAction(
  readerCfg,
  { frameUrl, snapshot, lastError, attempts, clickedLaunchers }
) {
  const clickedNote = clickedLaunchers?.length
    ? `\nLaunchers already clicked (DO NOT click these again): ${clickedLaunchers.join(", ")}`
    : "";

  const axMode = isAccessibilitySnapshot(snapshot);
  const system = axMode ? axTreePlannerSystem() : domSnapshotPlannerSystem();

  const user = [
    `Frame URL: ${String(frameUrl || "")}`,
    `Attempts so far: ${attempts}`,
    lastError ? `Last error: ${lastError}` : "",
    clickedNote,
    "",
    axMode ? "Accessibility tree snapshot:" : "Sanitized DOM snapshot:",
    String(snapshot || "").slice(0, 60_000),
  ]
    .filter(Boolean)
    .join("\n");

  return await callLlm({
    provider: readerCfg.provider,
    baseUrl: readerCfg.baseUrl,
    apiKey: readerCfg.apiKey,
    model: readerCfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
}

export async function llmShortenMessage(cfg, originalMessage, maxLength) {
  const targetLen = maxLength ? Math.floor(maxLength * 0.85) : 200;
  const out = await callLlm({
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages: [
      {
        role: "system",
        content: [
          "You are helping shorten a chat message to fit within a character limit.",
          `The message MUST be at most ${targetLen} characters.`,
          "Preserve the core meaning and intent. Keep it natural and conversational.",
          'Return ONLY JSON: { "message": string }',
        ].join("\n"),
      },
      {
        role: "user",
        content: `Shorten this message to fit within ${targetLen} characters:\n\n${originalMessage}`,
      },
    ],
  });
  const msg = typeof out?.message === "string" ? out.message.trim() : "";
  if (!msg) return originalMessage.slice(0, targetLen);
  return msg.length > (maxLength || 300) ? msg.slice(0, targetLen) : msg;
}
