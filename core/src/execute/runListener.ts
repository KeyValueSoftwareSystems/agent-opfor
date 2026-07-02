// RunListener — an observer over a run's lifecycle (Observer / SPI).
//
// The engine emits lifecycle events; reporters, progress UIs, and telemetry
// adapters consume them by implementing this interface, so a new output format
// becomes a new listener with no engine edits. Every hook is optional — a
// listener implements only what it needs.

import type { UnifiedRunReport, ProgressEvent } from "./types.js";
import { log } from "../lib/logger.js";

/** The payload of a ProgressEvent variant, minus its `type` discriminant. */
type Payload<T extends ProgressEvent["type"]> = Omit<Extract<ProgressEvent, { type: T }>, "type">;

export interface RunListener {
  /** Fired once before the first evaluator runs. */
  onRunStart?(info: { evaluatorCount: number }): void;
  onEvaluatorStart?(info: Payload<"evaluator_start">): void;
  onAttackStart?(info: Payload<"attack_start">): void;
  onAttackDone?(info: Payload<"attack_done">): void;
  onEvaluatorDone?(info: Payload<"evaluator_done">): void;
  /** Fired when a non-retryable error halts the run gracefully (partial report). */
  onRunStopped?(info: Payload<"run_stopped">): void;
  /** Fired if the run throws an unexpected error (terminal; pairs with onRunStart). */
  onRunError?(info: { error: unknown }): void;
  /** Fired once after the report is assembled (terminal; pairs with onRunStart). */
  onRunFinish?(report: UnifiedRunReport): void;
}

/**
 * Invoke a hook on every listener with error isolation: a listener that throws is
 * logged and skipped so a buggy reporter/telemetry adapter can never abort the
 * run itself. Centralizes the fan-out so every notification site is uniform.
 */
export function notifyListeners(
  listeners: readonly RunListener[],
  invoke: (listener: RunListener) => void
): void {
  for (const listener of listeners) {
    try {
      invoke(listener);
    } catch (err) {
      log.warn(`RunListener threw and was skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Route one ProgressEvent to the matching RunListener hook. The engine keeps a
 * single ProgressEvent stream as the source of per-attack events; this adapts it
 * to the typed listener interface so callers don't switch on `event.type`.
 */
export function dispatchProgress(listener: RunListener, event: ProgressEvent): void {
  switch (event.type) {
    case "evaluator_start":
      listener.onEvaluatorStart?.(event);
      break;
    case "attack_start":
      listener.onAttackStart?.(event);
      break;
    case "attack_done":
      listener.onAttackDone?.(event);
      break;
    case "evaluator_done":
      listener.onEvaluatorDone?.(event);
      break;
    case "run_stopped":
      listener.onRunStopped?.(event);
      break;
    default: {
      // Compile-time exhaustiveness: a new ProgressEvent variant forces a case.
      const _exhaustive: never = event;
      void _exhaustive;
    }
  }
}
