/**
 * Packed-tarball smoke test.
 *
 * Builds the real npm tarballs for the PUBLISHED runner packages (via `npm pack`,
 * which runs each package's prepack/postpack), installs them into clean throwaway
 * projects *outside* the monorepo, and exercises the runtime code paths that rely
 * on on-disk data files. This is the only check that catches "works in the
 * monorepo, breaks once published" bugs — where code resolves data via paths that
 * are only valid when every package shares one source tree.
 *
 * Why the runner packages and not `core`: `@keyvaluesystems/agent-opfor-core` is
 * `private: true` with no prepack, so its tarball never vendors `evaluators/` or
 * `data/` — testing it could never catch a publish-time path bug. The CLI/SDK are
 * what users actually install; their prepack vendors the data beside the bundled
 * `dist/`, and their bundled code resolves it via `getRepoRoot()` (evaluatorsLayout).
 *
 * Coverage:
 *   - SDK (importable): calls `listEvaluators()` / `listSuites()` from the installed
 *     package — real runtime proof that `getRepoRoot()`/`getEvaluatorsDir()` resolve
 *     the vendored `evaluators/` + ATLAS data from the bundled `dist/index.js`. This
 *     is the same resolver the autonomous hunt vuln-class loader uses.
 *   - SDK + CLI (static): asserts the vendored hunt seed knowledge shipped at the
 *     package root where the bundled code looks for it — `data/personas`,
 *     `data/strategies`, and all HUNT_VULN_CLASS_CATEGORIES README files under
 *     `evaluators/agent/`. Together with the SDK runtime check and the unit tests
 *     (core/tests/{load,vulnClasses}.test.ts), this proves hunt's seed knowledge
 *     loads from a real install.
 *
 * Run MANUALLY before publishing (publishing is manual — this is not wired into CI):
 *   npm run build && npm run smoke:pack
 *
 * Exits non-zero on any failure.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** The 9 agent categories opfor hunt derives its vuln-classes from — must match
 * HUNT_VULN_CLASS_CATEGORIES in core/src/autonomous/knowledge/vulnClasses.ts. */
const HUNT_VULN_CLASS_CATEGORIES = [
  "bias",
  "harmful",
  "accuracy",
  "disclosure",
  "injection",
  "excessive-agency",
  "brand-conduct",
  "access-control",
  "mcp-usage",
];

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fail(msg: string): never {
  console.error(`\n❌ Smoke test FAILED: ${msg}`);
  process.exit(1);
}

function nonEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

interface PackedPkg {
  name: string;
  installedDir: string;
  workDir: string;
}

/** `npm pack` a runner package (runs its prepack) and install the tarball into a
 * clean project with no monorepo around it. Returns the installed package dir. */
function packAndInstall(pkgRelDir: string): PackedPkg {
  const pkgDir = path.join(REPO_ROOT, pkgRelDir);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const workDir = mkdtempSync(path.join(tmpdir(), "opfor-smoke-"));

  console.log(`\nPacking ${pkg.name}@${pkg.version} …`);
  // `npm pack` prints the tarball filename as its final stdout line.
  const packOut = run("npm", ["pack", "--pack-destination", workDir], pkgDir).trim();
  const tarball = packOut.split("\n").pop()?.trim();
  if (!tarball) fail(`could not determine packed tarball filename for ${pkg.name}`);
  const tarballPath = path.join(workDir, tarball as string);

  console.log("Installing tarball into a clean project (no monorepo around it) …");
  run("npm", ["init", "-y"], workDir);
  run("npm", ["install", tarballPath], workDir);

  const installedDir = path.join(workDir, "node_modules", ...pkg.name.split("/"));
  return { name: pkg.name, installedDir, workDir };
}

/** Assert the vendored hunt seed knowledge shipped where the bundled code expects
 * it: `<pkg-root>/data/{personas,strategies}` and every allow-listed vuln-class
 * README under `<pkg-root>/evaluators/agent/`. */
function checkVendoredSeedKnowledge(pkg: PackedPkg): Array<[string, boolean]> {
  const root = pkg.installedDir;
  const checks: Array<[string, boolean]> = [
    [`${pkg.name}: data/personas present`, nonEmptyDir(path.join(root, "data", "personas"))],
    [`${pkg.name}: data/strategies present`, nonEmptyDir(path.join(root, "data", "strategies"))],
  ];
  for (const id of HUNT_VULN_CLASS_CATEGORIES) {
    const readme = path.join(root, "evaluators", "agent", id, "README.md");
    checks.push([`${pkg.name}: evaluators/agent/${id}/README.md present`, existsSync(readme)]);
  }
  return checks;
}

const workDirs: string[] = [];
try {
  // --- SDK: full runtime import + static seed-knowledge checks ---
  const sdk = packAndInstall(path.join("runners", "sdk"));
  workDirs.push(sdk.workDir);

  const testFile = path.join(sdk.workDir, "smoke.mjs");
  writeFileSync(
    testFile,
    `
import { listEvaluators, listSuites } from "${sdk.name}";

const evaluators = await listEvaluators();
const suites = await listSuites();

console.log(JSON.stringify({ evaluators: evaluators.length, suites: suites.length }));
`,
    "utf8"
  );
  const resultRaw = run("node", [testFile], sdk.workDir).trim();
  const result = JSON.parse(resultRaw.split("\n").pop() as string) as Record<string, number>;
  console.log("SDK runtime load from clean install:", result);

  const checks: Array<[string, boolean]> = [
    [
      "SDK: listEvaluators() > 0 (evaluators + ATLAS data resolved from bundle)",
      result.evaluators > 0,
    ],
    ["SDK: listSuites() > 0", result.suites > 0],
    ...checkVendoredSeedKnowledge(sdk),
  ];

  // --- CLI: bin-only, not importable — static seed-knowledge checks only ---
  const cli = packAndInstall(path.join("runners", "cli"));
  workDirs.push(cli.workDir);
  checks.push(...checkVendoredSeedKnowledge(cli));

  const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failures.length > 0) fail(`failed checks:\n  - ${failures.join("\n  - ")}`);

  console.log("\n✅ Smoke test PASSED — packed CLI + SDK tarballs work from a clean install");
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  fail(msg);
} finally {
  for (const d of workDirs) rmSync(d, { recursive: true, force: true });
}
