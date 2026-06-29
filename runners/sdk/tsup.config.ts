import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  dts: {
    // composite: true in tsconfig conflicts with tsup's isolated DTS build
    compilerOptions: { composite: false, incremental: false },
  },
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["node:*"],
  sourcemap: true,
  // ESM output bundling CJS deps (yaml, etc.) that call require() at runtime needs a
  // real require — without this shim esbuild's stub throws "Dynamic require ... not supported".
  // Mirrors the createRequire banner in the cli/mcp esbuild bundles.
  banner: {
    js: [
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});
