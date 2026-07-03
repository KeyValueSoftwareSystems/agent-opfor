import {
  createModel,
  generateJsonObject,
  PROVIDERS,
  PROVIDER_ENV_VARS,
  setEnvProvider,
} from "./dist/core.bundle.js";
import { state } from "./state.js";

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
  try {
    return await generateJsonObject(llmModel, messages, {
      abortSignal: signal,
      temperature: providerTemperature(provider, model),
    });
  } catch (e) {
    if (e?.name === "AbortError" || state.OPFOR_STOP) throw new Error("Run stopped.", { cause: e });
    throw e;
  }
}
