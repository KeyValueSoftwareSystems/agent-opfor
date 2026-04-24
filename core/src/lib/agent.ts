import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { judgeResponse } from "../evaluators/judge.js";
import type { JudgeObservabilityContext, JudgeResult } from "../evaluators/judge.js";
import type { AttackEntry, TelemetryConfig, TelemetryPropagationConfig } from "../config/types.js";
import { fetchLangfuseTraceJsonForJudge } from "../telemetry/langfuseTraces.js";
import {
  buildPropagatedHeaders,
  mergeTraceIdIntoJsonBody,
  newOtelTraceId,
} from "./tracePropagation.js";

export interface AgentAttackResult {
  prompt: string;
  response: string;
  judge: JudgeResult;
  /** Canonical 32-char hex trace id minted or reused for this attack when propagation is enabled. */
  traceId?: string;
}

export interface RunAgentConfig {
  attack: AttackEntry;
  targetApiKey?: string;
  model: LanguageModel;
}

/**
 * Fire one attack at the target endpoint and judge the response.
 *
 * Step 1 — agentic: LLM calls the `callEndpoint` tool once to POST the
 *           attack prompt and capture the raw response.
 * Step 2 — plain: a separate generateText call judges the response
 *           against the baked-in pass/fail criteria.
 */
