// Shared mutable run state. Use the object reference so all modules see live values.
export const state = {
  OPFOR_STOP: false,
  // "pause" (resumable) or "cancel" (discard) — set from the OPFOR_UI_STOP
  // message so orchestrator.js knows whether to persist a resumable
  // snapshot. Defaults to "cancel" so an unspecified/legacy stop never
  // leaves behind a resumable run the user never asked to keep.
  OPFOR_STOP_INTENT: "cancel",
  uiRunAbortController: null,
  retryLocateResolver: null,
};

export function resetUiRunAbortController() {
  try {
    state.uiRunAbortController?.abort();
  } catch {
    /* swallowed */
  }
  state.uiRunAbortController = null;
}

export function beginUiRunAbortController() {
  resetUiRunAbortController();
  state.uiRunAbortController = new AbortController();
}

export function endUiRunAbortController() {
  resetUiRunAbortController();
}

export function waitForRetryLocate() {
  return new Promise((resolve) => {
    state.retryLocateResolver = resolve;
  });
}

export function triggerRetryLocate(data) {
  if (state.retryLocateResolver) {
    state.retryLocateResolver(data);
    state.retryLocateResolver = null;
  }
}

export function clearRetryLocate() {
  state.retryLocateResolver = null;
}
