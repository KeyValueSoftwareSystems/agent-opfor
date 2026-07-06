import type { AgentTargetConfig } from "../execute/types.js";
import {
  applySessionToRequest,
  captureSessionFromResponse,
  resolveSessionPlan,
} from "./httpClient.js";
import { getEnv } from "../lib/env.js";
import { invokeLocalTargetScript } from "../lib/localScriptTarget.js";
import {
  buildPropagatedHeaders,
  mergeTraceIdIntoJsonBody,
  newOtelTraceId,
} from "../lib/tracePropagation.js";
import type { TelemetryPropagationConfig } from "../config/types.js";

export const RATE_LIMITED_SENTINEL = "RATE_LIMITED";

export function isTargetError(response: string): boolean {
  return response === RATE_LIMITED_SENTINEL || response.startsWith("ERROR:");
}

/**
 * Error thrown when target returns a non-retryable error (4xx, connection refused, etc.)
 * The run should stop immediately.
 */
export class TargetStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetStopError";
  }
}

/**
 * Check if a target HTTP status code is retryable.
 * - 5xx: Server errors - retryable (server might recover)
 * - 429: Rate limited - retryable
 * - 4xx (except 429): Client errors - NOT retryable (bad config, auth, etc.)
 */
function isRetryableStatus(status: number): boolean {
  if (status === 429) return true; // Rate limited
  if (status >= 500 && status < 600) return true; // Server errors
  return false;
}

/**
 * Check if an error message indicates a non-retryable condition (stop immediately).
 */
function isNonRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("getaddrinfo")
  );
}

export interface AgentSendOptions {
  sessionId?: string;
  propagation?: TelemetryPropagationConfig;
  runTraceOtel?: string;
  /** Pre-generated per-attack trace id so all turns of a multi-turn attack share one trace. */
  attackTraceId?: string;
  runId?: string;
  attackIndex?: number;
  /**
   * Prior turns of this attack. Consumed by stateless-mode HTTP targets to
   * build the `messages` array; ignored by stateful targets and by the local
   * script / DOM targets.
   */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Invoked with a session id read from the response, for the caller to echo on later turns. */
  captureSession?: (id: string) => void;
}

export interface AgentTarget {
  send(prompt: string, options?: AgentSendOptions): Promise<string>;
  close(): Promise<void>;
}

/**
 * Create a target that sends prompts to an HTTP endpoint or local script.
 * Returns the response text (or an ERROR:/RATE_LIMITED sentinel on failure).
 */
export function createAgentTarget(config: AgentTargetConfig): AgentTarget {
  if (config.type === "local-script") {
    return createLocalScriptTarget(config);
  }
  return createHttpTarget(config);
}

function createLocalScriptTarget(config: AgentTargetConfig): AgentTarget {
  return {
    async send(prompt: string, options?: AgentSendOptions): Promise<string> {
      if (!config.scriptPath) return "ERROR: scriptPath not configured";
      return invokeLocalTargetScript(config.scriptPath, {
        prompt,
        sessionId: options?.sessionId,
      });
    },
    async close() {},
  };
}

function createHttpTarget(config: AgentTargetConfig): AgentTarget {
  return {
    async send(prompt: string, options?: AgentSendOptions): Promise<string> {
      if (!config.endpoint) return "ERROR: endpoint not configured";
      return callHttp(config, prompt, options);
    },
    async close() {},
  };
}

