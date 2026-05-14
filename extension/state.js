// Shared mutable run state. Use the object reference so all modules see live values.
export const state = {
  OPFOR_STOP: false,
  uiRunAbortController: null,
};

export function resetUiRunAbortController() {
  try {
    state.uiRunAbortController?.abort();
  } catch {}
  state.uiRunAbortController = null;
}

export function beginUiRunAbortController() {
  resetUiRunAbortController();
  state.uiRunAbortController = new AbortController();
}

export function endUiRunAbortController() {
  resetUiRunAbortController();
}
