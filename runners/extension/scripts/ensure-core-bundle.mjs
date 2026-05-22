import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(__dirname, "../dist/core.bundle.js");
const maxBytes = 3 * 1024 * 1024;

function needsBuild() {
  if (!existsSync(bundlePath)) return "missing";
  try {
    if (statSync(bundlePath).size > maxBytes) return "oversized";
  } catch {
    return "missing";
  }
  return null;
}

const reason = needsBuild();
if (reason) {
  console.log(
    reason === "oversized"
      ? "core.bundle.js is too large (likely a dev build) — rebuilding minified…"
      : "core.bundle.js missing — building…"
  );
  const r = spawnSync(process.execPath, ["scripts/bundle-core.mjs"], {
    cwd: resolve(__dirname, ".."),
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
