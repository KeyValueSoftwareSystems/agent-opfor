import { test } from "node:test";
import assert from "node:assert/strict";
import { startUiServer } from "../src/ui/server.js";

/**
 * The setup form uses /api/env-check to tell the user a bearer-token env var is
 * missing before the run starts, rather than surfacing it as a 401 mid-hunt.
 * It reports existence only — the value must never leave the process.
 */
test("/api/env-check reports existence without leaking the value", async () => {
  process.env.OPFOR_TEST_TOKEN_PRESENT = "super-secret-value";
  delete process.env.OPFOR_TEST_TOKEN_ABSENT;

  const handle = await startUiServer({
    port: 0,
    meta: { objective: "test", targetName: "test" },
    openBrowser: false,
  });
  const base = `http://127.0.0.1:${handle.port}/api/env-check`;

  try {
    const present = await fetch(`${base}?name=OPFOR_TEST_TOKEN_PRESENT`);
    const presentBody = await present.text();
    assert.equal(present.status, 200);
    assert.deepEqual(JSON.parse(presentBody), { set: true });
    assert.ok(
      !presentBody.includes("super-secret-value"),
      "response must not echo the env var value"
    );

    const absent = await fetch(`${base}?name=OPFOR_TEST_TOKEN_ABSENT`);
    assert.equal(absent.status, 200);
    assert.deepEqual(await absent.json(), { set: false });

    // An env var set to the empty string is not usable as a credential.
    process.env.OPFOR_TEST_TOKEN_BLANK = "";
    const blank = await fetch(`${base}?name=OPFOR_TEST_TOKEN_BLANK`);
    assert.deepEqual(await blank.json(), { set: false });

    const missingName = await fetch(base);
    assert.equal(missingName.status, 400);
  } finally {
    delete process.env.OPFOR_TEST_TOKEN_PRESENT;
    delete process.env.OPFOR_TEST_TOKEN_BLANK;
    await handle.close();
  }
});
