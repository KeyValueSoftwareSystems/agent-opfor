/** Best-effort: ask Chrome to dock the side panel on the right (when supported). */
export async function preferRightSidePanel() {
  if (!chrome.sidePanel?.setOptions) return;
  const base = { path: "sidepanel.html", enabled: true };
  try {
    await chrome.sidePanel.setOptions({ ...base, side: "right" });
    return;
  } catch {
    // `side` may be unsupported — fall back to path-only options.
  }
  try {
    await chrome.sidePanel.setOptions(base);
  } catch {
    // Non-Chromium or older Chrome.
  }
}
