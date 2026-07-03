import {
  createModel,
  generateJsonObject,
  PROVIDER_ENV_VARS,
  setEnvProvider,
} from "./dist/core.bundle.js";
import { state } from "./state.js";

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
    return await generateJsonObject(llmModel, messages, { abortSignal: signal });
  } catch (e) {
    if (e?.name === "AbortError" || state.OPFOR_STOP) throw new Error("Run stopped.", { cause: e });
    throw e;
  }
}
