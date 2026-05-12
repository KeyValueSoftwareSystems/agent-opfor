import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

/** `skills/agent-redteaming/opfor-setup` at repo root (works from `core/src/config` and `core/dist/config`). */
export function getOpforSetupRoot(): string {
  return path.resolve(__dirname, "../../../skills/agent-redteaming/opfor-setup");
}