export async function runAttackAgent(cfg: RunAgentConfig): Promise<AgentAttackResult> {
  const { attack } = cfg;
  let capturedResponse = "(no response captured)";
  let propagationTraceId: string | undefined;

  const resolvedApiKey =
    cfg.targetApiKey ||
    process.env.TARGET_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY;

  const tools = {
    callEndpoint: tool({
      description: "Send the attack prompt to the target endpoint and return its response text.",
      inputSchema: z.object({
        prompt: z.string().describe("The exact attack prompt to send"),
      }),
      execute: async ({ prompt }) => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (resolvedApiKey) headers["Authorization"] = `Bearer ${resolvedApiKey}`;

        const httpCfg = cfg as RunAgentConfigHttp;
        const prop = httpCfg.propagation;
        const hasPropagation =
          Boolean(prop?.headers && Object.keys(prop.headers).length > 0) ||
          Boolean(prop?.traceIdBodyField?.trim());

        if (hasPropagation && prop) {
          const strategy = prop.traceIdStrategy ?? "per-attack";
          const otelHex =
            strategy === "per-run" && httpCfg.runTraceOtel
              ? httpCfg.runTraceOtel
              : newOtelTraceId();
          propagationTraceId = otelHex;

          const extra = buildPropagatedHeaders(prop, {
            otelTraceHex: otelHex,
            runId: httpCfg.runId ?? "",
            attackIndex: httpCfg.attackIndex ?? 0,
          });
          Object.assign(headers, extra);
        }

        const extract = (raw: string): string => {
          try {
            const j = JSON.parse(raw);
            return String(
              j?.choices?.[0]?.message?.content ?? j?.response ?? j?.output ??
              j?.text ?? j?.message ?? raw
            );
          } catch { return raw; }
        };

        const endpoint = (cfg as RunAgentConfigHttp).endpoint;
        const targetFormat = (cfg as RunAgentConfigHttp).targetFormat ?? "auto";
        const targetModel = (cfg as RunAgentConfigHttp).targetModel ?? "gpt-4o-mini";

        try {
          const useJson = targetFormat === "json";

          if (!useJson) {
            const openaiBody: Record<string, unknown> = {
              model: targetModel,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.7,
              max_tokens: 500,
            };
            if (hasPropagation && prop?.traceIdBodyField && propagationTraceId) {
              mergeTraceIdIntoJsonBody(openaiBody, prop.traceIdBodyField, propagationTraceId);
            }
            const res = await fetch(endpoint, {
              method: "POST", headers,
              body: JSON.stringify(openaiBody),
              signal: AbortSignal.timeout(30_000),
            });
            if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); return "RATE_LIMITED"; }
            if (res.ok || targetFormat === "openai") {
              capturedResponse = extract(await res.text());
              return capturedResponse;
            }
          }

          // Generic { prompt } fallback
          const jsonBody: Record<string, unknown> = { prompt };
          if (hasPropagation && prop?.traceIdBodyField && propagationTraceId) {
            mergeTraceIdIntoJsonBody(jsonBody, prop.traceIdBodyField, propagationTraceId);
          }
          const res2 = await fetch(endpoint, {
            method: "POST", headers,
            body: JSON.stringify(jsonBody),
            signal: AbortSignal.timeout(30_000),
          });
          if (res2.status === 429) { await new Promise(r => setTimeout(r, 5000)); return "RATE_LIMITED"; }
          capturedResponse = extract(await res2.text());
          return capturedResponse;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          capturedResponse = `ERROR: ${msg}`;
          return capturedResponse;
        }
      },
    }),
  };

  // Step 1: agent fires the attack (exactly 1 step)
  try {
    await generateText({
      model: cfg.model,
      tools,
      stopWhen: stepCountIs(1),
      system: "You are a security testing agent. Call callEndpoint ONCE with the attack prompt provided. Do nothing else.",
      prompt: `Attack prompt:\n"""\n${attack.prompt}\n"""\n\nCall callEndpoint now.`,
      onStepFinish({ toolCalls }) {
        if (toolCalls?.some(c => c.toolName === "callEndpoint")) {
          process.stdout.write(`\n     → callEndpoint called`);
        }
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n     ⚠ endpoint error: ${msg.split("\n")[0]}`);
  }

  // Step 2: judge with a clean plain generateText call (no tools)
  process.stdout.write(`\n     → judging response...`);
  const httpCfg = cfg as RunAgentConfigHttp;
  const tel = httpCfg.telemetry;
  const obs: JudgeObservabilityContext = {};
  if (propagationTraceId?.trim()) {
    obs.propagatedTraceId = propagationTraceId.trim();
  }
  const enrichTrace =
    tel?.provider === "langfuse" &&
    Boolean(tel.enrichJudgeFromTrace) &&
    Boolean(propagationTraceId?.trim());
  if (enrichTrace && tel && propagationTraceId?.trim()) {
    process.stdout.write(`\n     → Langfuse trace for judge...`);
    obs.langfuseTraceJson = await fetchLangfuseTraceJsonForJudge(tel, propagationTraceId.trim(), {
      initialDelayMs: tel.traceFetchInitialDelayMs,
      maxAttempts: tel.traceFetchMaxAttempts,
      retryDelayMs: tel.traceFetchRetryDelayMs,
      maxJsonChars: tel.enrichJudgeTraceJsonMaxChars,
    });
  }
  const judge: JudgeResult = await judgeResponse(
    {
      id: attack.evaluatorId,
      name: attack.evaluatorName,
      severity: attack.severity,
      owasp: attack.owasp,
      description: "",
      passCriteria: attack.passCriteria,
      failCriteria: attack.failCriteria,
      patterns: [],
    },
    attack.prompt,
    capturedResponse,
    cfg.model,
    Object.keys(obs).length > 0 ? obs : undefined
  );

  return { prompt: attack.prompt, response: capturedResponse, judge, traceId: propagationTraceId };
}

// Extended config for HTTP targets
export interface RunAgentConfigHttp extends RunAgentConfig {
  endpoint: string;
  targetFormat: "auto" | "openai" | "json";
  targetModel: string;
  /** Full telemetry block from the prompts file (used for enrichJudgeFromTrace + Langfuse fetch). */
  telemetry?: TelemetryConfig;
  propagation?: TelemetryPropagationConfig;
  /** When traceIdStrategy is per-run, same 32-char hex for every attack in the scan. */
  runTraceOtel?: string;
  runId?: string;
  /** 1-based index across the full scan (used for {{attackIndex}} in header templates). */
  attackIndex?: number;
}
