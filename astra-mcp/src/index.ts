#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSetupCommand } from "./commands/setup.js";

// Load .env from cwd (where the user runs the CLI from).
loadDotenv();

function readVersion(): string {
  // dist/index.js resolves package.json via relative URL.
  const pkgUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

const program = new Command();

program
  .name("astra-mcp")
  .description("Astra MCP CLI (standalone npm package)")
  .version(readVersion(), "-v, --version", "Print version");

registerInitCommand(program);
registerSetupCommand(program);
registerRunCommand(program);

program.parse(process.argv);

