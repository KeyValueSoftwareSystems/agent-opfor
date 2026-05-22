import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(__dirname, "../dist/core.bundle.js");

// Always minify with no inline sourcemap — Chrome MV3 service workers fail to
// register when the bundled import graph is multi-MB (dev inline maps blow up size).
await build({
  entryPoints: [resolve(__dirname, "../../../core/src/browser.ts")],
  outfile,
  bundle: true,
  format: "esm",
  target: ["chrome120"],
  treeShaking: true,
  minify: true,
  sourcemap: false,
  external: ["node:fs", "node:path", "node:child_process", "node:crypto", "node:os"],
});

console.log(`✓ core bundle written to ${outfile}`);
