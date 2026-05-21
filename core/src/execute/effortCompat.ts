import type { Effort } from "./types.js";

/**
 * Accept legacy "medium"/"hard" alongside the new "adaptive"/"comprehensive"
 * names. Existing opfor.config.json files written before the rename still
 * load — we map them to the new names on read.
 */
export function normalizeEffort(raw: unknown): Effort {
  if (raw === "adaptive" || raw === "comprehensive") return raw;
  if (raw === "medium") return "adaptive";
  if (raw === "hard") return "comprehensive";
  return "adaptive";
}
