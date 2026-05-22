import { safeJsonParse } from "./utils.js";
import { state } from "./state.js";
import { PROVIDERS } from "./providers.js";

export async function callOpenAiCompat({ baseUrl, apiKey, model, messages, signal: signalOpt }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const signal = signalOpt ?? state.uiRunAbortController?.signal;
  const modelStr = String(model || "");
  // Some OpenAI-compatible routers (e.g. LiteLLM) reject temperature=0 for gpt-5 family.
  const temperature = /gpt-5/i.test(modelStr) ? 1 : 0;
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: "json_object" },
        messages,
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || state.OPFOR_STOP) throw new Error("Run stopped.", { cause: e });
    throw e;
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`LLM request failed (${resp.status}): ${text.slice(0, 500)}`);
  }
  const parsed = safeJsonParse(text);
  if (!parsed.ok) throw new Error(`LLM response not JSON: ${parsed.error}`);

  const content = parsed.value?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM response missing message.content");

  const contentParsed = safeJsonParse(content);
  if (!contentParsed.ok) throw new Error(`LLM message.content not JSON: ${contentParsed.error}`);
  return contentParsed.value;
}

export async function callAnthropic({ apiKey, model, messages, signal: signalOpt }) {
  const signal = signalOpt ?? state.uiRunAbortController?.signal;
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages.filter((m) => m.role !== "system");

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: userMessages,
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || state.OPFOR_STOP) throw new Error("Run stopped.", { cause: e });
    throw e;
  }

  const text = await resp.text();
  if (!resp.ok) throw new Error(`LLM request failed (${resp.status}): ${text.slice(0, 500)}`);

  const parsed = safeJsonParse(text);
  if (!parsed.ok) throw new Error(`LLM response not JSON: ${parsed.error}`);

  const content = parsed.value?.content?.[0]?.text;
  if (typeof content !== "string") throw new Error("LLM response missing content text");

  const contentParsed = safeJsonParse(content);
  if (!contentParsed.ok) throw new Error(`LLM message.content not JSON: ${contentParsed.error}`);
  return contentParsed.value;
}

export async function callGoogle({ apiKey, model, messages, signal: signalOpt }) {
  const signal = signalOpt ?? state.uiRunAbortController?.signal;
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages.filter((m) => m.role !== "system");

  const contents = userMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg }] } } : {}),
        contents,
        generationConfig: { temperature: 0 },
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || state.OPFOR_STOP) throw new Error("Run stopped.", { cause: e });
    throw e;
  }

  const text = await resp.text();
  if (!resp.ok) throw new Error(`LLM request failed (${resp.status}): ${text.slice(0, 500)}`);

  const parsed = safeJsonParse(text);
  if (!parsed.ok) throw new Error(`LLM response not JSON: ${parsed.error}`);

  const content = parsed.value?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== "string") throw new Error("LLM response missing content text");

  const contentParsed = safeJsonParse(content);
  if (!contentParsed.ok) throw new Error(`LLM message.content not JSON: ${contentParsed.error}`);
  return contentParsed.value;
}

/** Routes to the right provider implementation based on cfg.provider. */
export async function callLlm({ provider, baseUrl, apiKey, model, messages, signal }) {
  switch (provider) {
    case PROVIDERS.ANTHROPIC:
      return callAnthropic({ apiKey, model, messages, signal });
    case PROVIDERS.GOOGLE:
      return callGoogle({ apiKey, model, messages, signal });
    case PROVIDERS.DEEPSEEK:
      return callOpenAiCompat({
        baseUrl: "https://api.deepseek.com/v1",
        apiKey,
        model,
        messages,
        signal,
      });
    case PROVIDERS.AZURE:
      // baseUrl is the Azure resource name; construct the endpoint
      return callOpenAiCompat({
        baseUrl: `https://${baseUrl}.openai.azure.com/openai/deployments/${model}`,
        apiKey,
        model,
        messages,
        signal,
      });
    default:
      return callOpenAiCompat({
        baseUrl: baseUrl || "https://api.openai.com/v1",
        apiKey,
        model,
        messages,
        signal,
      });
  }
}
