import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

/** Subfolder under skills/.../opfor-setup — synced copies for npx skills add consumers. */
export const GENERATED_DIRNAME = "_generated";

export type EvaluatorCategory = "agent" | "mcp";

export function getRepoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

/** Source-of-truth evaluator markdown: `evaluators/{agent|mcp}/`. */
export function getEvaluatorsDir(category: EvaluatorCategory): string {
  return path.join(getRepoRoot(), "evaluators", category);
}

/** Source-of-truth suite markdown: `suites/{agent|mcp}/`. */
export function getSuitesDir(category: EvaluatorCategory): string {
  return path.join(getRepoRoot(), "suites", category);
}

export function getSkillName(category: EvaluatorCategory): string {
  return category === "mcp" ? "mcp-redteaming" : "agent-redteaming";
}

/** `skills/{agent|mcp}-redteaming/opfor-setup` — prompts and SKILL.md live here. */
export function getSkillOpforSetupRoot(category: EvaluatorCategory): string {
  return path.join(getRepoRoot(), "skills", getSkillName(category), "opfor-setup");
}

/** Generated mirror for skill installs: `.../opfor-setup/_generated/evaluators/`. */
export function getGeneratedEvaluatorsDir(category: EvaluatorCategory): string {
  return path.join(getSkillOpforSetupRoot(category), GENERATED_DIRNAME, "evaluators");
}

/** Generated mirror: `.../opfor-setup/_generated/suites/`. */
export function getGeneratedSuitesDir(category: EvaluatorCategory): string {
  return path.join(getSkillOpforSetupRoot(category), GENERATED_DIRNAME, "suites");
}
