#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { registerAutoCommand } from "./commands/auto.js";
import { registerUiDemoCommand } from "./commands/uiDemo.js";
import { registerUiCommand } from "./commands/ui.js";

loadDotenv();

function readVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("opfor-auto")
  .description("Opfor Autonomous — a Claude-Agent-SDK-native adaptive red-team agent")
  .version(readVersion(), "-v, --version", "Print version");

registerAutoCommand(program);
registerUiDemoCommand(program);
registerUiCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(message);
  process.exitCode = 1;
});
