// Browser-safe agent AttackDriver — no Node-only imports.
// Fills the AttackDriver holes for agent/chatbot attacks; runAttack owns the loop.

import type { LanguageModel } from "ai";
import { generateNextAdaptiveTurn } from "../generate/generateNextTurn.js";
import type { AttackPattern } from "../evaluators/parseEvaluator.js";
import { judgeResponse } from "../evaluators/judge.js";
import { errorJudge } from "../lib/judgeTypes.js";
import type { JudgeObservabilityContext } from "../evaluators/judge.js";
import { isTargetError } from "../targets/agentTarget.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import { newOtelTraceId } from "../lib/tracePropagation.js";
import { randomUUID } from "../lib/random.js";
import { getAdapter } from "../telemetry/adapter.js";
import { log } from "../lib/logger.js";
import type { AgentAttackSpec, AttackResult, AgentTurnRecord } from "./types.js";
import type { TelemetryConfig } from "../config/types.js";
import type { UnifiedTargetConfig } from "./types.js";
import { ConversationHistory } from "./conversationHistory.js";
import type { AttackDriver } from "./attackRunner.js";

export interface AgentAttackContext {
  targetConfig?: UnifiedTargetConfig;
  telemetry?: TelemetryConfig;
  /** Prior conversation turns to seed the history (used for resume). */
  initialHistory?: { role: "user" | "assistant"; content: string }[];
}

/**
 * Drives one agent attack: build a prompt (seed on turn 1, else an adaptive
 * follow-up), send it, record the turn, stop on a target error, and judge the
 * whole transcript once at the end.
 */
export class AgentAttackDriver implements AttackDriver<string, string> {
  readonly startTurn: number;
  readonly totalTurns: number;

  private readonly turns: AgentTurnRecord[] = [];
  private readonly history: ConversationHistory;
  // Previous turn's technique, threaded into the next turn's user-block as
  // PREVIOUS_TECHNIQUE. Undefined on turn 1 and on the first turn of a resumed
  // run (no prior technique yet), so the refusal-pivot rule (STEP 5) skips there.
  private previousTechnique: string | undefined;
  private finalPrompt: string;
  private finalResponse = "";
  private readonly propagation: TelemetryConfig["propagation"];
  private readonly attackTraceId: string | undefined;
  // One sessionId per attack — every turn reuses it so a stateful agent under
  // test can thread its own chat history across turns.
  private readonly attackSessionId = randomUUID();

  constructor(
    private readonly attack: AgentAttackSpec,
    private readonly attackModel: LanguageModel,
    private readonly judgeModel: LanguageModel,
    private readonly attackIndex: string,
    private readonly patterns: AttackPattern[],
    private readonly target: AgentTarget,
    private readonly context?: AgentAttackContext
  ) {
    this.history = new ConversationHistory(context?.initialHistory);
    this.finalPrompt = attack.prompt ?? "";
    // For resume: if we already have a completed turn, seed finalPrompt/Response from it.
    if (this.history.turnCount >= 1) {
      this.finalPrompt = this.history.lastUser();
      this.finalResponse = this.history.lastAssistant();
    }
    // Resume: seed turns already in the transcript so the result reports the
    // full conversation, not just turns run after resume.
    const seeded = this.history.messages;
    for (let i = 0; i + 1 < seeded.length; i += 2) {
      if (seeded[i].role === "user" && seeded[i + 1].role === "assistant") {
        this.turns.push({
          kind: "agent",
          turnIndex: this.turns.length + 1,
          prompt: seeded[i].content,
          response: seeded[i + 1].content,
        });
      }
    }

    this.propagation = context?.telemetry?.propagation;
    const hasPropagation =
      Boolean(this.propagation?.headers && Object.keys(this.propagation.headers).length > 0) ||
      Boolean(this.propagation?.traceIdBodyField?.trim());
    this.attackTraceId =
      hasPropagation && (this.propagation?.traceIdStrategy ?? "per-attack") === "per-attack"
        ? newOtelTraceId()
        : undefined;

    this.startTurn = this.history.turnCount + 1;
    this.totalTurns = attack.turns;
  }

