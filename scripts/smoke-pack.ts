/**
 * Packed-tarball smoke test.
 *
 * Builds the real npm tarball for @keyvaluesystems/agent-opfor-core (via `npm pack`, which runs
 * the package's prepack/postpack), installs it into a clean throwaway project
 * *outside* the monorepo, and exercises the runtime code paths that rely on
 * on-disk data files. This is the only check that catches "works in the
 * monorepo, breaks once published" bugs — where code resolves data via paths
 * that are only valid when every package shares one source tree.
 *
 * Specifically it verifies:
 *   - the evaluator catalog loads (which reads + validates against the vendored
 *     MITRE ATLAS data), and
 *   - the autonomous seed knowledge (personas / strategies / vuln-classes) loads.
 *
 * Usage:
 *   npm run build && npm run smoke:pack
 *
 * Exits non-zero on any failure so it can gate a release in CI.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(REPO_ROOT, "core");

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fail(msg: string): never {
  console.error(`\n❌ Smoke test FAILED: ${msg}`);
  process.exit(1);
}

const corePkg = JSON.parse(readFileSync(path.join(CORE_DIR, "package.json"), "utf8")) as {
  name: string;
  version: string;
};

const workDir = mkdtempSync(path.join(tmpdir(), "opfor-smoke-"));

try {
  console.log(`Packing ${corePkg.name}@${corePkg.version} …`);
  // `npm pack` prints the tarball filename as its final stdout line.
  const packOut = run("npm", ["pack", "--pack-destination", workDir], CORE_DIR).trim();
  const tarball = packOut.split("\n").pop()?.trim();
  if (!tarball) fail("could not determine packed tarball filename");
  const tarballPath = path.join(workDir, tarball as string);

  console.log("Installing tarball into a clean project (no monorepo around it) …");
  run("npm", ["init", "-y"], workDir);
  run("npm", ["install", tarballPath], workDir);

  // Import via the package's *public* export subpaths — exactly what a consumer hits.
  const testFile = path.join(workDir, "smoke.mjs");
  writeFileSync(
    testFile,
    `
import { loadEvaluatorCatalog } from "${corePkg.name}/catalog/loadEvaluatorCatalog.js";
import { loadKnowledge } from "${corePkg.name}/autonomous/knowledge/load.js";

const cat = await loadEvaluatorCatalog("agent");
const kb = await loadKnowledge();

const out = {
  evaluators: cat.evaluators.length,
  suites: cat.suites.length,
  personas: kb.personas.length,
  strategies: kb.strategies.length,
  vulnClasses: kb.vulnClasses.length,
};
console.log(JSON.stringify(out));
`,
    "utf8"
  );

  const resultRaw = run("node", [testFile], workDir).trim();
  const result = JSON.parse(resultRaw.split("\n").pop() as string) as Record<string, number>;

  console.log("Loaded from clean install:", result);

  const checks: Array<[string, boolean]> = [
    ["evaluators > 0 (catalog + ATLAS data resolved)", result.evaluators > 0],
    ["suites > 0", result.suites > 0],
    ["personas > 0 (seed knowledge resolved)", result.personas > 0],
    ["strategies > 0", result.strategies > 0],
    ["vulnClasses > 0", result.vulnClasses > 0],
  ];

  const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failures.length > 0) fail(`empty results for: ${failures.join(", ")}`);

  console.log("\n✅ Smoke test PASSED — packed tarball works from a clean install");
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  fail(msg);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
