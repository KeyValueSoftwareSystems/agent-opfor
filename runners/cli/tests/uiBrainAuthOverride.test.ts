import { test } from "node:test";
import assert from "node:assert/strict";
import { startUiServer } from "../src/ui/server.js";

/**
 * /api/start's brainAuthOverride lets the setup form supply a credential for this
 * run only, applied to process.env before the assessment starts (see server.ts).
 * These tests cover only the validation paths, which 400 before any assessment
 * — and therefore any outbound network call — begins. A test asserting the
 * override actually starts a run would need to either mock runAssessmentInProcess
 * or make a real network/API call, so that path is left to code review + the
 * resolveBrainAuth()/noBrainAuthMessage() unit tests, which cover the same logic
 * this handler calls.
 */

async function postStart(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("brainAuthOverride mode 'apiKey' with no key is rejected before a run starts", async () => {
  const handle = await startUiServer({
    port: 0,
    meta: {},
    setupMode: true,
    openBrowser: false,
  });
  try {
    const res = await postStart(handle.port, {
      endpoint: "https://example.com/chat",
      objective: "test",
      brainAuthOverride: { mode: "apiKey" },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /API key is required/);
  } finally {
    await handle.close();
  }
});

test("brainAuthOverride mode 'gateway' missing a field is rejected before a run starts", async () => {
  const handle = await startUiServer({
    port: 0,
    meta: {},
    setupMode: true,
    openBrowser: false,
  });
  try {
    const res = await postStart(handle.port, {
      endpoint: "https://example.com/chat",
      objective: "test",
      // baseUrl only — authToken is missing, which must be rejected same as the reverse.
      brainAuthOverride: { mode: "gateway", baseUrl: "https://gateway.example.com" },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Gateway base URL and auth token are both required/);
  } finally {
    await handle.close();
  }
});
