// Standalone HTTP client for the target agent under test.
// No @opfor/core dependency — plain fetch with Bearer auth, two conversation
// modes, 429 backoff, and error sentinels.

import type { TargetConfig } from "../lib/types.js";

export interface TargetMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TargetSendOptions {
  /** Stable id for this conversation thread (used as session id in stateful mode). */
  threadId: string;
  /** Prior turns of this thread (replayed in stateless mode; ignored in stateful mode). */
  history: TargetMessage[];
}

export interface TargetSendResult {
  /** Extracted reply text (empty string on error). */
  response: string;
  /** True when the request failed (network/HTTP error). */
  isError: boolean;
  /** True when the target returned HTTP 429 (we already backed off). */
  rateLimited: boolean;
  /** Human-readable error detail when isError/rateLimited. */
  errorMessage?: string;
}

export interface TargetClient {
  send(prompt: string, options: TargetSendOptions): Promise<TargetSendResult>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;

/** Read a value from a nested object by dot-path (e.g. "choices.0.message.content"). */
function getByPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

/** Write a value into a nested object by dot-path, creating intermediate objects. */
function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** Best-effort extraction of the assistant reply from an arbitrary JSON body. */
function extractReply(raw: string, config: TargetConfig): string {
  try {
    const json = JSON.parse(raw) as unknown;
    if (config.responsePath?.trim()) {
      const found = getByPath(json, config.responsePath.trim());
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

/** Build the request body for the target's expected shape. */
function buildBody(
  prompt: string,
  options: TargetSendOptions,
  config: TargetConfig
): Record<string, unknown> {
  // Stateless: full OpenAI-shape messages array (the canonical raw-LLM shape).
  if (config.mode === "stateless") {
    if (config.promptPath?.trim()) {
      // Custom-JSON stateless: caller wants a single prompt field. We still
      // prepend prior turns into a transcript string so context is preserved.
      const body: Record<string, unknown> = {};
      const transcript = [
        ...options.history.map((m) => `${m.role}: ${m.content}`),
        `user: ${prompt}`,
      ].join("\n");
      setByPath(body, config.promptPath.trim(), transcript);
      return body;
    }
    return {
      model: config.targetModel ?? "gpt-4o-mini",
      messages: [...options.history, { role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
    };
  }

  // Stateful: send only the latest prompt + a session id.
  const body: Record<string, unknown> = {};
  setByPath(body, config.promptPath?.trim() || "prompt", prompt);
  if (config.sessionField?.trim()) {
    body[config.sessionField.trim()] = options.threadId;
  }
  return body;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Create an HTTP client bound to a target configuration. */
export function createTargetClient(config: TargetConfig): TargetClient {
  return {
    async send(prompt: string, options: TargetSendOptions): Promise<TargetSendResult> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
      if (config.headers) Object.assign(headers, config.headers);

      const body = buildBody(prompt, options, config);

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
            errorMessage: "target returned HTTP 429 (rate limited)",
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

        return { response: extractReply(text, config), isError: false, rateLimited: false };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { response: "", isError: true, rateLimited: false, errorMessage: message };
      }
    },
  };
}
