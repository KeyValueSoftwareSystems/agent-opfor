// Native report model for the autonomous runner. No @opfor/core dependency.

export type Verdict = "FAIL" | "PASS" | "ERROR";
export type Severity = "critical" | "high" | "medium" | "low";

/** One turn of an attack conversation thread. */
export interface ReportTurn {
  turnIndex: number;
  prompt: string;
  response: string;
  persona?: string;
  strategy?: string;
  /** Self-judged score at this turn, 0-10 (10 = target fully defended). */
  score?: number;
}

/** An independent second-model corroboration of a finding. */
export interface SelfCheckResult {
  verdict: Verdict;
  /** 0-10, 10 = safest. */
  score: number;
  confidence: number;
  reasoning: string;
}

/** One confirmed (or attempted-and-defended) attack thread. */
export interface ReportFinding {
  findingId: string;
  vulnClassId: string;
  name: string;
  severity: Severity;
  standards?: Record<string, string>;
  threadId: string;
  /** The operator's chosen strategy/technique label for this thread. */
  strategy: string;
  /** Personas used across the thread, in order. */
  personaArc: string[];
  verdict: Verdict;
  /** Self-judged success confidence, 0-100. */
  confidence: number;
  /** Verbatim quote from a target response proving the finding. */
  evidence: string;
  reasoning: string;
  /** 1-based turn indices where the failure manifested. */
  failingTurns?: number[];
  turns: ReportTurn[];
  /** Optional independent corroboration. */
  selfCheck?: SelfCheckResult;
  /** True when the same evidence was reproduced on ≥2 genuinely independent threads. */
  crossSessionCorroborated?: boolean;
  /** All threads that produced this (deduped) finding, when more than one. */
  corroboratingThreads?: string[];
  /** Lineage for the attack-tree view. */
  parentThreadId?: string;
  /** Exploration generation of this thread. */
  gen?: number;
}

/** A novel persona/strategy the agent invented during the run. */
export interface ReportInvention {
  kind: "persona" | "strategy";
  name: string;
  description: string;
  /** Path written, if --persist-inventions was set. */
  persistedPath?: string;
}

/** A point in the agent's decision log. */
export interface ReportDecision {
  at: string;
  threadId?: string;
  action: "continue" | "escalate" | "pivot" | "stop" | "dispatch" | "fork" | "note";
  rationale: string;
}

export interface PersonaTimelineEntry {
  threadId: string;
  turnIndex: number;
  persona?: string;
  strategy?: string;
}

export interface AutonomousReport {
  reportId: string;
  generatedAt: string;
  target: { name: string; endpoint: string };
  objective: string;
  objectiveOutcome: "achieved" | "partially-achieved" | "not-achieved" | "inconclusive";
  commanderModel: string;
  operatorModel: string;
  /** Whether the run was truncated by a budget/turn ceiling. */
  truncated: boolean;
  truncationReason?: string;
  totalCostUsd?: number;
  summary: {
    threads: number;
    confirmed: number; // FAIL verdicts (vulnerabilities)
    defended: number; // PASS verdicts
    errors: number;
    attackSuccessRate: number; // confirmed / (confirmed + defended) * 100
  };
  recon: {
    fingerprint: string;
    guardrails: string[];
    weakPoints: string[];
    probeCount: number;
  };
  /** Shape of the adaptive exploration tree (waves/forks/leads). */
  exploration: {
    /** Deepest exploration generation reached across all threads. */
    maxDepthReached: number;
    leadsFlagged: number;
    leadsSpawned: number;
    leadsDismissed: number;
  };
  findings: ReportFinding[];
  personaTimeline: PersonaTimelineEntry[];
  decisionLog: ReportDecision[];
  strategiesUsed: string[];
  inventions: ReportInvention[];
  /** True when the commander submitted a synthesis; false ⇒ executiveNarrative is a fallback. */
  synthesisComplete: boolean;
  executiveNarrative: string;
  responsePatterns: Array<{ pattern: string; observation: string }>;
  recommendations: string[];
}
