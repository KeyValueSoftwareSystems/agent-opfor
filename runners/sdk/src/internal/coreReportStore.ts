import type { UnifiedRunReport } from "@keyvaluesystems/agent-opfor-core/execute/types.js";
import type { RunResults } from "../types.js";

/** Retains the core UnifiedRunReport for CLI-style HTML rendering via writeReport(). */
const coreReports = new Map<string, UnifiedRunReport>();

export function attachCoreReport(results: RunResults, core: UnifiedRunReport): void {
  coreReports.set(results.id, core);
}

export function getCoreReport(results: RunResults): UnifiedRunReport | undefined {
  return coreReports.get(results.id);
}

export function detachCoreReport(results: RunResults): void {
  coreReports.delete(results.id);
}
