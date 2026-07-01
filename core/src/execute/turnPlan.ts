/**
 * Value object for a run's turn shape.
 *
 * Owns the two-step rule the Node and browser run loops both derived by hand:
 *  1. default the turn mode ("multi" when more than one turn is configured, else
 *     "single"), and
 *  2. resolve the effective turn count ("single" forces one turn).
 * Gives the AttackRunner (PR8) one testable place to ask for either.
 */
export class TurnPlan {
  private constructor(
    readonly turnMode: "single" | "multi",
    readonly effectiveTurns: number
  ) {}

  static from(config: { turnMode?: "single" | "multi"; turns: number }): TurnPlan {
    const turnMode = config.turnMode ?? (config.turns > 1 ? "multi" : "single");
    return new TurnPlan(turnMode, turnMode === "single" ? 1 : config.turns);
  }
}
