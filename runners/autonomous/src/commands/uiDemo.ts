import type { Command } from "commander";
import { consola } from "consola";
import { runUiDemo } from "../ui/demoRunner.js";

interface UiDemoCliOptions {
  uiPort: string;
  noOpen?: boolean;
}

export function registerUiDemoCommand(program: Command): void {
  program
    .command("ui-demo")
    .description("Launch the live dashboard with scripted demo data (no API calls or budget spend)")
    .option("--ui-port <port>", "Dashboard port", "3847")
    .option("--no-open", "Do not open a browser tab")
    .action(async (opts: UiDemoCliOptions) => {
      const port = Number.parseInt(opts.uiPort, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        consola.error(`Invalid --ui-port: ${opts.uiPort}`);
        process.exitCode = 1;
        return;
      }
      await runUiDemo({ port, openBrowser: opts.noOpen !== true });
    });
}
