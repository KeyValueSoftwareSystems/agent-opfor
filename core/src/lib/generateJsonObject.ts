import { generateObject } from "ai";
import type { LanguageModel } from "ai";

export interface JsonLlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Call a language model and return the response as a parsed JSON object.
 * Uses the AI SDK's generateObject with output:'no-schema' so the caller
 * does not need to supply a Zod schema. The SDK handles provider differences
 * (JSON mode for OpenAI, prompt-engineering for Anthropic, etc.).
 */
export async function generateJsonObject(
  model: LanguageModel,
  messages: JsonLlmMessage[],
  options?: { abortSignal?: AbortSignal }
): Promise<Record<string, unknown>> {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const conversationMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const { object } = await generateObject({
    model,
    output: "no-schema",
    ...(systemMsg ? { system: systemMsg } : {}),
    messages: conversationMessages,
    ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });

  return object as Record<string, unknown>;
}
