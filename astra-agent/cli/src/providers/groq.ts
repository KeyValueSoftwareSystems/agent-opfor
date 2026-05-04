import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    apiKey,
    baseURL: "https://api.groq.com/openai/v1"
  });
}
