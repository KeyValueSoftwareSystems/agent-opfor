export type Severity = "critical" | "high" | "medium" | "low";

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

export interface UiFinding {
  findingId: string;
  vulnClassId: string;
  name: string;
  severity: Severity;
  threadId: string;
  strategy: string;
  confidence: number;
  evidence: string;
  reasoning: string;
  failingTurns?: number[];
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
  findings: UiFinding[];
}

export type SsePayload =
  | { kind: "line"; line: string; wall: string }
  | {
      kind: "event";
      event: { type: string; threadId?: string; data?: Record<string, unknown> };
      wall: string;
    }
  | { kind: "state"; state: UiRunState }
  | { kind: "complete"; reportDir?: string; outcome?: string };
