import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

export type EvaluatorCategory = "agent" | "mcp";

export function getRepoRoot(): string {
  // When installed from npm, data dirs are colocated at the package root (2 levels up from dist/config).
  // In the monorepo, data dirs live at the repo root (3 levels up).
  const packageRoot = path.resolve(__dirname, "../..");
  if (existsSync(path.join(packageRoot, "evaluators"))) {
    return packageRoot;
  }
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

/** `skills/{agent|mcp}-redteaming/opfor-setup` — prompts, SKILL.md, and catalog.json live here. */
export function getSkillOpforSetupRoot(category: EvaluatorCategory): string {
  return path.join(getRepoRoot(), "skills", getSkillName(category), "opfor-setup");
}

/** Pre-built skill catalog: `.../opfor-setup/catalog.json` (written by scripts/build-catalog.ts). */
export function getSkillCatalogPath(category: EvaluatorCategory): string {
  return path.join(getSkillOpforSetupRoot(category), "catalog.json");
}
