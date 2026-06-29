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
});
