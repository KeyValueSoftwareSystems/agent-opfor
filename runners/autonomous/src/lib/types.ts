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
  targetModel?: string;
}

/** Fully-resolved options for a single autonomous run. */
export interface AutoOptions {
  target: TargetConfig;
  objective: string;
  /** Commander model (alias like "opus"/"sonnet" or full id). */
  commanderModel: string;
  /** Attacker subagent model. */
  attackerModel: string;
  /** Recon subagent model. */
  reconModel: string;
  /** Max parallel attacker subagents the commander should dispatch. */
  maxAttackers: number;
  /** Hard ceiling on SDK agentic turns. */
  maxTurns: number;
  /** Per-attack-thread turn cap (refuse sends past this). */
  maxThreadTurns: number;
  /** Hard USD budget; run finalizes a partial report when breached. */
  budgetUsd?: number;
  /** Enable the optional in-package second-model verifier (self_check). */
  verify: boolean;
  /** Verifier model id (defaults to commanderModel). */
  verifierModel?: string;
  /** Dispatch attackers one-at-a-time (for rate-limited targets). */
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
