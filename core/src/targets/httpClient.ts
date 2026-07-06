/**
 * Shared HTTP target client primitives.
 * Used by both the core agent target and the autonomous runner.
 */

import type { SessionConfig } from "../execute/types.js";
import { expandEnvInHeaders } from "../lib/env.js";

export const REQUEST_TIMEOUT_MS = 30_000;
export const RATE_LIMIT_BACKOFF_MS = 5_000;

export interface HttpTargetMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HttpTargetConfig {
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
  mode: "stateless" | "stateful";
  promptPath?: string;
  responsePath?: string;
  sessionField?: string;
  session?: SessionConfig;
  model?: string;
}

export interface HttpSendResult {
  response: string;
  isError: boolean;
  rateLimited: boolean;
  errorMessage?: string;
  /** Session id read from the response (server-owned targets only). */
  sessionId?: string;
}

/** Read a value from a nested object by dot-path (e.g. "choices.0.message.content"). */
export function getByPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

/** Write a value into a nested object by dot-path, creating intermediate objects. */
export function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** Best-effort extraction of the assistant reply from an arbitrary JSON body. */
export function extractReply(raw: string, responsePath?: string): string {
  try {
    const json = JSON.parse(raw) as unknown;
    if (responsePath?.trim()) {
      const found = getByPath(json, responsePath.trim());
      return found !== undefined ? String(found) : raw;
    }
    const j = json as {
      choices?: Array<{ message?: { content?: unknown } }>;
      response?: unknown;
      output?: unknown;
      text?: unknown;
      message?: unknown;
      reply?: unknown;
    };
    return String(
      j?.choices?.[0]?.message?.content ??
        j?.response ??
        j?.output ??
        j?.text ??
        j?.message ??
        j?.reply ??
        raw
    );
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Session id handling. See core/src/execute/types.ts SessionConfig.
// ---------------------------------------------------------------------------

/**
 * How a session id flows for a target.
 * - `none`: no session id (stateless, or nothing configured).
 * - `client`: id is minted locally and sent every turn.
 * - `server`: turn 1 sends no id; the returned id is captured and echoed.
 */
export interface SessionPlan {
  mode: "none" | "client" | "server";
  send?: { in: "body" | "header"; name: string };
  receive?: { in: "body" | "header" | "set-cookie"; name?: string };
}

/** Input to {@link resolveSessionPlan}; covers both the run and autonomous config shapes. */
export interface SessionPlanSource {
  session?: SessionConfig;
  /** Legacy body-field alias (run path). */
  sessionIdField?: string;
  /** Legacy body-field alias (autonomous runner). */
  sessionField?: string;
  stateful?: boolean;
  mode?: "stateless" | "stateful";
}

/** Fold a target config into a {@link SessionPlan}; stateless targets resolve to `none`. */
export function resolveSessionPlan(source: SessionPlanSource): SessionPlan {
  const isStateless = source.stateful === false || source.mode === "stateless";
  if (isStateless) return { mode: "none" };

  const legacyName = source.sessionIdField?.trim() || source.sessionField?.trim();
  const send =
    source.session?.send ?? (legacyName ? { in: "body" as const, name: legacyName } : undefined);
  const receive = source.session?.receive;

  const mode = receive ? "server" : send ? "client" : "none";
  return { mode, send, receive };
}

/** Write the session id into a request per `plan.send`; the value overrides any static header. */
export function applySessionToRequest(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  plan: SessionPlan,
  sessionId: string | undefined
): void {
  if (!sessionId || !plan.send) return;
  if (plan.send.in === "header") {
    headers[plan.send.name] = sessionId;
  } else {
    setByPath(body, plan.send.name, sessionId);
  }
}

/** Extract `name=value` (dropping attributes) for a given cookie, or the first cookie. */
function parseCookie(setCookie: string, name?: string): string | undefined {
  const pairs = setCookie
    .split(/,(?=[^;]+=)/) // split multiple Set-Cookie values folded into one header
    .map((c) => c.split(";", 1)[0].trim())
    .filter(Boolean);
  if (!pairs.length) return undefined;
  if (name?.trim()) {
    const match = pairs.find((p) => p.slice(0, p.indexOf("=")).trim() === name.trim());
    return match || undefined;
  }
  return pairs[0];
}

/**
 * Read a server-returned session id per `plan.receive`, or undefined if absent.
 * For `set-cookie` the value is the full `name=value` pair, ready to echo as a `Cookie` header.
 */
export function captureSessionFromResponse(
  rawBody: string,
  resHeaders: Headers,
  plan: SessionPlan
): string | undefined {
  const rx = plan.receive;
  if (!rx) return undefined;

  if (rx.in === "header") {
    return rx.name ? (resHeaders.get(rx.name) ?? undefined) || undefined : undefined;
  }
  if (rx.in === "set-cookie") {
    const raw =
      (typeof resHeaders.getSetCookie === "function"
        ? resHeaders.getSetCookie().join(", ")
        : undefined) ?? resHeaders.get("set-cookie");
    return raw ? parseCookie(raw, rx.name) : undefined;
  }
  // body dot-path
  if (!rx.name?.trim()) return undefined;
  try {
    const found = getByPath(JSON.parse(rawBody), rx.name.trim());
    return found !== undefined && found !== null ? String(found) : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Build the request body for an OpenAI-shape stateless target. */
export function buildStatelessBody(
  prompt: string,
  history: HttpTargetMessage[],
  targetModel: string
): Record<string, unknown> {
  return {
    model: targetModel,
    messages: [...history, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 800,
  };
}

/**
 * Generic HTTP send to a target endpoint.
 * Handles auth, timeout, 429 backoff, and response extraction.
 */
export async function httpSend(
  config: HttpTargetConfig,
  prompt: string,
  options: {
    history?: HttpTargetMessage[];
    sessionId?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<HttpSendResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  if (config.headers) Object.assign(headers, expandEnvInHeaders(config.headers));
  if (options.extraHeaders) Object.assign(headers, options.extraHeaders);

  let body: Record<string, unknown>;

  if (config.mode === "stateless") {
    if (config.promptPath?.trim()) {
      body = {};
      const transcript = [
        ...(options.history ?? []).map((m) => `${m.role}: ${m.content}`),
        `user: ${prompt}`,
      ].join("\n");
      setByPath(body, config.promptPath.trim(), transcript);
    } else {
      body = buildStatelessBody(prompt, options.history ?? [], config.model ?? "gpt-4o-mini");
    }
  } else {
    body = {};
    setByPath(body, config.promptPath?.trim() || "prompt", prompt);
    applySessionToRequest(body, headers, resolveSessionPlan(config), options.sessionId);
  }

  try {
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 429) {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      return {
        response: "",
        isError: false,
        rateLimited: true,
        errorMessage: "HTTP 429 (rate limited)",
      };
    }

    const text = await res.text();
    if (!res.ok) {
      return {
        response: "",
        isError: true,
        rateLimited: false,
        errorMessage: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    }

    const captured = captureSessionFromResponse(text, res.headers, resolveSessionPlan(config));
    return {
      response: extractReply(text, config.responsePath),
      isError: false,
      rateLimited: false,
      sessionId: captured,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { response: "", isError: true, rateLimited: false, errorMessage: message };
  }
}
