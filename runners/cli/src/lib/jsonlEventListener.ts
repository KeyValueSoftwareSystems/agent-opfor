import { writeFileSync, appendFileSync } from "node:fs";
import type { RunListener } from "@keyvaluesystems/agent-opfor-core/execute/runListener.js";
import type { UnifiedRunReport } from "@keyvaluesystems/agent-opfor-core/execute/types.js";

/**
 * Streams run lifecycle events as newline-delimited JSON (one event per line) to a
 * file — a machine-readable alternative output for CI / automation that can tail
 * progress and results live.
 *
 * This is the RunListener SPI's payoff: a new output format is just a new listener,
 * with zero engine changes. Writes are synchronous so events land in order and a
 * hook can never race the run (notifyListeners isolates any throw).
 */
export class JsonlEventListener implements RunListener {
  constructor(private readonly path: string) {
    // Start each run with a fresh file so a re-run doesn't append to stale events.
    writeFileSync(this.path, "");
  }

  private write(event: Record<string, unknown>): void {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  }

  onRunStart(info: { evaluatorCount: number }): void {
    this.write({ type: "run_start", evaluatorCount: info.evaluatorCount });
  }

  onEvaluatorStart(info: { evaluatorId: string; evaluatorName: string }): void {
    this.write({ type: "evaluator_start", ...info });
  }

  onAttackStart(info: { attackId: string; patternName: string }): void {
    this.write({ type: "attack_start", ...info });
  }

  onAttackDone(info: { attackId: string; verdict: "PASS" | "FAIL" | "ERROR" }): void {
    this.write({ type: "attack_done", ...info });
  }

  onEvaluatorDone(info: {
    evaluatorId: string;
    passed: number;
    failed: number;
    errors: number;
  }): void {
    this.write({ type: "evaluator_done", ...info });
  }

  onRunStopped(info: { reason: string }): void {
    this.write({ type: "run_stopped", reason: info.reason });
  }

  onRunError(info: { error: unknown }): void {
    this.write({
      type: "run_error",
      error: info.error instanceof Error ? info.error.message : String(info.error),
    });
  }

  onRunFinish(report: UnifiedRunReport): void {
    this.write({ type: "run_finish", reportId: report.reportId, summary: report.summary });
  }
}
