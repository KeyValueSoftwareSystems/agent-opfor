import type { LlmConfig } from "../config/schema.js";
import { PROVIDERS } from "../config/types.js";
import { getEnv } from "../lib/env.js";

function resolveApiKey(model: LlmConfig): string | undefined {
  if (model.apiKeyEnv) {
    const v = getEnv(model.apiKeyEnv);
    return v && v.trim() ? v.trim() : undefined;
  }
  return undefined;
}

function chatCompletionsUrl(model: LlmConfig): string {
  if (model.provider === PROVIDERS.OPENAI_COMPATIBLE) {
    if (!model.baseURL)
      throw new Error(
        `models.*.provider "${PROVIDERS.OPENAI_COMPATIBLE}" requires baseURL in config`
      );
    const base = model.baseURL.replace(/\/$/, "");
    return `${base}/chat/completions`;
  }
  if (model.provider === PROVIDERS.GROQ) return "https://api.groq.com/openai/v1/chat/completions";
  if (model.provider === PROVIDERS.OPENAI) return "https://api.openai.com/v1/chat/completions";
  throw new Error(
    `LLM provider "${model.provider}" is not yet supported. Use ${PROVIDERS.OPENAI}, ${PROVIDERS.GROQ}, or ${PROVIDERS.OPENAI_COMPATIBLE}.`
  );
}

/**
 * Extract JSON from a raw LLM response.
 * Handles three cases:
 *  1. Response is already a bare JSON object/array.
 *  2. Response wraps JSON in a markdown code fence (```json ... ``` or ``` ... ```).
 *  3. Response contains a JSON object/array somewhere in the text (last-resort scan).
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Case 1 — bare JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  // Case 2 — markdown code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Case 3 — find the first { ... } block in the text
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return trimmed.slice(braceStart, braceEnd + 1);
  }

  throw new Error("LLM response contained no JSON object");
}

export async function chatCompletionJsonContent(args: {
  model: LlmConfig;
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = resolveApiKey(args.model);
  if (!apiKey) {
    throw new Error(
      args.model.apiKeyEnv
        ? `Missing API key env var: ${args.model.apiKeyEnv}`
        : "Missing API key: set apiKeyEnv in opfor.config.json (mcp.models)"
    );
  }

  const url = chatCompletionsUrl(args.model);

  // Try with json_object response format first.
  // Some providers (e.g. OpenRouter free models) silently ignore it or return an error,
  // so we fall back to plain text + manual JSON extraction.
  let useJsonMode = true;
  let useTemperature = true;

  const makeBody = (opts: { jsonMode: boolean; temperature: boolean }) =>
    JSON.stringify({
      model: args.model.model,
      ...(opts.temperature ? { temperature: 1 } : {}),
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    });

  const doFetch = () =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: makeBody({ jsonMode: useJsonMode, temperature: useTemperature }),
    });

  let res = await doFetch();

  // 400 often means unsupported params — strip json_object and/or temperature and retry.
  if (!res.ok && res.status === 400) {
    if (useJsonMode) {
      useJsonMode = false;
      res = await doFetch();
    }
    if (!res.ok && res.status === 400 && useTemperature) {
      useTemperature = false;
      res = await doFetch();
    }
  }

  // 429 rate limit — retry with exponential backoff (up to 3 attempts).
  if (res.status === 429) {
    const delays = [3000, 8000, 20000];
    for (const delay of delays) {
      const retryAfterHeader = res.headers.get("retry-after");
      const waitMs = retryAfterHeader ? parseInt(retryAfterHeader) * 1000 : delay;
      await new Promise((r) => setTimeout(r, waitMs));
      res = await doFetch();
      if (res.status !== 429) break;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned empty content");
  }

  return extractJson(content);
}
