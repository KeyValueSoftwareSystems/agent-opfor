// Browser-safe agent attack runner — no Node-only imports.
// Used by both runAll.ts (Node) and runAllBrowser.ts (browser/extension).
// The caller is responsible for creating and passing the AgentTarget.
//
// Thin wrapper: the loop is the shared runAttack Template Method, the agent
// behavior is AgentAttackDriver.

import type { LanguageModel } from "ai";
import type { AttackPattern } from "../evaluators/parseEvaluator.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import type { AgentAttackSpec, AttackResult } from "./types.js";
import { runAttack } from "./attackRunner.js";
import { AgentAttackDriver, type AgentAttackContext } from "./agentAttackDriver.js";

export async function runAgentAttack(
  attack: AgentAttackSpec,
  attackModel: LanguageModel,
  judgeModel: LanguageModel,
  attackIndex: string,
  patterns: AttackPattern[],
  target: AgentTarget,
  context?: AgentAttackContext
): Promise<AttackResult> {
  return runAttack(
    new AgentAttackDriver(attack, attackModel, judgeModel, attackIndex, patterns, target, context)
  );
}
