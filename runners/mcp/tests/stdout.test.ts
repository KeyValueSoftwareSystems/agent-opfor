/**
 * The stdio transport uses stdout for JSON-RPC only. Loading a `.env` file must
 * not write anything else to it (dotenv v17 prints a banner unless `quiet` is set).
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

function initialize(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no initialize response, stdout so far: ${JSON.stringify(out)}`));
    }, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes('"id":1')) {
        clearTimeout(timer);
        child.kill();
        resolve(out);
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

test(
  "stdout carries only JSON-RPC when a .env file is present",
  { skip: !existsSync(entry) },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "opfor-mcp-env-"));
    try {
      writeFileSync(path.join(dir, ".env"), "OPFOR_TEST_VALUE=1\n", "utf8");
      const out = await initialize(dir);
      const lines = out.split("\n").filter((l) => l.trim().length > 0);
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
  }
);
