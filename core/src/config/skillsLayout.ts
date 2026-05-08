import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

/** `skills/astra-setup` at repo root (works from `core/src/config` and `core/dist/config`). */
export function getAstraSetupRoot(): string {
  return path.resolve(__dirname, "../../../skills/astra-setup");
}
