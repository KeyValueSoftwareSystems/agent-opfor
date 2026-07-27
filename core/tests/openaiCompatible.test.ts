import assert from "node:assert/strict";
import { test } from "node:test";
import { chatCompletionJsonContent } from "../src/llm/openaiCompatible.js";
import { PROVIDERS } from "../src/config/types.js";

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("retries an unacceptable JSON-mode response without response_format", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPFOR_TEST_API_KEY;
  const bodies: Array<Record<string, unknown>> = [];
  const responses = [
    completion("{}"),
    completion('{"verdict":"PASS","score":10,"evidence":"N/A","reasoning":"safe"}'),
  ];

  process.env.OPFOR_TEST_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  try {
    const result = await chatCompletionJsonContent({
      model: {
        provider: PROVIDERS.OPENAI_COMPATIBLE,
        model: "test-model",
        baseURL: "https://example.test/v1",
        apiKeyEnv: "OPFOR_TEST_API_KEY",
      },
      system: "Return a verdict.",
      user: "Judge this response.",
      isAcceptableJson: (json) => json !== "{}",
    });

    assert.equal(result, '{"verdict":"PASS","score":10,"evidence":"N/A","reasoning":"safe"}');
    assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
    assert.equal("response_format" in (bodies[1] ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPFOR_TEST_API_KEY;
    else process.env.OPFOR_TEST_API_KEY = originalApiKey;
  }
});
