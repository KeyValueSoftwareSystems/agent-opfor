/**
 * Shared HTTP target client primitives.
 * Used by both the core agent target and the autonomous runner.
 */

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
  model?: string;
}

export interface HttpSendResult {
  response: string;
  isError: boolean;
  rateLimited: boolean;
  errorMessage?: string;
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

/** Build the request body for a custom-JSON target. */
export function buildCustomJsonBody(
  prompt: string,
  promptPath: string,
  sessionId?: string,
  sessionField?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  setByPath(body, promptPath || "prompt", prompt);
  if (sessionId && sessionField?.trim()) {
    body[sessionField.trim()] = sessionId;
  }
  return body;
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
  if (config.headers) Object.assign(headers, config.headers);
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
    body = buildCustomJsonBody(
      prompt,
      config.promptPath ?? "prompt",
      options.sessionId,
      config.sessionField
    );
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

    return {
      response: extractReply(text, config.responsePath),
      isError: false,
      rateLimited: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { response: "", isError: true, rateLimited: false, errorMessage: message };
  }
}
