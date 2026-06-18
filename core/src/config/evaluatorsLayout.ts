import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

export type EvaluatorCategory = "agent" | "mcp";

export function getRepoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

/** Source-of-truth evaluator directory: `evaluators/{agent|mcp}/`. */
export function getEvaluatorsDir(category: EvaluatorCategory): string {
  return path.join(getRepoRoot(), "evaluators", category);
}

/** Source-of-truth suites directory: `suites/`. */
export function getSuitesDir(): string {
  return path.join(getRepoRoot(), "suites");
}

export function getSkillName(category: EvaluatorCategory): string {
  return category === "mcp" ? "mcp-redteaming" : "agent-redteaming";
}

/** `skills/{agent|mcp}-redteaming/opfor-setup` — prompts and SKILL.md live here. */
export function getSkillOpforSetupRoot(category: EvaluatorCategory): string {
  return path.join(getRepoRoot(), "skills", getSkillName(category), "opfor-setup");
}

/** Catalog JSON for a surface: `.../opfor-setup/catalog.json`. */
export function getCatalogPath(category: EvaluatorCategory): string {
  return path.join(getSkillOpforSetupRoot(category), "catalog.json");
}
