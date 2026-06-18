// Shared option/config types for the autonomous red-team runner.
// This package is fully standalone — it does NOT import from @opfor/core.

/** How the target HTTP agent maintains conversation state. */
export type TargetMode = "stateless" | "stateful";

/**
 * Transport configuration for the target agent under test.
 * The agent (Claude SDK) never sees these values — tools hold the client.
 */
export interface TargetConfig {
  /** Display name (defaults to the endpoint host). */
  name: string;
  /** Target HTTP endpoint URL. */
  endpoint: string;
  /** Bearer API key sent as `Authorization: Bearer <key>` (optional). */
  apiKey?: string;
  /** Extra static headers merged into every request. */
  headers?: Record<string, string>;
  /**
   * - "stateless" (default): we replay the full conversation as an OpenAI-shape
   *   `messages` array each turn.
   * - "stateful": we send only the latest prompt + a session id; the target
   *   remembers prior turns server-side.
   */
  mode: TargetMode;
  /** Dot-path where the prompt is written in the request body (custom JSON mode). */
  promptPath?: string;
  /** Dot-path where the reply is read from the response body. */
  responsePath?: string;
  /** Field name carrying the session id (stateful mode). */
  sessionField?: string;
  /** `model` value sent in OpenAI-shape requests. */
  model?: string;
}

/** Fully-resolved options for a single autonomous run. */
export interface AutoOptions {
  target: TargetConfig;
  objective: string;
  /** Commander model (alias like "opus"/"sonnet" or full id). */
  commanderModel: string;
  /** Operator subagent model. */
  operatorModel: string;
  /** Scout subagent model. */
  scoutModel: string;
  /** Max parallel operator subagents the commander should dispatch. */
  maxOperators: number;
  /** Hard ceiling on SDK agentic turns. */
  maxTurns: number;
  /**
   * Per-thread depth SAFETY CEILING (sends are refused past this). A runaway backstop,
   * NOT the operating limit — the agent stops on diminishing returns (the progress signal)
   * well before reaching it. Post-fork it bounds the whole lineage, since a forked child
   * inherits the parent's turns.
   */
  maxThreadTurns: number;
  /** Hard ceiling on total attack threads (tree size); forking is refused past this. */
  maxTotalThreads: number;
  /** Hard ceiling on direct forks (children) of any one thread (fan-out). */
  maxForksPerThread: number;
  /** Deterministic ceiling on total target sends (real-time cost backstop). Optional → budget-derived. */
  maxTotalSends?: number;
  /** Max exploration generations (follow-up waves) the commander may spawn from leads. */
  maxDepth: number;
  /** Soft guidance: how many leads the commander should expand per wave (top-K). */
  maxLeadsPerWave: number;
  /** Hard USD budget; run finalizes a partial report when breached. The real cost backstop. */
  budgetUsd?: number;
  /** Enable the optional in-package second-model verifier (self_check). */
  verify: boolean;
  /** Verifier model id (defaults to commanderModel). */
  verifierModel?: string;
  /** Dispatch operators one-at-a-time (for rate-limited targets). */
  sequential: boolean;
  /** Persist accepted novel strategies/personas back to the seed library. */
  persistInventions: boolean;
  /** Override directory for the seed knowledge libraries. */
  seedDir?: string;
  /** Output directory for reports. */
  outputDir: string;
  /** Max benign recon probes before recon must conclude. */
  maxReconProbes: number;
}

/** A target fingerprint produced by the recon phase. */
export interface ReconFingerprint {
  /** Free-text summary of the target's apparent role/capabilities. */
  summary: string;
  /** Notable guardrails / refusal behaviours observed. */
  guardrails: string[];
  /** Candidate weak points worth probing. */
  weakPoints: string[];
}
