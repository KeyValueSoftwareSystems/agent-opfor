import type { AttackResult } from "./types.js";

/**
 * Per-kind strategy for one attack. Agent and MCP attacks share a control flow —
 * loop over turns, build an input, execute it against the target, record the
 * result, optionally stop early, then judge once and assemble a result — but
 * differ in every step. A driver fills those holes; {@link runAttack} owns the
 * order so the two kinds can't drift (the duplication the review flagged).
 *
 * `TInput` is what a turn sends (an agent prompt, an MCP tool call); `TOutput` is
 * what the target returns (a response string, a tool response + error).
 */
export interface AttackDriver<TInput, TOutput> {
  /** First turn to run (1, or later when resuming a partial transcript). */
  readonly startTurn: number;
  /** Last turn to run, inclusive. */
  readonly totalTurns: number;

  /** Build the input for one turn (seed, or an adaptively-generated follow-up). */
  buildTurn(turnNo: number): Promise<TInput>;
  /** Send the input to the target and return its output. */
  execute(input: TInput): Promise<TOutput>;
  /** Record the completed turn (append to the transcript / turn list). */
  record(turnNo: number, input: TInput, output: TOutput): void;
  /** Whether to stop after this turn — may run a mid-attack judge check. */
  shouldEarlyStop(turnNo: number, input: TInput, output: TOutput): Promise<boolean>;
  /** Judge the completed attack and assemble its result. */
  finalize(): Promise<AttackResult>;
}

/**
 * Template Method for running one attack: the invariant skeleton every attack
 * kind shares. The `driver` supplies the kind-specific behavior.
 */
export async function runAttack<TInput, TOutput>(
  driver: AttackDriver<TInput, TOutput>
): Promise<AttackResult> {
  for (let turnNo = driver.startTurn; turnNo <= driver.totalTurns; turnNo++) {
    const input = await driver.buildTurn(turnNo);
    const output = await driver.execute(input);
    driver.record(turnNo, input, output);
    if (await driver.shouldEarlyStop(turnNo, input, output)) break;
  }
  return driver.finalize();
}