async function callHttp(
  config: AgentTargetConfig,
  prompt: string,
  options?: AgentSendOptions
): Promise<string> {
  const resolvedApiKey =
    (config.apiKeyEnv ? getEnv(config.apiKeyEnv) : undefined) ||
    getEnv("TARGET_API_KEY") ||
    getEnv("OPENAI_API_KEY") ||
    getEnv("LLM_API_KEY");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (resolvedApiKey) headers["Authorization"] = `Bearer ${resolvedApiKey}`;
  if (config.headers) Object.assign(headers, config.headers);

  const prop = options?.propagation;
  const hasPropagation =
    Boolean(prop?.headers && Object.keys(prop.headers).length > 0) ||
    Boolean(prop?.traceIdBodyField?.trim());

  let propagationTraceId: string | undefined;
  if (hasPropagation && prop) {
    const strategy = prop.traceIdStrategy ?? "per-attack";
    const otelHex =
      options?.attackTraceId ??
      (strategy === "per-run" && options?.runTraceOtel ? options.runTraceOtel : newOtelTraceId());
    propagationTraceId = otelHex;
    const extra = buildPropagatedHeaders(prop, {
      otelTraceHex: otelHex,
      runId: options?.runId ?? "",
      attackIndex: options?.attackIndex ?? 0,
    });
    Object.assign(headers, extra);
  }

  const getByPath = (obj: unknown, dotPath: string): unknown =>
    dotPath.split(".").reduce<unknown>((cur, key) => {
      if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
      return (cur as Record<string, unknown>)[key];
    }, obj);

  const setByPath = (obj: Record<string, unknown>, dotPath: string, value: unknown): void => {
    const keys = dotPath.split(".");
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== "object") cur[keys[i]] = {};
      cur = cur[keys[i]] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]] = value;
  };

  const extract = (raw: string): string => {
    try {
      const j = JSON.parse(raw);
      if (config.responsePath?.trim()) {
        const found = getByPath(j, config.responsePath.trim());
        return found !== undefined ? String(found) : raw;
      }
      return String(
        j?.choices?.[0]?.message?.content ??
          j?.response ??
          j?.output ??
          j?.text ??
          j?.message ??
          raw
      );
    } catch {
      return raw;
    }
  };

  const targetFormat = config.requestFormat ?? "auto";
  const targetModel = config.model ?? "gpt-4o-mini";
  const sessionId = options?.sessionId;
  // Stateless targets receive the full conversation as a `messages` array on
  // every turn (raw OpenAI/Groq/Anthropic-compat endpoints). The body shape
  // is fixed by the chat-completions spec, so this mode overrides
  // requestFormat and carries no session id.
  const isStateless = config.stateful === false;
  const conversationHistory = options?.history ?? [];
  // `sessionId` is the id to send this turn (undefined on turn 1 in server mode).
  const sessionPlan = resolveSessionPlan(config);

  const finishResponse = (res: Response, rawText: string): string => {
    const captured = captureSessionFromResponse(rawText, res.headers, sessionPlan);
    if (captured && options?.captureSession) options.captureSession(captured);
    return extract(rawText);
  };

  const buildJsonBody = (promptValue: string): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    setByPath(body, config.promptPath?.trim() || "prompt", promptValue);
    applySessionToRequest(body, headers, sessionPlan, sessionId);
    return body;
  };

  try {
    const useJson = targetFormat === "json" && !isStateless;

    if (!useJson) {
      const openaiMessages: { role: "user" | "assistant"; content: string }[] = isStateless
        ? [...conversationHistory, { role: "user", content: prompt }]
        : [{ role: "user", content: prompt }];
      const openaiBody: Record<string, unknown> = {
        model: targetModel,
        messages: openaiMessages,
        temperature: 0.7,
        max_tokens: 500,
      };
      applySessionToRequest(openaiBody, headers, sessionPlan, sessionId);
      if (hasPropagation && prop?.traceIdBodyField && propagationTraceId) {
        mergeTraceIdIntoJsonBody(openaiBody, prop.traceIdBodyField, propagationTraceId);
      }
      const res = await fetch(config.endpoint!, {
        method: "POST",
        headers,
        body: JSON.stringify(openaiBody),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 5000));
        return RATE_LIMITED_SENTINEL;
      }
      if (!res.ok) {
        // Non-retryable status (4xx except 429) - stop the run
        if (!isRetryableStatus(res.status)) {
          throw new TargetStopError(`Target returned HTTP ${res.status}`);
        }
        // Retryable (5xx) - return error but continue
        return `ERROR: HTTP ${res.status}`;
      }
      if (res.ok || targetFormat === "openai" || isStateless)
        return finishResponse(res, await res.text());
    }

    const jsonBody = buildJsonBody(prompt);
    if (hasPropagation && prop?.traceIdBodyField && propagationTraceId) {
      mergeTraceIdIntoJsonBody(jsonBody, prop.traceIdBodyField, propagationTraceId);
    }
    const res2 = await fetch(config.endpoint!, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonBody),
      signal: AbortSignal.timeout(30_000),
    });
    if (res2.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      return RATE_LIMITED_SENTINEL;
    }
    if (!res2.ok) {
      // Non-retryable status (4xx except 429) - stop the run
      if (!isRetryableStatus(res2.status)) {
        throw new TargetStopError(`Target returned HTTP ${res2.status}`);
      }
      // Retryable (5xx) - return error but continue
      return `ERROR: HTTP ${res2.status}`;
    }
    return finishResponse(res2, await res2.text());
  } catch (err: unknown) {
    // Re-throw TargetStopError
    if (err instanceof TargetStopError) throw err;

    const msg = err instanceof Error ? err.message : String(err);
    // Check if this is a non-retryable network error
    if (isNonRetryableError(msg)) {
      throw new TargetStopError(`Target unreachable: ${msg}`);
    }
    // Retryable errors (timeout, etc.) - return error but continue
    return `ERROR: ${msg}`;
  }
}
