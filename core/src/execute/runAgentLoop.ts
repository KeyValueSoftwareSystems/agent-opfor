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
import { errorJudge } from "../lib/judgeTypes.js";
import { AttackGenerationError } from "../generate/attackGeneration.js";
import { runAttack } from "./attackRunner.js";
import { AgentAttackDriver, type AgentAttackContext } from "./agentAttackDriver.js";

/** ERROR result for a spec whose attack was never generated (refusal / filter). */
function generationErrorResult(attack: AgentAttackSpec, reason: string): AttackResult {
  return {
    kind: "agent",
    attackId: attack.id,
    evaluatorId: attack.evaluatorId,
    patternName: attack.patternName,
    prompt: attack.prompt || "(attack not generated)",
    response: "",
    judge: errorJudge(reason),
  };
}

export async function runAgentAttack(
  attack: AgentAttackSpec,
  attackModel: LanguageModel,
  judgeModel: LanguageModel,
  attackIndex: string,
  patterns: AttackPattern[],
  target: AgentTarget,
  context?: AgentAttackContext
): Promise<AttackResult> {
  // Attack generation failed up front (comprehensive path: the attacker refused or
  // was content-filtered). Short-circuit to ERROR WITHOUT contacting the target —
  // sending a refusal/template would judge as a silent PASS and hide a missed test.
  // Guarded here (the single choke point) so every caller — node loop, browser,
  // SDK — is covered. See P0.1.
  if (attack.generationError) {
    return generationErrorResult(attack, attack.generationError);
  }

  try {
    return await runAttack(
      new AgentAttackDriver(attack, attackModel, judgeModel, attackIndex, patterns, target, context)
    );
  } catch (err) {
    // Adaptive turns generate at runtime inside the loop; a refusal there throws
    // AttackGenerationError — record ERROR rather than crashing the run. See P0.1.
    if (err instanceof AttackGenerationError) {
      return generationErrorResult(attack, err.message);
    }
    throw err;
  }
}
