// Serialize RunLog into a JSON-safe shape for the live UI REST API.

import type { RunLog, ThreadState } from "@agent-opfor/core/autonomous/state/runLog.js";

export interface UiThreadTurn {
  turnIndex: number;
  prompt: string;
  response: string;
  persona?: string;
  strategy?: string;
  isError: boolean;
  rateLimited: boolean;
  score?: number;
}

export interface UiThread {
  threadId: string;
  vulnClassId?: string;
  parentThreadId?: string;
  forkedFromTurn?: number;
  gen?: number;
  turns: UiThreadTurn[];
  turnCount: number;
}

export type UiRunPhase = "boot" | "running" | "complete";

export interface UiRunState {
  runId: string;
  phase: UiRunPhase;
  demo?: boolean;
  startedAt: string;
  objective: string;
  targetName: string;
  targetEndpoint: string;
  completed: boolean;
  truncated: boolean;
  truncationReason?: string;
  totalCostUsd?: number;
  budgetUsd?: number;
  commanderModel?: string;
  operatorModel?: string;
  scoutModel?: string;
  summary: {
    threads: number;
    findings: number;
    leads: number;
    turns: number;
  };
  threads: UiThread[];
  findings: RunLog["findings"];
  leads: RunLog["leads"];
  fingerprint?: RunLog["fingerprint"];
}

function serializeThread(thread: ThreadState): UiThread {
  return {
    threadId: thread.threadId,
    vulnClassId: thread.vulnClassId,
    parentThreadId: thread.parentThreadId,
    forkedFromTurn: thread.forkedFromTurn,
    gen: thread.gen,
    turns: thread.turns.map((t) => ({
      turnIndex: t.turnIndex,
      prompt: t.prompt,
      response: t.response,
      persona: t.persona,
      strategy: t.strategy,
      isError: t.isError,
      rateLimited: t.rateLimited,
      score: t.score,
    })),
    turnCount: thread.turns.length,
  };
}

export interface SnapshotMeta {
  objective?: string;
  targetName?: string;
  targetEndpoint?: string;
  budgetUsd?: number;
  commanderModel?: string;
  operatorModel?: string;
  scoutModel?: string;
}

export function serializeRunLog(log: RunLog, meta: SnapshotMeta = {}): UiRunState {
  const threads = [...log.threads.values()].map(serializeThread);
  const turns = threads.reduce((n, t) => n + t.turnCount, 0);
  return {
    runId: log.runId,
    phase: log.completed ? "complete" : "running",
    startedAt: log.startedAt,
    objective: log.objective,
    targetName: log.targetName,
    targetEndpoint: log.targetEndpoint,
    completed: log.completed,
    truncated: log.truncated,
    truncationReason: log.truncationReason,
    totalCostUsd: log.totalCostUsd,
    budgetUsd: meta.budgetUsd,
    commanderModel: meta.commanderModel,
    operatorModel: meta.operatorModel,
    scoutModel: meta.scoutModel,
    summary: {
      threads: threads.length,
      findings: log.findings.length,
      leads: log.leads.length,
      turns,
    },
    threads,
    findings: log.findings,
    leads: log.leads,
    fingerprint: log.fingerprint,
  };
}
