import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { chmodSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(__dirname, "../dist/index.js");

await build({
  entryPoints: [resolve(__dirname, "../src/index.ts")],
  outfile,
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

// esbuild doesn't preserve/set the executable bit; without it `npm install -g`
// symlinks a non-executable file into bin/, and running `opfor` fails with
// "Permission denied" despite the shebang above.
chmodSync(outfile, 0o755);
