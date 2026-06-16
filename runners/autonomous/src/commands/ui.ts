import type { Command } from "commander";
import { consola } from "consola";
import { startUiServer } from "../ui/server.js";

interface UiCliOptions {
  port: string;
  noOpen?: boolean;
}

export function registerUiCommand(program: Command): void {
  program
    .command("ui")
    .description("Launch the setup UI to configure and start an assessment (no CLI flags needed)")
    .option("--port <port>", "Dashboard port", "3847")
    .option("--no-open", "Do not open a browser tab")
    .action(async (opts: UiCliOptions) => {
      const port = Number.parseInt(opts.port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        consola.error(`Invalid --port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }

      const handle = await startUiServer({
        port,
        openBrowser: opts.noOpen !== true,
        meta: {},
        setupMode: true,
      });

      consola.info(`Setup UI at ${handle.url}?setup=1`);
      consola.info("Configure your target and click Start to begin the assessment.");
      consola.info("Press Ctrl+C to exit.\n");

      await new Promise<void>(() => {});
    });
}
