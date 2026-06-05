import { test } from "node:test";
import assert from "node:assert/strict";
import { createTargetClient } from "../src/target/http.js";
import type { TargetConfig } from "../src/lib/types.js";

type CapturedRequest = { url: string; init: RequestInit };

function stubFetch(responseBody: unknown): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { captured, restore: () => (globalThis.fetch = original) };
}

test("stateless mode sends an OpenAI-shape messages array with history", async () => {
  const { captured, restore } = stubFetch({ choices: [{ message: { content: "hi there" } }] });
  try {
    const config: TargetConfig = {
      name: "t",
      endpoint: "http://localhost/v1/chat",
      mode: "stateless",
      apiKey: "secret",
    };
    const client = createTargetClient(config);
    const result = await client.send("second prompt", {
      threadId: "atk-1",
      history: [
        { role: "user", content: "first prompt" },
        { role: "assistant", content: "first reply" },
      ],
    });
    assert.equal(result.response, "hi there");
    assert.equal(result.isError, false);

    const body = JSON.parse(captured[0].init.body as string);
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.messages.length, 3, "history + new prompt");
    assert.equal(body.messages[2].content, "second prompt");
    const headers = captured[0].init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer secret");
  } finally {
    restore();
  }
});

test("stateful mode sends only the latest prompt + session id", async () => {
  const { captured, restore } = stubFetch({ response: "ok" });
  try {
    const config: TargetConfig = {
      name: "t",
      endpoint: "http://localhost/chat",
      mode: "stateful",
      promptPath: "prompt",
      sessionField: "session_id",
      responsePath: "response",
    };
    const client = createTargetClient(config);
    const result = await client.send("hello", {
      threadId: "atk-9",
      history: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "earlier reply" },
      ],
    });
    assert.equal(result.response, "ok");

    const body = JSON.parse(captured[0].init.body as string);
    assert.equal(body.prompt, "hello", "only latest prompt sent");
    assert.equal(body.session_id, "atk-9", "session id threaded");
    assert.equal(body.messages, undefined, "no messages array in stateful mode");
  } finally {
    restore();
  }
});

test("HTTP 429 surfaces rateLimited", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
  try {
    const client = createTargetClient({
      name: "t",
      endpoint: "http://localhost/chat",
      mode: "stateless",
    });
    const result = await client.send("x", { threadId: "t1", history: [] });
    assert.equal(result.rateLimited, true);
    assert.equal(result.isError, false);
  } finally {
    globalThis.fetch = original;
  }
});
