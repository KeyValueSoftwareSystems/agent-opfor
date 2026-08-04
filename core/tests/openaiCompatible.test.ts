import assert from "node:assert/strict";
import { test } from "node:test";
import { chatCompletionJsonContent } from "../src/llm/openaiCompatible.js";
import { PROVIDERS } from "../src/config/types.js";
import { TokenTracker } from "../src/execute/tokenTracker.js";

const MODEL = {
  provider: PROVIDERS.OPENAI_COMPATIBLE,
  model: "test-model",
  baseURL: "https://example.test/v1",
  apiKeyEnv: "OPFOR_TEST_API_KEY",
} as const;

function completion(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textCompletion(content: unknown, usage?: unknown): Response {
  return completion({
    choices: [{ message: { content } }],
    ...(usage === undefined ? {} : { usage }),
  });
}

/**
 * Serve `responses` in order to one `chatCompletionJsonContent` call, capturing each
 * request body. Restores the real fetch and API-key env var afterwards.
 */
async function withStubbedFetch<T>(
  responses: Response[],
  run: (bodies: Array<Record<string, unknown>>) => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPFOR_TEST_API_KEY;
  const bodies: Array<Record<string, unknown>> = [];
  const queue = [...responses];

  process.env.OPFOR_TEST_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const response = queue.shift();
    assert.ok(response, "fetch called more times than the test queued responses");
    return response;
  }) as typeof fetch;

  try {
    return await run(bodies);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPFOR_TEST_API_KEY;
    else process.env.OPFOR_TEST_API_KEY = originalApiKey;
  }
}

const VERDICT = '{"verdict":"PASS","score":10,"evidence":"N/A","reasoning":"safe"}';

test("retries an unacceptable JSON-mode response without response_format", async () => {
  await withStubbedFetch([textCompletion("{}"), textCompletion(VERDICT)], async (bodies) => {
    const result = await chatCompletionJsonContent({
      model: MODEL,
      system: "Return a verdict.",
      user: "Judge this response.",
      isAcceptableJson: (json) => json !== "{}",
    });

    assert.equal(result, VERDICT);
    assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
    assert.equal("response_format" in (bodies[1] ?? {}), false);
  });
});

test("retries when a JSON-mode response carries prose instead of JSON", async () => {
  await withStubbedFetch(
    [textCompletion("I cannot help with that."), textCompletion(VERDICT)],
    async (bodies) => {
      const result = await chatCompletionJsonContent({
        model: MODEL,
        system: "Return a verdict.",
        user: "Judge this response.",
        isAcceptableJson: () => true,
      });

      assert.equal(result, VERDICT);
      assert.equal("response_format" in (bodies[1] ?? {}), false);
    }
  );
});

test("keeps the second response as terminal even when it is still unacceptable", async () => {
  await withStubbedFetch([textCompletion("{}"), textCompletion("{}")], async (bodies) => {
    const result = await chatCompletionJsonContent({
      model: MODEL,
      system: "Return a verdict.",
      user: "Judge this response.",
      isAcceptableJson: (json) => json !== "{}",
    });

    assert.equal(result, "{}");
    assert.equal(bodies.length, 2, "must not retry more than once");
  });
});

test("records token usage for the discarded attempt as well as the retry", async () => {
  const tracker = new TokenTracker();

  await withStubbedFetch(
    [
      textCompletion("{}", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
      textCompletion(VERDICT, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }),
    ],
    async () => {
      await chatCompletionJsonContent({
        model: MODEL,
        system: "Return a verdict.",
        user: "Judge this response.",
        isAcceptableJson: (json) => json !== "{}",
        tokenTracker: tracker,
      });
    }
  );

  assert.equal(tracker.totals.totalTokens, 26, "both billed attempts must be counted");
});

test("recovers the fallback request from a rate limit instead of failing the call", async () => {
  await withStubbedFetch(
    [
      textCompletion("{}"),
      new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      textCompletion(VERDICT),
    ],
    async (bodies) => {
      const result = await chatCompletionJsonContent({
        model: MODEL,
        system: "Return a verdict.",
        user: "Judge this response.",
        isAcceptableJson: (json) => json !== "{}",
      });

      assert.equal(result, VERDICT);
      assert.equal(bodies.length, 3);
    }
  );
});

test("returns content when the provider omits usage telemetry", async () => {
  for (const usage of [null, { prompt_tokens: null, completion_tokens: 4, total_tokens: null }]) {
    await withStubbedFetch([textCompletion(VERDICT, usage)], async () => {
      const result = await chatCompletionJsonContent({
        model: MODEL,
        system: "Return a verdict.",
        user: "Judge this response.",
        tokenTracker: new TokenTracker(),
      });
      assert.equal(result, VERDICT, `usage ${JSON.stringify(usage)} must not fail the call`);
    });
  }
});

test("treats null message content as empty rather than a schema violation", async () => {
  await withStubbedFetch([textCompletion(null)], async () => {
    await assert.rejects(
      chatCompletionJsonContent({
        model: MODEL,
        system: "Return JSON.",
        user: "Return JSON.",
      }),
      /LLM returned empty content/
    );
  });
});

test("rejects malformed provider responses with an actionable error", async () => {
  await withStubbedFetch([completion({ choices: [] })], async () => {
    await assert.rejects(
      chatCompletionJsonContent({
        model: MODEL,
        system: "Return JSON.",
        user: "Return JSON.",
      }),
      /invalid chat completion response.*Configure the provider/
    );
  });
});
