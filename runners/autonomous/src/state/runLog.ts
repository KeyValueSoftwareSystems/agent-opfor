// Shared in-memory accumulator written by tool handlers and hooks.
// This is the source of truth the report is built from.

import type { TargetMessage } from "../target/http.js";
import type { Severity, Verdict, SelfCheckResult } from "../report/types.js";

export interface ThreadTurn {
  turnIndex: number;
  prompt: string;
  response: string;
  persona?: string;
  strategy?: string;
  isError: boolean;
  rateLimited: boolean;
  /** Self-judged score recorded for this turn, if any (0-10, 10 = defended). */
  score?: number;
}

export interface ThreadState {
  threadId: string;
  vulnClassId?: string;
  /** Replayed to stateless targets; carries continuity for the next send. */
  history: TargetMessage[];
  turns: ThreadTurn[];
  createdAt: number;
}

export interface Finding {
  findingId: string;
  vulnClassId: string;
  name: string;
  severity: Severity;
  standards?: Record<string, string>;
  threadId: string;
  strategy: string;
  personaArc: string[];
  verdict: Verdict;
  confidence: number;
  evidence: string;
  reasoning: string;
  failingTurns?: number[];
  selfCheck?: SelfCheckResult;
  at: string;
}

export interface Invention {
  kind: "persona" | "strategy";
  id: string;
  name: string;
  description: string;
  persistedPath?: string;
}

export interface Decision {
  at: string;
  threadId?: string;
  action: "continue" | "escalate" | "pivot" | "stop" | "dispatch" | "note";
  rationale: string;
}

export interface ReconProbe {
  probe: string;
  response: string;
  isError: boolean;
  at: string;
}

export interface TranscriptEntry {
  at: string;
  agentId?: string;
  agentType?: string;
  tool: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface Synthesis {
  executiveSummary: string;
  objectiveOutcome: "achieved" | "partially-achieved" | "not-achieved" | "inconclusive";
  responsePatterns: Array<{ pattern: string; observation: string }>;
  vulnerabilitySummary: string;
  recommendations: string[];
  strategyNarrative: string;
}

export interface ReconFingerprintState {
  summary: string;
  guardrails: string[];
  weakPoints: string[];
}

export interface RunLog {
  runId: string;
  startedAt: string;
  objective: string;
  targetName: string;
  targetEndpoint: string;
  recon: ReconProbe[];
  fingerprint?: ReconFingerprintState;
  threads: Map<string, ThreadState>;
  findings: Finding[];
  inventions: Invention[];
  decisions: Decision[];
  transcript: TranscriptEntry[];
  /** Most recent self_check verdict per thread, attached to findings on that thread. */
  selfChecks: Map<string, SelfCheckResult>;
  synthesis?: Synthesis;
  completed: boolean;
  truncated: boolean;
  truncationReason?: string;
  totalCostUsd?: number;
}

export function createRunLog(params: {
  runId: string;
  objective: string;
  targetName: string;
  targetEndpoint: string;
}): RunLog {
  return {
    runId: params.runId,
    startedAt: new Date().toISOString(),
    objective: params.objective,
    targetName: params.targetName,
    targetEndpoint: params.targetEndpoint,
    recon: [],
    threads: new Map(),
    findings: [],
    inventions: [],
    decisions: [],
    transcript: [],
    selfChecks: new Map(),
    completed: false,
    truncated: false,
  };
}

export function getOrCreateThread(
  log: RunLog,
  threadId: string,
  vulnClassId?: string
): ThreadState {
  let thread = log.threads.get(threadId);
  if (!thread) {
    thread = { threadId, vulnClassId, history: [], turns: [], createdAt: Date.now() };
    log.threads.set(threadId, thread);
  } else if (vulnClassId && !thread.vulnClassId) {
    thread.vulnClassId = vulnClassId;
  }
  return thread;
}

/** Whitespace-normalize for the evidence-substring hallucination guard. */
export function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** True if `evidence` appears in any recorded target response on the thread. */
export function evidenceFoundInThread(thread: ThreadState | undefined, evidence: string): boolean {
  if (!thread) return false;
  const needle = normalizeForMatch(evidence);
  if (needle.length < 3) return false;
  return thread.turns.some((t) => normalizeForMatch(t.response).includes(needle));
}