  async buildTurn(turnNo: number): Promise<string> {
    // Comprehensive mode seeds attack.prompt → turn 1 uses it verbatim. Adaptive
    // mode sets attack.prompt = "" → generateNextAdaptiveTurn picks the opening.
    if (turnNo === 1 && this.attack.prompt) {
      return this.finalPrompt;
    }

    const result = await generateNextAdaptiveTurn({
      history: this.history.messages,
      attack: this.attack,
      patterns: this.patterns,
      target: this.context?.targetConfig ?? {
        kind: "agent",
        name: "",
        description: "",
        type: "http-endpoint",
      },
      model: this.attackModel,
      currentTurn: turnNo,
      maxTurns: this.attack.turns,
      attackObjective: this.attack.attackObjective,
      businessUseCase: this.attack.businessUseCase,
      siteSnapshot: this.attack.siteSnapshot,
      maxLength: this.attack.maxMessageLength,
      traceContext: this.attack.traceContext,
      previousTechnique: this.previousTechnique,
      upstreamSessions: this.attack.upstreamSessions,
    });
    this.previousTechnique = result.technique;
    log.dim(
      `[attacker] turn=${turnNo}/${this.attack.turns} technique=${result.technique ?? "unknown"} hook=${
        result.lastReplyHook?.slice(0, 60) ?? "-"
      }`
    );
    return result.message;
  }

  async execute(prompt: string): Promise<string> {
    return this.target.send(prompt, {
      sessionId: this.attackSessionId,
      history: this.history.messages,
      propagation: this.propagation,
      attackTraceId: this.attackTraceId,
      attackIndex: Number.isFinite(Number(this.attackIndex)) ? Number(this.attackIndex) : undefined,
    });
  }

  record(turnNo: number, prompt: string, response: string): void {
    this.history.push(prompt, response);
    this.finalPrompt = prompt;
    this.finalResponse = response;
    this.turns.push({ kind: "agent", turnIndex: turnNo, prompt, response });
  }

  async shouldEarlyStop(_turnNo: number, _prompt: string, response: string): Promise<boolean> {
    return isTargetError(response);
  }

  async finalize(): Promise<AttackResult> {
    await this.target.close();

    const finalJudge =
      this.turns.length === 0
        ? errorJudge("no turns completed")
        : isTargetError(this.finalResponse)
          ? errorJudge(this.finalResponse)
          : await judgeResponse(
              {
                id: this.attack.evaluatorId,
                name: this.attack.evaluatorName,
                severity: this.attack.severity,
                standards: this.attack.standards,
                description: this.attack.description ?? "",
                passCriteria: this.attack.passCriteria,
                failCriteria: this.attack.failCriteria,
                patterns: [],
              },
              this.finalPrompt,
              this.finalResponse,
              this.judgeModel,
              await buildJudgeObservability(
                this.context?.telemetry,
                this.attackTraceId,
                this.finalResponse
              ),
              this.history.size > 2 ? this.history.messages : undefined,
              { patternName: this.attack.patternName, judgeHint: this.attack.judgeHint },
              this.attack.upstreamSessions
            );

    return {
      kind: "agent",
      attackId: this.attack.id,
      evaluatorId: this.attack.evaluatorId,
      patternName: this.attack.patternName,
      prompt: this.finalPrompt,
      response: this.finalResponse,
      judge: finalJudge,
      turns: this.turns.length > 1 ? this.turns : undefined,
    };
  }
}

async function buildJudgeObservability(
  telemetry: TelemetryConfig | undefined,
  attackTraceId: string | undefined,
  finalResponse: string
): Promise<JudgeObservabilityContext | undefined> {
  if (!telemetry || !attackTraceId) return undefined;
  const obs: JudgeObservabilityContext = { propagatedTraceId: attackTraceId };
  const adapter = getAdapter(telemetry.provider);
  if (adapter && telemetry.enrichJudgeFromTrace && !isTargetError(finalResponse)) {
    log.info(`  → fetching ${telemetry.provider} trace for judge...`);
    const traceJson =
      (await adapter.fetchTraceForJudge(telemetry, attackTraceId, {
        // Budget defaults sized for the completeness poll (wait for the final turn
        // to ingest): ~1s + 7×1.5s ≈ 11.5s cap before returning best-effort.
        initialDelayMs: telemetry.traceFetchInitialDelayMs ?? 1000,
        maxAttempts: telemetry.traceFetchMaxAttempts ?? 8,
        retryDelayMs: telemetry.traceFetchRetryDelayMs ?? 1500,
        maxChars: telemetry.enrichJudgeTraceJsonMaxChars ?? 40_000,
        // Completeness signal: the trace is "done" once this final turn's
        // response has been ingested, not the instant any span appears.
        expectedResponse: finalResponse,
      })) ?? undefined;
    if (traceJson) obs.traceJson = traceJson;
    const ok = traceJson && !traceJson.startsWith("[");
    log.info(`  → trace ${ok ? "fetched ✓" : "not found ✗"}`);
  }
  return obs;
}
