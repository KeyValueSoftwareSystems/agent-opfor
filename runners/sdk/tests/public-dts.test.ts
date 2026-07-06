/**
 * Guards the published declaration file against leaking the private core package.
 *
 * Run after build: npm run build -w runners/sdk && npm test -w runners/sdk
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dtsPath = path.join(pkgRoot, "dist", "index.d.ts");

test("dist/index.d.ts does not reference unpublished @keyvaluesystems/agent-opfor-core", () => {
  assert.ok(
    existsSync(dtsPath),
    `missing ${dtsPath} — run "npm run build -w runners/sdk" before this test`
  );

  const dts = readFileSync(dtsPath, "utf8");
  assert.doesNotMatch(
    dts,
    /@keyvaluesystems\/agent-opfor-core/,
    "published .d.ts must not import from the private core package"
  );
});
