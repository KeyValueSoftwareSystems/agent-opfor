import type { Effort } from "./types.js";

/**
 * Defensive coerce for effort read from config files (which could be
 * hand-edited with anything). Returns "adaptive" for anything other than
 * "comprehensive".
 */
export function normalizeEffort(raw: unknown): Effort {
  return raw === "comprehensive" ? "comprehensive" : "adaptive";
}
