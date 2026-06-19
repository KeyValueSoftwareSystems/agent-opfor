// Browser-safe agent attack runner — no Node-only imports.
// Used by both runAll.ts (Node) and runAllBrowser.ts (browser/extension).
// The caller is responsible for creating and passing the AgentTarget.

import type { LanguageModel } from "ai";
import { generateNextAdaptiveTurn } from "../generate/generateNextTurn.js";
import type { AttackPattern } from "../evaluators/parseEvaluator.js";
import { judgeResponse, errorJudge } from "../evaluators/judge.js";
import type { JudgeObservabilityContext } from "../evaluators/judge.js";
import { isTargetError } from "../targets/agentTarget.js";
import type { AgentTarget } from "../targets/agentTarget.js";
import { newOtelTraceId } from "../lib/tracePropagation.js";
import { randomUUID } from "../lib/random.js";
import { getAdapter } from "../telemetry/adapter.js";
import { log } from "../lib/logger.js";
import type { AttackSpec, AttackResult, AgentTurnRecord } from "./types.js";
import type { TelemetryConfig } from "../config/types.js";
import type { UnifiedTargetConfig } from "./types.js";

export async function runAgentAttack(
  attack: AttackSpec,
  attackModel: LanguageModel,
  judgeModel: LanguageModel,
  attackIndex: string,
  patterns: AttackPattern[],
  target: AgentTarget,
  context?: {
    targetConfig?: UnifiedTargetConfig;
    telemetry?: TelemetryConfig;
    /** Prior conversation turns to seed the history (used for resume). */
    initialHistory?: { role: "user" | "assistant"; content: string }[];
  }
): Promise<AttackResult> {
  const turns: AgentTurnRecord[] = [];
  const history: { role: "user" | "assistant"; content: string }[] = [
    ...(context?.initialHistory ?? []),
  ];
  // Parallel meta channel for attacker tag output (not sent to target).
  // Used to thread PREVIOUS_TECHNIQUE into the next turn's user-block.
  // Resume limitation: on resumed runs (initialHistory non-empty), this
  // array starts empty even when startTurn > 1, so the first resumed turn
  // has no PREVIOUS_TECHNIQUE and the refusal-pivot rule (STEP 5) skips.
  // Subsequent turns within the resumed session populate and work normally.
  // To eliminate: persist meta alongside history in the resume context
  // (Phase 2 alongside AgentTurnRecord.technique field).
  const attackerMeta: Array<{ technique?: string; lastReplyHook?: string }> = [];
  let finalPrompt = attack.prompt ?? "";
  let finalResponse = "";

  // For resume: if we already have history, seed finalPrompt/Response from it
  if (history.length >= 2) {
    finalPrompt = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    finalResponse = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  }

  const propagation = context?.telemetry?.propagation;
  const hasPropagation =
    Boolean(propagation?.headers && Object.keys(propagation.headers).length > 0) ||
    Boolean(propagation?.traceIdBodyField?.trim());
  const attackTraceId =
    hasPropagation && (propagation?.traceIdStrategy ?? "per-attack") === "per-attack"
      ? newOtelTraceId()
      : undefined;

  // One sessionId per attack — every turn of this attack reuses it so a
  // stateful agent under test can thread its own chat history across turns.
  // Agents that don't read sessionIdField just ignore it.
  const attackSessionId = randomUUID();

  const startTurn = Math.floor(history.length / 2) + 1;
  for (let t = startTurn; t <= attack.turns; t++) {
    let prompt: string;
    // Mode discriminator. Comprehensive mode seeds `attack.prompt` from the
    // pattern template via generateAttacks → turn 1 uses that seed verbatim.
    // Adaptive mode sets `attack.prompt = ""` (sentinel) → falls through to
    // generateNextAdaptiveTurn for turn 1, letting the OPENING-variant prompt
    // pick the opening angle dynamically.
    if (t === 1 && attack.prompt) {
      prompt = finalPrompt;
      // Push empty meta so attackerMeta indices stay aligned with turn numbers.
      attackerMeta.push({});
    } else {
      const result = await generateNextAdaptiveTurn({
        history,
        attack,
        patterns,
        target: context?.targetConfig ?? {
          kind: "agent",
          name: "",
          description: "",
          type: "http-endpoint",
        },
        model: attackModel,
        currentTurn: t,
        maxTurns: attack.turns,
        attackObjective: attack.attackObjective,
        businessUseCase: attack.businessUseCase,
        siteSnapshot: attack.siteSnapshot,
        maxLength: attack.maxMessageLength,
        traceContext: attack.traceContext,
        previousTechnique: attackerMeta[attackerMeta.length - 1]?.technique,
        upstreamSessions: attack.upstreamSessions,
      });
      prompt = result.message;
      attackerMeta.push({ technique: result.technique, lastReplyHook: result.lastReplyHook });
      log.dim(
        `[attacker] turn=${t}/${attack.turns} technique=${result.technique ?? "unknown"} hook=${
          result.lastReplyHook?.slice(0, 60) ?? "-"
        }`
      );
    }

    const response = await target.send(prompt, {
      sessionId: attackSessionId,
      history,
      propagation,
      attackTraceId,
      attackIndex: Number.isFinite(Number(attackIndex)) ? Number(attackIndex) : undefined,
    });

    history.push({ role: "user", content: prompt });
    history.push({ role: "assistant", content: response });

    finalPrompt = prompt;
    finalResponse = response;
    turns.push({ kind: "agent", turnIndex: t, prompt, response });

    if (isTargetError(response)) break;
  }

  await target.close();

  const finalJudge =
    turns.length === 0
      ? errorJudge("no turns completed")
      : isTargetError(finalResponse)
        ? errorJudge(finalResponse)
        : await judgeResponse(
            {
              id: attack.evaluatorId,
              name: attack.evaluatorName,
              severity: attack.severity,
              standards: attack.standards,
              description: attack.description ?? "",
              passCriteria: attack.passCriteria,
              failCriteria: attack.failCriteria,
              patterns: [],
            },
            finalPrompt,
            finalResponse,
            judgeModel,
            await buildJudgeObservability(context?.telemetry, attackTraceId, finalResponse),
            history.length > 2 ? history : undefined,
            { patternName: attack.patternName, judgeHint: attack.judgeHint },
            attack.upstreamSessions
          );

  return {
    attackId: attack.id,
    evaluatorId: attack.evaluatorId,
    patternName: attack.patternName,
    prompt: finalPrompt,
    response: finalResponse,
    judge: finalJudge,
    turns: turns.length > 1 ? turns : undefined,
  };
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
