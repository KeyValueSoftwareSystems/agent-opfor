// Shared mutable run state. Use the object reference so all modules see live values.
export const state = {
  OPFOR_STOP: false,
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
