import { test } from "node:test";
import assert from "node:assert/strict";
import { startUiServer } from "../src/ui/server.js";

/**
 * Regression: `opfor hunt --ui` used to ignore Ctrl+C until the dashboard tab was
 * reloaded or closed. `server.close()` waits for every open connection to end, and
 * the /api/events SSE response never ends on its own — so the close callback could
 * not fire while a browser was watching. Shutdown now tears the streams down first.
 */
test("close() resolves while a dashboard SSE client is still connected", async () => {
  const handle = await startUiServer({
    port: 0, // let the OS pick, so parallel runs never collide
    meta: { objective: "test", targetName: "test" },
    openBrowser: false,
  });

  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${handle.port}/api/events`, {
    signal: ac.signal,
    headers: { accept: "text/event-stream" },
  });
  assert.equal(res.status, 200);

  // Read the first payload so the client is registered server-side before we close.
  const reader = res.body!.getReader();
  await reader.read();

  let timer: NodeJS.Timeout | undefined;
  const hangGuard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("close() did not resolve with a live SSE client — shutdown hangs")),
      5000
    );
  });

  try {
    await Promise.race([handle.close(), hangGuard]);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    ac.abort();
  }
});
