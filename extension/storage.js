export async function persistPausedAdaptiveRun(payload) {
  await chrome.storage.local.set({
    opforPausedRun: { v: 1, savedAt: Date.now(), ...payload },
  });
}

export async function setRunStatus(status) {
  await chrome.storage.local.set({
    opforRunStatus: { v: 1, updatedAt: Date.now(), ...status },
  });
}

export async function clearRunStatus() {
  await chrome.storage.local.set({
    opforRunStatus: { v: 1, running: false, updatedAt: Date.now() },
  });
}

export async function persistPartialResult(payload) {
  await chrome.storage.local.set({
    opforLastResult: { v: 1, savedAt: Date.now(), ...payload },
  });
}

/**
 * Broadcast progress to the popup AND persist it to storage so the popup can
 * recover running state if closed and reopened mid-run.
 */
export function broadcastProgress(payload) {
  try {
    chrome.runtime.sendMessage({ type: "OPFOR_UI_PROGRESS", ...payload }).catch(() => {});
  } catch {}

  try {
    chrome.storage.local.get("opforRunStatus", (data) => {
      const cur = data?.opforRunStatus || {};
      if (!cur.running) return;
      const patch = { updatedAt: Date.now() };
      if (payload.kind === "phase") {
        patch.phase = payload.phase;
      } else if (payload.kind === "turn") {
        patch.phase = "running";
        patch.lastRound = payload.round;
        patch.lastRole = payload.role;
        patch.lastContent = String(payload.content || "").slice(0, 10_000);
        const transcript = Array.isArray(cur.transcript) ? cur.transcript : [];
        transcript.push({
          role: payload.role,
          content: String(payload.content || "").slice(0, 10_000),
        });
        patch.transcript = transcript.slice(-40);
      }
      chrome.storage.local.set({ opforRunStatus: { ...cur, ...patch } });
    });
  } catch {}
}
