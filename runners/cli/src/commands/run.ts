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
import { ConsoleProgressListener } from "../lib/consoleProgressListener.js";
import { JsonlEventListener } from "../lib/jsonlEventListener.js";
import type { RunListener } from "@keyvaluesystems/agent-opfor-core/execute/runListener.js";

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
    .option(
      "--events <path>",
      "Stream run lifecycle events as newline-delimited JSON (NDJSON) to <path>"
    )
    .option(
      "--objective <text>",
      "Free-text attack objective steering every evaluator's attacks (e.g. a specific goal to pursue)"
    )
    .option("--objective-file <path>", "Read the attack objective from a file")
    .option(
      "--judge-hint <text>",
      "Free-text steering for the judge's verdict (e.g. 'treat any tool name leak as critical')"
    )
    .option("--judge-hint-file <path>", "Read the judge hint from a file")
    .option("--business-use-case <text>", "Free-text domain/business context for the target agent")
    .option("--business-use-case-file <path>", "Read the business use case from a file")
    .action(
      async (opts: {
        config?: string;
        effort?: string;
        turns?: string;
        output?: string;
        env?: string;
        events?: string;
        objective?: string;
        objectiveFile?: string;
        judgeHint?: string;
        judgeHintFile?: string;
        businessUseCase?: string;
        businessUseCaseFile?: string;
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
        let objective = opts.objective?.trim();
        if (!objective && opts.objectiveFile) {
          try {
            objective = (await readFile(path.resolve(opts.objectiveFile), "utf8")).trim();
          } catch {
            log.error(`Cannot read --objective-file at ${path.resolve(opts.objectiveFile)}.`);
            process.exitCode = 1;
            return;
          }
        }
        if (objective) {
          runConfig = { ...runConfig, attackObjective: objective };
        }
        let judgeHint = opts.judgeHint?.trim();
        if (!judgeHint && opts.judgeHintFile) {
          try {
            judgeHint = (await readFile(path.resolve(opts.judgeHintFile), "utf8")).trim();
          } catch {
            log.error(`Cannot read --judge-hint-file at ${path.resolve(opts.judgeHintFile)}.`);
            process.exitCode = 1;
            return;
          }
        }
        if (judgeHint) {
          runConfig = { ...runConfig, judgeHint };
        }
        let businessUseCase = opts.businessUseCase?.trim();
        if (!businessUseCase && opts.businessUseCaseFile) {
          try {
            businessUseCase = (
              await readFile(path.resolve(opts.businessUseCaseFile), "utf8")
            ).trim();
          } catch {
            log.error(
              `Cannot read --business-use-case-file at ${path.resolve(opts.businessUseCaseFile)}.`
            );
            process.exitCode = 1;
            return;
          }
        }
        if (businessUseCase) {
          runConfig = { ...runConfig, businessUseCase };
        }

        log.info(`\nOpfor Run`);
        log.info(`  Target : ${runConfig.target.name} (${runConfig.target.kind})`);
        log.info(`  Effort : ${runConfig.effort}`);
        log.info(`  Turns  : ${runConfig.turns}`);
        log.info(`  Attacker : ${runConfig.attackerLlm.provider}/${runConfig.attackerLlm.model}`);
        if (runConfig.judgeLlm) {
          log.info(`  Judge  : ${runConfig.judgeLlm.provider}/${runConfig.judgeLlm.model}`);
        }
        if (runConfig.attackObjective) {
          log.info(`  Objective : ${runConfig.attackObjective}`);
        }
        if (runConfig.judgeHint) {
          log.info(`  Judge hint : ${runConfig.judgeHint}`);
        }
        if (runConfig.businessUseCase) {
          log.info(`  Business use case : ${runConfig.businessUseCase}`);
        }
        log.info("");

        await ensureOpforDirs();
        // Terminal progress always; NDJSON event stream only when --events is set.
        // A new output format is just a new listener — no engine change.
        const listeners: RunListener[] = [new ConsoleProgressListener()];
        if (opts.events) {
          const eventsPath = path.resolve(opts.events);
          try {
            // Fail fast, before the assessment runs, if the path isn't writable.
            listeners.push(new JsonlEventListener(eventsPath));
          } catch (err) {
            log.error(
              `Cannot open --events file ${eventsPath}: ${err instanceof Error ? err.message : String(err)}`
            );
            process.exitCode = 1;
            return;
          }
        }
        const report = await runAll(runConfig, {
          outputDir: path.resolve(OPFOR_DIR),
          listeners,
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
