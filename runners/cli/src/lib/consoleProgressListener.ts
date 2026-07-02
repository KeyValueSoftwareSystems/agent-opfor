import type { RunListener } from "@keyvaluesystems/agent-opfor-core/execute/runListener.js";
import { log } from "@keyvaluesystems/agent-opfor-core/lib/logger.js";
import { verdictIcon } from "@keyvaluesystems/agent-opfor-core/lib/verdictIcon.js";

/**
 * Prints run progress to the terminal — a header per evaluator and a ✓/✗/⚠ mark
 * per completed attack. Implemented as a RunListener so the CLI consumes engine
 * lifecycle events through the SPI rather than an ad-hoc onProgress switch.
 */
export class ConsoleProgressListener implements RunListener {
  onEvaluatorStart(info: { evaluatorId: string; evaluatorName: string }): void {
    log.info(`\n▶ ${info.evaluatorName}`);
  }

  onAttackDone(info: { attackId: string; verdict: "PASS" | "FAIL" | "ERROR" }): void {
    process.stdout.write(` ${verdictIcon(info.verdict)}`);
  }
}
