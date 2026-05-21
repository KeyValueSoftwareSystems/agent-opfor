import type { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { log } from "@opfor/core/lib/logger.js";
import { runAll } from "@opfor/core/execute/runAll.js";
import { writeReport } from "@opfor/core/report/buildReport.js";
import type { RunConfig } from "@opfor/core/execute/types.js";
import { normalizeEffort } from "@opfor/core/execute/effortCompat.js";
import { DEFAULT_CONFIG_PATH } from "./setup.js";
import { ensureOpforDirs, OPFOR_REPORTS_DIR } from "../lib/artifacts.js";

export function registerExecuteCommand(program: Command): void {
  program
    .command("execute")
    .description(
      "Generate attacks and run them against the configured target (requires setup first)"
    )
    .option("--config <path>", "Path to opfor.config.json", DEFAULT_CONFIG_PATH)
    .option("--effort <level>", "Override effort level: adaptive | comprehensive")
    .option("--turns <n>", "Override turns per attack (1 = single turn)")
    .option("--output <dir>", "Directory for HTML + JSON reports (default: .opfor/reports/)")
    .option("--env <path>", "Path to .env file to load")
    .action(
      async (opts: {
        config: string;
        effort?: string;
        turns?: string;
        output?: string;
        env?: string;
      }) => {
        if (opts.env) {
          const { config: loadDotenv } = await import("dotenv");
          loadDotenv({ path: path.resolve(opts.env) });
        }

        const configPath = path.resolve(opts.config);
        let runConfig: RunConfig;

        try {
          const raw = await readFile(configPath, "utf8");
          runConfig = JSON.parse(raw) as RunConfig;
        } catch {
          log.error(`Cannot read config at ${configPath}. Run \`opfor setup\` first.`);
          process.exitCode = 1;
          return;
        }

        // CLI overrides
        if (opts.effort) {
          const raw = opts.effort.trim().toLowerCase();
          if (raw !== "adaptive" && raw !== "comprehensive") {
            log.error("--effort must be 'adaptive' or 'comprehensive'");
            process.exitCode = 1;
            return;
          }
          runConfig = { ...runConfig, effort: raw };
        }
        // Defensive coerce in case the config file has an unexpected value.
        runConfig = { ...runConfig, effort: normalizeEffort(runConfig.effort as unknown) };
        if (opts.turns) {
          const n = parseInt(opts.turns, 10);
          if (!Number.isFinite(n) || n < 1) {
            log.error("--turns must be a positive integer");
            process.exitCode = 1;
            return;
          }
          runConfig = { ...runConfig, turns: n };
        }

        log.info(`\nOpfor Execute`);
        log.info(`  Target : ${runConfig.target.name} (${runConfig.target.kind})`);
        log.info(`  Effort : ${runConfig.effort}`);
        log.info(`  Turns  : ${runConfig.turns}`);
        log.info(`  Attack : ${runConfig.attackLlm.provider}/${runConfig.attackLlm.model}`);
        if (runConfig.judgeLlm) {
          log.info(`  Judge  : ${runConfig.judgeLlm.provider}/${runConfig.judgeLlm.model}`);
        }
        log.info("");

        const report = await runAll(runConfig, {
          onProgress: (event) => {
            if (event.type === "evaluator_start") {
              log.info(`\n▶ ${event.evaluatorName}`);
            } else if (event.type === "attack_done") {
              const icon = event.verdict === "PASS" ? "✓" : event.verdict === "FAIL" ? "✗" : "⚠";
              process.stdout.write(` ${icon}`);
            }
          },
        });

        log.info("\n\nWriting report...");
        await ensureOpforDirs();
        const outputDir = path.resolve(opts.output ?? OPFOR_REPORTS_DIR);
        const { html, json } = await writeReport(report, outputDir);

        const { summary } = report;
        log.info(
          `\nResults: ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors`
        );
        log.info(`Safety score: ${summary.safetyScore}%`);
        log.success(`\nReport: ${html}`);
        log.info(`   JSON: ${json}`);

        if (summary.failed > 0) process.exitCode = 1;
      }
    );
}
