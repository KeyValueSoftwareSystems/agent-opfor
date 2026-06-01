import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

/** `skills/agent-redteaming/opfor-setup` — SKILL.md and targets (evaluators live at repo-root `evaluators/agent/`). */
export function getOpforSetupRoot(): string {
  return path.resolve(__dirname, "../../../skills/agent-redteaming/opfor-setup");
}
