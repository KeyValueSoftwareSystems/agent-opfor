#!/usr/bin/env node

// Load `.env` from cwd (and defaults per dotenv) so GROQ_API_KEY, LANGFUSE_*, etc.
// work without exporting in the shell. Matches astra-mcp behaviour.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { Command } from "commander";
import { registerSetupCommand } from "./commands/setup.js";
import { registerRunCommand } from "./commands/run.js";
import { registerInitCommand } from "./commands/init.js";

function buildProgram() {
  const program = new Command();

  program
    .name("astra")
    .description("Astra CLI — AI security scanner")
    .version("0.1.0");

  registerInitCommand(program);
  registerSetupCommand(program);
  registerRunCommand(program);

  return program;
}

async function main(argv: string[]) {
  const program = buildProgram();
  await program.parseAsync(argv);
}

main(process.argv).catch((err: unknown) => {
  const message =
    err instanceof Error ? err.stack || err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
