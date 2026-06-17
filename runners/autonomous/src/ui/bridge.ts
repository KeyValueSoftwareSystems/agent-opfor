// Bridges ProgressReporter callbacks to SSE clients and maintains run state for REST snapshots.

import type { ProgressReporter } from "@opfor/core/autonomous/state/hooks.js";
import type { RunEvent } from "@opfor/core/autonomous/state/observe.js";
import type { RunLog } from "@opfor/core/autonomous/state/runLog.js";
import { serializeRunLog, type SnapshotMeta, type UiRunState } from "./snapshot.js";

export type SsePayload =
  | { kind: "line"; line: string; wall: string }
  | { kind: "event"; event: RunEvent; wall: string }
  | { kind: "state"; state: UiRunState }
  | { kind: "complete"; reportDir?: string; outcome?: string };

export type SseClient = {
  send: (payload: SsePayload) => void;
  close: () => void;
};

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

export class UiBridge implements ProgressReporter {
  private runLog: RunLog | null = null;
  private meta: SnapshotMeta = {};
  private phase: "boot" | "running" | "complete" = "boot";
  private clients = new Set<SseClient>();
  private lines: string[] = [];
  private readonly maxLines = 500;
  private overrideState: UiRunState | null = null;
  private completePayload: Extract<SsePayload, { kind: "complete" }> | null = null;

  setMeta(meta: SnapshotMeta): void {
    this.meta = { ...this.meta, ...meta };
    this.broadcastState();
  }

  attachRunLog(runLog: RunLog, meta: SnapshotMeta = {}): void {
    this.runLog = runLog;
    this.meta = { ...this.meta, ...meta };
    this.phase = "running";
    this.broadcastState();
  }

  setOverrideState(state: UiRunState | null): void {
    this.overrideState = state;
    if (!state) return;
    if (state.phase === "complete") this.phase = "complete";
    else if (state.phase === "running") this.phase = "running";
    this.broadcastState();
  }

  registerClient(client: SseClient): void {
    this.clients.add(client);
    for (const line of this.lines) {
      client.send({ kind: "line", line, wall: "" });
    }
    const snap = this.snapshot();
    client.send({ kind: "state", state: snap });
    if (this.completePayload) client.send(this.completePayload);
  }

  unregisterClient(client: SseClient): void {
    this.clients.delete(client);
  }

  snapshot(): UiRunState {
    if (this.overrideState) return this.overrideState;
    if (!this.runLog) {
      return {
        runId: "pending",
        phase: this.phase,
        startedAt: new Date().toISOString(),
        objective: this.meta.objective ?? "",
        targetName: this.meta.targetName ?? "Starting…",
        targetEndpoint: this.meta.targetEndpoint ?? "",
        completed: false,
        truncated: false,
        budgetUsd: this.meta.budgetUsd,
        commanderModel: this.meta.commanderModel,
        operatorModel: this.meta.operatorModel,
        scoutModel: this.meta.scoutModel,
        summary: { threads: 0, findings: 0, leads: 0, turns: 0 },
        threads: [],
        findings: [],
        leads: [],
      };
    }
    return serializeRunLog(this.runLog, this.meta);
  }

  markComplete(payload: { reportDir?: string; outcome?: string }): void {
    if (this.runLog) {
      this.runLog.completed = true;
    }
    this.phase = "complete";
    this.completePayload = { kind: "complete", ...payload };
    if (this.overrideState) {
      this.overrideState = { ...this.overrideState, phase: "complete", completed: true };
    }
    this.broadcast(this.completePayload);
    this.broadcastState();
  }

  getRecentLines(): string[] {
    return [...this.lines];
  }

  onLine(line: string): void {
    const stamped = `[${clock()}] ${line}`;
    this.lines.push(stamped);
    if (this.lines.length > this.maxLines) this.lines.shift();
    this.broadcast({ kind: "line", line: stamped, wall: clock() });
    // Refresh cost/thread counts when log lines arrive (covers early commander output).
    if (this.runLog) this.broadcastState();
  }

  onEvent(event: RunEvent): void {
    this.broadcast({ kind: "event", event, wall: clock() });
    if (
      event.type === "turn" ||
      event.type === "thread_created" ||
      event.type === "fork" ||
      event.type === "finding" ||
      event.type === "lead_flagged" ||
      event.type === "lead_spawned" ||
      event.type === "lead_dismissed"
    ) {
      this.broadcastState();
    }
  }

  private broadcastState(): void {
    this.broadcast({ kind: "state", state: this.snapshot() });
  }

  private broadcast(payload: SsePayload): void {
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}

/** Merge multiple ProgressReporter sinks into one. */
export function mergeReporters(...reporters: (ProgressReporter | undefined)[]): ProgressReporter {
  const active = reporters.filter(Boolean) as ProgressReporter[];
  return {
    onLine(line: string) {
      for (const r of active) r.onLine(line);
    },
    onEvent(event: RunEvent) {
      for (const r of active) {
        r.onEvent?.(event);
      }
    },
  };
}
