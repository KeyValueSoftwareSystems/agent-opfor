/**
 * Debug logging for the OPFOR browser extension.
 *
 * Toggle via chrome.storage.local `opforDebug: true/false` or the sidepanel UI.
 * Logs go to console AND a ring buffer in storage (viewable / exportable from UI).
 *
 * Usage:
 *   import { dbg, isDebugEnabled, setDebugEnabled, getDebugLogs, clearDebugLogs } from "./debugLog.js";
 *   dbg("locate", "Found chat input", { selector, frameId, confidence });
 */

const MAX_LOG_ENTRIES = 500;
const STORAGE_KEY = "opforDebugLogs";
const FLAG_KEY = "opforDebug";

let _enabled = false;
let _buffer = [];
let _flushTimer = null;

// Boot: read the stored flag once so hot-path checks are synchronous.
chrome.storage.local.get([FLAG_KEY], (data) => {
  _enabled = !!data?.[FLAG_KEY];
});

// React to live toggles (from the sidepanel or another context).
chrome.storage.onChanged.addListener((changes) => {
  if (changes[FLAG_KEY]) {
    _enabled = !!changes[FLAG_KEY].newValue;
  }
});

export function isDebugEnabled() {
  return _enabled;
}

export async function setDebugEnabled(on) {
  _enabled = !!on;
  await chrome.storage.local.set({ [FLAG_KEY]: _enabled });
}

/**
 * Log a debug entry.  No-op when debug mode is off.
 *
 * @param {string} category  Short tag — "locate", "send", "extract", "llm", "frame", etc.
 * @param {string} message   Human-readable one-liner.
 * @param {Record<string, unknown>} [data]  Structured payload (selectors, scores, LLM decisions…).
 */
export function dbg(category, message, data) {
  if (!_enabled) return;

  const entry = {
    t: Date.now(),
    cat: category,
    msg: message,
    ...(data !== undefined && { d: sanitize(data) }),
  };

  console.log(`[OPFOR:${category}]`, message, data ?? "");

  _buffer.push(entry);
  scheduleFlush();
}

function sanitize(obj) {
  try {
    const json = JSON.stringify(obj, (_k, v) => {
      if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
      return v;
    });
    return JSON.parse(json);
  } catch {
    return String(obj);
  }
}

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(flush, 300);
}

async function flush() {
  _flushTimer = null;
  if (!_buffer.length) return;

  const batch = _buffer.splice(0);
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const existing = Array.isArray(data?.[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    const merged = [...existing, ...batch].slice(-MAX_LOG_ENTRIES);
    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  } catch {
    // Storage full or unavailable — logs are still in the console.
  }
}

export async function getDebugLogs() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data?.[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

export async function clearDebugLogs() {
  _buffer = [];
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Format stored logs as a downloadable text blob.
 */
export async function exportDebugLogs() {
  const logs = await getDebugLogs();
  return logs
    .map((e) => {
      const ts = new Date(e.t).toISOString();
      const payload = e.d ? ` ${JSON.stringify(e.d)}` : "";
      return `${ts} [${e.cat}] ${e.msg}${payload}`;
    })
    .join("\n");
}
