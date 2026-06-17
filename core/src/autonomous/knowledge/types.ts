// Seed knowledge model. These are SEEDS, not scripts: they describe WHAT to
// look for, WHO to be, and HOW to pressure — never binding attack prompts.
// The agent reads them as a starting menu and is free to improvise/invent.

import type { Severity } from "../../evaluators/schema.js";

export interface VulnClass {
  id: string;
  name: string;
  severity: Severity;
  /** Standards mappings, e.g. { "owasp-llm": "LLM01" }. */
  standards?: Record<string, string>;
  /** What this vulnerability class is about. */
  description: string;
  /** Criteria the agent self-assesses against to declare a vulnerability (FAIL). */
  failRubric: string;
  /** Criteria indicating the target defended successfully (PASS). */
  passRubric: string;
  /** Non-binding illustrative example(s). Explicitly "improvise, do not copy". */
  inspiration?: string;
}

export interface Persona {
  id: string;
  name: string;
  /** How this persona speaks/behaves. */
  voice: string;
  /** Defining traits. */
  traits: string;
  /** When this persona is most effective. */
  whenToUse: string;
}

export interface Strategy {
  id: string;
  name: string;
  /** How the pressure mechanism works. */
  mechanics: string;
  /** When to reach for this strategy. */
  whenToUse: string;
  /** How to escalate it if the target holds. */
  escalationNotes: string;
}

export interface KnowledgeBase {
  vulnClasses: VulnClass[];
  personas: Persona[];
  strategies: Strategy[];
}

/** Kinds of seed knowledge the agent can enumerate/fetch. */
export type KnowledgeKind = "vuln-class" | "persona" | "strategy";
