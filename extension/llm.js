import { safeJsonParse } from "./utils.js";
import { state } from "./state.js";

export async function callOpenAiCompat({ baseUrl, apiKey, model, messages, signal: signalOpt }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const signal = signalOpt ?? state.uiRunAbortController?.signal;
  const modelStr = String(model || "");
  // Some OpenAI-compatible routers (e.g. LiteLLM) reject temperature=0 for gpt-5 family.
  const temperature = /^gpt-5/i.test(modelStr) ? 1 : 0;
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
