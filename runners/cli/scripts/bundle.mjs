import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "../src/index.ts")],
  outfile: resolve(__dirname, "../dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["node:*"],
  sourcemap: true,
  // Shebang + createRequire shim: CJS packages (e.g. dotenv) use require('fs') which
  // fails in ESM bundles without a real require available at runtime.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});
