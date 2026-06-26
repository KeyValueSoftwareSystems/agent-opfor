import type { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { log } from "@keyvaluesystems/agent-opfor-core/lib/logger.js";
import { runAll } from "@keyvaluesystems/agent-opfor-core/execute/runAll.js";
import { writeReport } from "@keyvaluesystems/agent-opfor-core/report/buildReport.js";
import type { RunConfig } from "@keyvaluesystems/agent-opfor-core/execute/types.js";
import { parseRunConfig } from "@keyvaluesystems/agent-opfor-core/config/schema.js";
import { normalizeEffort } from "@keyvaluesystems/agent-opfor-core/execute/effortCompat.js";
import { runSetupAndWrite } from "./setup.js";
import { ensureOpforDirs, OPFOR_DIR, OPFOR_REPORTS_DIR } from "../lib/artifacts.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description(
      "Run attacks against the configured target. With --config, reads an existing config; without --config, runs the setup wizard inline first."
    )
    .option("--config <path>", "Path to opfor.config.json (omit to run the setup wizard inline)")
    .option("--effort <level>", "Override effort level: adaptive | comprehensive")
    .option("--turns <n>", "Override turns per attack (1 = single turn)")
    .option("--output <dir>", "Directory for HTML + JSON reports (default: .opfor/reports/)")
    .option("--env <path>", "Path to .env file to load")
    .action(
      async (opts: {
        config?: string;
        effort?: string;
        turns?: string;
        output?: string;
        env?: string;
      }) => {
        if (opts.env) {
          const { config: loadDotenv } = await import("dotenv");
          loadDotenv({ path: path.resolve(opts.env), override: true });
        }

        let runConfig: RunConfig;

        if (opts.config) {
          const configPath = path.resolve(opts.config);
          let raw: string;
          try {
            raw = await readFile(configPath, "utf8");
          } catch {
            log.error(`Cannot read config at ${configPath}.`);
            process.exitCode = 1;
            return;
          }
          try {
            // Validate the hand-editable entry point (parity with the MCP path).
            runConfig = parseRunConfig(JSON.parse(raw)) as unknown as RunConfig;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`${msg}\n(at ${configPath})`);
            process.exitCode = 1;
            return;
          }
        } else {
          // No --config provided: run the setup wizard inline, then run the resulting config.
          const result = await runSetupAndWrite();
          runConfig = result.config;
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

        log.info(`\nOpfor Run`);
        log.info(`  Target : ${runConfig.target.name} (${runConfig.target.kind})`);
        log.info(`  Effort : ${runConfig.effort}`);
        log.info(`  Turns  : ${runConfig.turns}`);
        log.info(`  Attacker : ${runConfig.attackerLlm.provider}/${runConfig.attackerLlm.model}`);
        if (runConfig.judgeLlm) {
          log.info(`  Judge  : ${runConfig.judgeLlm.provider}/${runConfig.judgeLlm.model}`);
        }
        log.info("");

        await ensureOpforDirs();
        const report = await runAll(runConfig, {
          outputDir: path.resolve(OPFOR_DIR),
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
        const outputDir = path.resolve(opts.output ?? OPFOR_REPORTS_DIR);
        const { html, json } = await writeReport(report, outputDir);

        const { summary } = report;
        log.info(
          `\nResults: ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors`
        );

        // Warn loudly if there were errors (infra/config issues)
        if (summary.errors > 0 && summary.passed === 0 && summary.failed === 0) {
          log.warn(
            `\n⚠️  Assessment incomplete: all ${summary.errors} attack(s) failed due to errors.`
          );
          log.warn(
            `   The target may be unreachable or misconfigured. No security conclusions can be drawn.`
          );
          process.exitCode = 2;
        } else if (summary.errors > 0) {
          log.warn(
            `\n⚠️  ${summary.errors} attack(s) failed due to errors — results may be incomplete.`
          );
        }

        log.info(`Safety score: ${summary.safetyScore}%`);
        log.success(`\nReport: ${html}`);
        log.info(`   JSON: ${json}`);

        if (summary.failed > 0) process.exitCode = 1;
      }
    );
}
