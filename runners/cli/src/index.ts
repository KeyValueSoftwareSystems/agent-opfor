// Suppress Vercel AI SDK v1/v2 spec compatibility warnings — these fire for
// custom/openai-compatible providers and are not actionable by the user.
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

import { readFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { registerSetupCommand } from "./commands/setup.js";
import { registerRunCommand } from "./commands/run.js";
import { registerHuntCommand } from "./commands/hunt.js";

loadDotenv();

function readVersion(): string {
  const pkgUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

const program = new Command();

program
  .name("opfor")
  .description("Opfor — security testing for AI agents and MCP servers")
  .version(readVersion(), "-v, --version", "Print version");

registerSetupCommand(program);
registerRunCommand(program);
registerHuntCommand(program);

main().catch((err: unknown) => {
  if (err instanceof Error && err.name === "ExitPromptError") process.exit(0);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(message);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}
