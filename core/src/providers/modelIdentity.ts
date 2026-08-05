/**
 * Model identity registry — maps a built AI SDK model back to the opfor
 * provider/model pair it was created from.
 *
 * Why this exists: {@link createModel} returns an opaque AI SDK object whose own
 * `provider` field is SDK-flavored and lossy — `openai-compatible` surfaces as
 * `"custom.chat"`, `anthropic` as `"anthropic.messages"`. Token-usage
 * attribution (and, later, cost lookup) needs the provider name the *user*
 * configured, because that is what the price tables are keyed against.
 *
 * Registering identity at creation time means every downstream recording site
 * can attribute usage from the model object it already holds, instead of
 * threading `LlmConfig` through a dozen call signatures.
 */

import type { LanguageModel } from "ai";
import type { LlmConfig } from "../config/types.js";

/** The opfor-side identity of one model: provider name + model string, as configured. */
export interface ModelIdentity {
  /** opfor provider name, e.g. `"anthropic"` or `"openai-compatible"`. */
  provider: string;
  /** Model string exactly as the user configured it, e.g. `"deepseek/deepseek-v4-pro"`. */
  model: string;
}

/** Bucket key for usage that could not be attributed to any model. */
export const UNKNOWN_MODEL_KEY = "unknown";

/** Stable map/display key for one identity. */
export function modelKey(identity: ModelIdentity): string {
  return `${identity.provider}:${identity.model}`;
}

// WeakMap so registering a model never keeps it alive. Keyed by the model object
// itself; `createModel` is the single factory for every path (CLI, SDK, MCP
// runner, browser extension), so one registration point covers all of them.
const registry = new WeakMap<object, ModelIdentity>();

/** Record which provider/model a built AI SDK model came from. Called by `createModel`. */
export function rememberModelIdentity(model: LanguageModel, llm: LlmConfig): void {
  if (model && typeof model === "object") {
    registry.set(model, { provider: llm.provider, model: llm.model });
  }
}

/** Anything a call site might have on hand when recording token usage. */
export type ModelRef = LanguageModel | LlmConfig | ModelIdentity;

/** Shape test for the `{ provider, model }` pair shared by LlmConfig and ModelIdentity. */
function isIdentityLike(value: object): value is ModelIdentity {
  const v = value as Partial<ModelIdentity>;
  return typeof v.provider === "string" && typeof v.model === "string";
}

/** Shape test for a built AI SDK language model. */
function isLanguageModelObject(value: object): value is { modelId: string; provider?: string } {
  return typeof (value as { modelId?: unknown }).modelId === "string";
}

/**
 * Resolve any model reference to an identity.
 *
 * Prefers the registry (exact configured provider + model). Falls back to the AI
 * SDK object's own fields, narrowing `"anthropic.messages"` to `"anthropic"` —
 * lossy for `openai-compatible` (reports `"custom"`), which is why the registry
 * is consulted first. Returns undefined when nothing identifying is available,
 * so callers can bucket the usage as unattributed rather than guess.
 */
export function resolveModelIdentity(ref?: ModelRef): ModelIdentity | undefined {
  if (!ref) return undefined;

  // `ai` allows a bare model string; there is no provider to recover from it.
  if (typeof ref === "string") return { provider: "unknown", model: ref };
  if (typeof ref !== "object") return undefined;

  const registered = registry.get(ref);
  if (registered) return registered;

  if (isLanguageModelObject(ref)) {
    const sdkProvider = typeof ref.provider === "string" ? ref.provider.split(".")[0] : "unknown";
    return { provider: sdkProvider || "unknown", model: ref.modelId };
  }

  if (isIdentityLike(ref)) return { provider: ref.provider, model: ref.model };

  return undefined;
}
