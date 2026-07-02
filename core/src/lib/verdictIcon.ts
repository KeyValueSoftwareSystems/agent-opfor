import type { Verdict } from "./judgeTypes.js";

/** Terminal glyph for a verdict: ✓ pass, ✗ fail, ⚠ error. */
export function verdictIcon(verdict: Verdict): string {
  return verdict === "PASS" ? "✓" : verdict === "FAIL" ? "✗" : "⚠";
}
