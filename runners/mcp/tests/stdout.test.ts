/**
 * The stdio transport uses stdout for JSON-RPC only. Loading a `.env` file must
 * not write anything else to it (dotenv v17 prints a banner unless `quiet` is set,
 * and `DOTENV_CONFIG_DEBUG` / `DOTENV_CONFIG_QUIET` inside the `.env` re-enable it).
 *
 * Runs the built server (`npm run build -w runners/mcp`) from a directory that
 * contains a `.env`, sends `initialize`, and checks that every stdout line is a
 * JSON-RPC message.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

/** Returns every stdout line received up to and including the `initialize` response (id 1). */
function initialize(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const lines: string[] = [];
    let pending = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`no initialize response, stdout so far: ${JSON.stringify([...lines, pending])}`)
      );
    }, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim().length === 0) continue;
        lines.push(line);
        let id: unknown;
        try {
          id = (JSON.parse(line) as { id?: unknown }).id;
        } catch {
          continue; // not JSON: kept in `lines` so the caller's assertions report it
        }
        if (id === 1) {
          clearTimeout(timer);
          child.kill();
          resolve(lines);
          return;
        }
      }
    });
    child.on("error", reject);
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "stdout-test", version: "0" },
        },
      }) + "\n"
    );
  });
}

const cases: Array<[string, string]> = [
  ["a plain .env file", "OPFOR_TEST_VALUE=1\n"],
  ["DOTENV_CONFIG_DEBUG=true in .env", "OPFOR_TEST_VALUE=1\nDOTENV_CONFIG_DEBUG=true\n"],
  ["DOTENV_CONFIG_QUIET=false in .env", "OPFOR_TEST_VALUE=1\nDOTENV_CONFIG_QUIET=false\n"],
];

for (const [name, contents] of cases) {
  test(`stdout carries only JSON-RPC with ${name}`, { skip: !existsSync(entry) }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "opfor-mcp-env-"));
    try {
      writeFileSync(path.join(dir, ".env"), contents, "utf8");
      const lines = await initialize(dir);
      assert.ok(lines.length > 0, "expected at least one stdout line");
      for (const line of lines) {
        let msg: { jsonrpc?: string } | undefined;
        try {
          msg = JSON.parse(line) as { jsonrpc?: string };
        } catch {
          assert.fail(`non-JSON-RPC line on stdout: ${JSON.stringify(line)}`);
        }
        assert.equal(msg?.jsonrpc, "2.0", `not a JSON-RPC message: ${JSON.stringify(line)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
