// MCP AttackDriver — Node-only (MCP transport). Fills the AttackDriver holes for
// MCP tool-call attacks; runAttack owns the loop. Extracted from runAll.ts.

import { generateNextMcpTurn } from "../generate/generateNextTurn.js";
import type { McpToolTurn } from "../generate/generateNextTurn.js";
import { judgeToolResponse, sanitizeJudgeResult } from "../run/judge.js";
import { errorJudge as mcpErrorJudge, type JudgeResult } from "../lib/judgeTypes.js";
import { log } from "../lib/logger.js";
import type { LanguageModel } from "ai";
import type { LlmConfig } from "../config/types.js";
import type { McpTarget, McpToolCallResult } from "../targets/mcpTarget.js";
import type { McpAttackSpec, McpTurnRecord, AttackResult } from "./types.js";
import { runAttack, type AttackDriver } from "./attackRunner.js";

/**
 * Drives one MCP attack: call a tool (seed args on turn 1, else adaptively
 * generated), record the tool turn, and run a per-turn judge that early-stops on
 * the first FAIL. Judges the last turn once at the end otherwise.
 *
 * Dependencies are injected narrowly (the attacker model built once per run, the
 * judge's LLM config, the resolved non-empty tool name) rather than the whole
 * RunConfig — same construction contract style as AgentAttackDriver.
 */
export class McpAttackDriver implements AttackDriver<Record<string, unknown>, McpToolCallResult> {
  readonly startTurn = 1;
  readonly totalTurns: number;

  private readonly turns: McpTurnRecord[] = [];
  private readonly mcpHistory: McpToolTurn[] = [];
  private judgeHint: string | undefined;
  private earlyStopJudge: JudgeResult | null = null;

  constructor(
    private readonly attack: McpAttackSpec,
    private readonly target: McpTarget,
    private readonly toolName: string,
    private readonly attackModel: LanguageModel,
    private readonly judgeLlm: LlmConfig
  ) {
    this.judgeHint = attack.judgeHint;
    this.totalTurns = attack.turns;
  }

  async buildTurn(turnNo: number): Promise<Record<string, unknown>> {
    if (turnNo === 1) {
      return this.attack.toolArguments ?? {};
    }
    const next = await generateNextMcpTurn(
      this.mcpHistory,
      `${this.attack.patternName} — ${this.attack.evaluatorName}`,
      this.toolName,
      this.attack.toolArguments ?? {},
      this.attackModel
    );
    if (next.judgeHint) this.judgeHint = next.judgeHint;
    return next.args;
  }

  async execute(toolArguments: Record<string, unknown>): Promise<McpToolCallResult> {
    return this.target.callTool(this.toolName, toolArguments);
  }

  record(turnNo: number, toolArguments: Record<string, unknown>, output: McpToolCallResult): void {
    const { response, toolError } = output;
    this.mcpHistory.push({ toolName: this.toolName, toolArguments, response, toolError });
    this.turns.push({
      kind: "mcp",
      turnIndex: turnNo,
      toolName: this.toolName,
      toolArguments,
      response,
      toolError,
    });
  }

  async shouldEarlyStop(
    turnNo: number,
    toolArguments: Record<string, unknown>,
    output: McpToolCallResult
  ): Promise<boolean> {
    // Multi-turn: run a per-turn judge check and early-stop on FAIL.
    if (this.attack.turns > 1 && turnNo < this.attack.turns) {
      const midJudge = await this.judge(toolArguments, output);
      if (midJudge.verdict === "FAIL") {
        log.info(`     ⚡ Early stop at turn ${turnNo}/${this.attack.turns} — vulnerability found`);
        this.earlyStopJudge = midJudge;
        return true;
      }
    }
    return false;
  }

  async finalize(): Promise<AttackResult> {
    const lastTurn = this.turns[this.turns.length - 1];

    let finalJudge: JudgeResult;
    if (this.earlyStopJudge) {
      finalJudge = this.earlyStopJudge;
    } else if (!lastTurn) {
      finalJudge = mcpErrorJudge("no turns completed");
    } else {
      finalJudge = await this.judge(lastTurn.toolArguments, {
        response: lastTurn.response,
        toolError: lastTurn.toolError,
      });
    }

    return {
      kind: "mcp",
      attackId: this.attack.id,
      evaluatorId: this.attack.evaluatorId,
      patternName: this.attack.patternName,
      toolName: this.toolName,
      toolArguments: lastTurn?.toolArguments ?? this.attack.toolArguments,
      toolResponse: lastTurn?.response,
      toolError: lastTurn?.toolError,
      judge: finalJudge,
      turns: this.turns.length > 1 ? this.turns : undefined,
    };
  }

  /**
   * Judge one tool turn and sanitize hallucinated evidence. Shared by the mid-turn
   * early-stop check and the final judgement (previously duplicated verbatim).
   * `priorTurns` excludes the turn under judgement (the last recorded turn).
   */
  private async judge(
    toolArguments: Record<string, unknown>,
    output: McpToolCallResult
  ): Promise<JudgeResult> {
    const { response, toolError } = output;
    const result = await judgeToolResponse({
      model: this.judgeLlm,
      evaluator: {
        id: this.attack.evaluatorId,
        name: this.attack.evaluatorName,
        standards: this.attack.standards,
        severity: this.attack.severity,
        passCriteria: this.attack.passCriteria,
        failCriteria: this.attack.failCriteria,
      },
      attackSummary: this.attack.patternName,
      toolName: this.toolName,
      toolArguments,
      toolResponse: response,
      toolError,
      judgeHint: this.judgeHint,
      priorTurns: this.mcpHistory.length > 1 ? this.mcpHistory.slice(0, -1) : undefined,
    });
    return sanitizeJudgeResult(result, {
      attackSummary: this.attack.patternName,
      toolArguments,
      toolResponse: response,
      toolError,
    });
  }
}

/**
 * Run one MCP attack. Short-circuits to an ERROR result when the spec carries no
 * tool name (nothing to call); otherwise drives the shared attack loop.
 */
export async function runMcpAttack(
  attack: McpAttackSpec,
  target: McpTarget,
  attackModel: LanguageModel,
  judgeLlm: LlmConfig
): Promise<AttackResult> {
  if (!attack.toolName) {
    return {
      kind: "mcp",
      attackId: attack.id,
      evaluatorId: attack.evaluatorId,
      patternName: attack.patternName,
      toolName: "",
      toolArguments: {},
      toolResponse: "",
      toolError: "no toolName in attack spec",
      judge: mcpErrorJudge("no toolName in attack spec"),
    };
  }
  return runAttack(new McpAttackDriver(attack, target, attack.toolName, attackModel, judgeLlm));
}
