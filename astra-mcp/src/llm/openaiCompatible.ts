import type { ModelConfig } from "../config/schema.js";

function resolveApiKey(model: ModelConfig): string | undefined {
  if (model.apiKeyEnv) {
    const v = process.env[model.apiKeyEnv];
    return v && v.trim() ? v.trim() : undefined;
  }
  return undefined;
}

function chatCompletionsUrl(model: ModelConfig): string {
  if (model.provider === "other") {
    if (!model.baseURL) throw new Error('models.*.provider "other" requires baseURL in config');
    const base = model.baseURL.replace(/\/$/, "");
    return `${base}/chat/completions`;
  }
  if (model.provider === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  if (model.provider === "openai") return "https://api.openai.com/v1/chat/completions";
  throw new Error(
    `LLM provider "${model.provider}" is not yet supported. Use openai, groq, or other (OpenAI-compatible).`
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
  model: ModelConfig;
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = resolveApiKey(args.model);
  if (!apiKey) {
    throw new Error(
      args.model.apiKeyEnv
        ? `Missing API key env var: ${args.model.apiKeyEnv}`
        : "Missing API key: set apiKeyEnv in astra-mcp.config.json"
    );
  }

  const url = chatCompletionsUrl(args.model);

  // Try with json_object response format first.
  // Some providers (e.g. OpenRouter free models) silently ignore it or return an error,
  // so we fall back to plain text + manual JSON extraction.
  let useJsonMode = true;

  const makeBody = (jsonMode: boolean) =>
    JSON.stringify({
      model: args.model.model,
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    });

  const doFetch = (jsonMode: boolean) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: makeBody(jsonMode),
    });

  let res = await doFetch(useJsonMode);

  // 400 from OpenRouter/some hosts means json_object mode is unsupported — retry without it.
  if (!res.ok && res.status === 400 && useJsonMode) {
    useJsonMode = false;
    res = await doFetch(false);
  }

  // 429 rate limit — retry with exponential backoff (up to 3 attempts).
  if (res.status === 429) {
    const delays = [3000, 8000, 20000];
    for (const delay of delays) {
      const retryAfterHeader = res.headers.get("retry-after");
      const waitMs = retryAfterHeader ? parseInt(retryAfterHeader) * 1000 : delay;
      await new Promise((r) => setTimeout(r, waitMs));
      res = await doFetch(useJsonMode);
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
