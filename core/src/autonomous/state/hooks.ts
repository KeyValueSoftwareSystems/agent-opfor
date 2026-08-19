// Per-step observation → raw audit transcript.
//
// This was a Claude Agent SDK PostToolUse hook; it is now driven by the AI SDK's
// `onStepFinish`, which reports the tool calls and results of each completed step. The
// captured shape (`TranscriptEntry`) is unchanged, so the report pipeline is unaffected.
//
// Live progress lines are emitted by the tool handlers themselves (where the structured data
// is exact) and by tools/dispatch.ts for subagent fan-out — not from here, to avoid double
// lines and fragile output parsing.

import type { StepResult, ToolSet } from "ai";
import type { RunLog, TranscriptEntry } from "./runLog.js";
import type { RunEvent } from "./observe.js";

export interface ProgressReporter {
  /** A single formatted, human-readable progress line. */
  onLine(line: string): void;
  /** Optional structured event sink (e.g. a .jsonl trail a web view can consume). */
  onEvent?(event: RunEvent): void;
}

/** Emit a structured run event to the reporter's event sink, if any. */
export function noteEvent(progress: ProgressReporter | undefined, event: RunEvent): void {
  progress?.onEvent?.(event);
}

/**
 * Record every tool call in a completed step to the run's audit transcript.
 *
 * `agentType` is supplied by the caller rather than read off the step: we own dispatch now, so
 * the running role is known statically instead of being inferred from a runtime marker.
 */
export function recordStep(runLog: RunLog, step: StepResult<ToolSet>, agentType: string): void {
  for (const call of step.toolCalls ?? []) {
    const result = (step.toolResults ?? []).find((r) => r.toolCallId === call.toolCallId);
    const entry: TranscriptEntry = {
      at: new Date().toISOString(),
      agentType,
      tool: call.toolName,
      input: call.input,
      output: result?.output,
    };
    runLog.transcript.push(entry);
  }
}
