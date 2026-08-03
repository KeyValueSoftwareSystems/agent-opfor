import {
  createModel,
  generateJsonObject,
  PROVIDERS,
  PROVIDER_ENV_VARS,
  setEnvProvider,
} from "./dist/core.bundle.js";
import { state } from "./state.js";
import { dbg } from "./debugLog.js";

// 0 for determinism, except gpt-5 (LiteLLM/OpenAI reject 0) and Anthropic (left unset).
function providerTemperature(provider, model) {
  if (provider === PROVIDERS.ANTHROPIC) return undefined;
  if (/gpt-5/i.test(String(model || ""))) return 1;
  return 0;
}

/** Calls a provider/model and returns the parsed JSON response — same dispatch orchestrator.js uses for the attacker/judge models. */
export async function callLlm({ provider, baseUrl, apiKey, model, messages, signal: signalOpt }) {
  const signal = signalOpt ?? state.uiRunAbortController?.signal;
  const envVar = PROVIDER_ENV_VARS[provider] ?? "OPFOR_API_KEY";
  setEnvProvider((name) => (name === envVar ? apiKey : undefined));
  const llmModel = createModel({
    provider,
    model,
    apiKeyEnv: envVar,
    baseURL: baseUrl || undefined,
  });
  const systemRole = messages?.find((m) => m.role === "system")?.content || "";
  dbg("llm-call", `${provider}/${model}`, {
    provider,
    model,
    messageCount: messages?.length,
    systemPromptPreview: systemRole.slice(0, 150),
    userPromptLen: messages?.find((m) => m.role === "user")?.content?.length,
  });
  try {
    const result = await generateJsonObject(llmModel, messages, {
      abortSignal: signal,
      temperature: providerTemperature(provider, model),
    });
    dbg("llm-call", `${provider}/${model} -> OK`, {
      resultKeys: result ? Object.keys(result) : null,
    });
    return result;
  } catch (e) {
    dbg("llm-call", `${provider}/${model} -> ERROR`, {
      error: e instanceof Error ? e.message : String(e),
      name: e?.name,
    });
    if (e?.name === "AbortError" || state.OPFOR_STOP) throw new Error("Run stopped.", { cause: e });
    throw e;
  }
}
