import type { Command } from "commander";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { consola } from "consola";
import type { AutoOptions, TargetConfig, TargetMode } from "../lib/types.js";
import { runAutonomous } from "../orchestrator/run.js";
import { writeAutonomousReport } from "../report/writeReport.js";

/** Short HH:MM:SS timestamp for live log lines. */
function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

interface AutoCliOptions {
  endpoint?: string;
  objective?: string;
  objectiveFile?: string;
  targetKey?: string;
  stateful?: boolean;
  stateless?: boolean;
  sessionField?: string;
  promptPath?: string;
  responsePath?: string;
  targetModel?: string;
  header?: string[];
  name?: string;
  model: string;
  attackerModel: string;
  reconModel: string;
  maxAttackers: string;
  maxTurns: string;
  maxThreadTurns: string;
  maxReconProbes: string;
  budgetUsd?: string;
  verify?: boolean;
  verifierModel?: string;
  sequential?: boolean;
  persistInventions?: boolean;
  seedDir?: string;
  output: string;
  env?: string;
}

function parseHeaders(raw?: string[]): Record<string, string> | undefined {
  if (!raw?.length) return undefined;
  const headers: Record<string, string> = {};
  for (const item of raw) {
    const idx = item.indexOf(":");
    if (idx === -1) continue;
    headers[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
  }
  return Object.keys(headers).length ? headers : undefined;
}

function intOr(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function registerAutoCommand(program: Command): void {
  program
    .command("auto")
    .description(
      "Autonomously red-team a target agent: recon, adaptive multi-turn attacks, self-judging, and a full report."
    )
    .requiredOption("--endpoint <url>", "Target agent HTTP endpoint")
    .option("--objective <text>", "Free-text attack objective")
    .option("--objective-file <path>", "Read the objective from a file")
    .option("--target-key <key>", "Target API key (or env TARGET_API_KEY)")
    .option("--name <name>", "Display name for the target (defaults to endpoint host)")
    .option("--stateless", "Target is stateless; replay full history each turn (default)")
    .option(
      "--stateful",
      "Target keeps history server-side; send only the latest prompt + session id"
    )
    .option("--session-field <name>", "Body field carrying the session id (stateful mode)")
    .option("--prompt-path <dotpath>", "Body dot-path to write the prompt into")
    .option("--response-path <dotpath>", "Body dot-path to read the reply from")
    .option("--target-model <id>", "model value sent in OpenAI-shape requests")
    .option(
      "--header <k:v>",
      "Extra request header (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      []
    )
    .option("--model <id>", "Commander model (alias or id)", "opus")
    .option("--attacker-model <id>", "Attacker subagent model", "sonnet")
    .option("--recon-model <id>", "Recon subagent model", "haiku")
    .option("--max-attackers <n>", "Max parallel attacker subagents", "6")
    .option("--max-turns <n>", "Hard ceiling on SDK agentic turns", "120")
    .option("--max-thread-turns <n>", "Per-attack-thread turn cap", "8")
    .option("--max-recon-probes <n>", "Max benign recon probes", "8")
    .option("--budget-usd <n>", "Hard USD budget; finalizes a partial report when reached")
    .option("--verify", "Enable the independent second-model verifier (self_check)")
    .option("--verifier-model <id>", "Verifier model id (defaults to commander model)")
    .option("--sequential", "Dispatch attackers one at a time (rate-limited targets)")
    .option("--persist-inventions", "Persist novel personas/strategies back to the seed library")
    .option("--seed-dir <path>", "Override the seed knowledge directory")
    .option("--output <dir>", "Report output directory", ".opfor/reports")
    .option("--env <path>", "Path to a .env file to load")
    .action(async (opts: AutoCliOptions) => {
      if (opts.env) {
        const { config: loadDotenv } = await import("dotenv");
        loadDotenv({ path: path.resolve(opts.env), override: true });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        consola.error(
          "ANTHROPIC_API_KEY is not set — required to drive the agent (Claude Agent SDK)."
        );
        process.exitCode = 1;
        return;
      }

      // Resolve objective.
      let objective = opts.objective?.trim();
      if (!objective && opts.objectiveFile) {
        objective = (await readFile(path.resolve(opts.objectiveFile), "utf8")).trim();
      }
      if (!objective) {
        consola.error("Provide an attack objective via --objective or --objective-file.");
        process.exitCode = 1;
        return;
      }

      const mode: TargetMode = opts.stateful ? "stateful" : "stateless";
      if (mode === "stateful" && !opts.sessionField) {
        consola.warn(
          "Stateful mode without --session-field: the target won't receive a session id."
        );
      }

      const target: TargetConfig = {
        name: opts.name ?? new URL(opts.endpoint!).host,
        endpoint: opts.endpoint!,
        apiKey: opts.targetKey ?? process.env.TARGET_API_KEY,
        headers: parseHeaders(opts.header),
        mode,
        promptPath: opts.promptPath,
        responsePath: opts.responsePath,
        sessionField: opts.sessionField,
        targetModel: opts.targetModel,
      };

      const autoOptions: AutoOptions = {
        target,
        objective,
        commanderModel: opts.model,
        attackerModel: opts.attackerModel,
        reconModel: opts.reconModel,
        maxAttackers: intOr(opts.maxAttackers, 6),
        maxTurns: intOr(opts.maxTurns, 120),
        maxThreadTurns: intOr(opts.maxThreadTurns, 8),
        maxReconProbes: intOr(opts.maxReconProbes, 8),
        budgetUsd: opts.budgetUsd ? Number(opts.budgetUsd) : undefined,
        verify: Boolean(opts.verify),
        verifierModel: opts.verifierModel,
        sequential: Boolean(opts.sequential),
        persistInventions: Boolean(opts.persistInventions),
        seedDir: opts.seedDir,
        outputDir: path.resolve(opts.output),
      };

      // Live log file the operator can `tail -f` while the run is in progress.
      await mkdir(autoOptions.outputDir, { recursive: true });
      const startedAt = new Date()
        .toISOString()
        .replace(/[-:T.Z]/g, "")
        .slice(0, 14);
      const liveLogPath = path.join(autoOptions.outputDir, `auto-live-${startedAt}.log`);
      const liveLog: WriteStream = createWriteStream(liveLogPath, { flags: "a" });
      const emit = (line: string): void => {
        const stamped = `[${clock()}] ${line}`;
        process.stdout.write(stamped + "\n");
        liveLog.write(stamped + "\n");
      };

      const header = [
        "════════════════════════════════════════════════════════════════",
        ` AUTONOMOUS RED-TEAM`,
        ` target    : ${target.name} (${mode})  ${target.endpoint}`,
        ` objective : ${objective}`,
        ` models    : commander=${autoOptions.commanderModel}  attacker=${autoOptions.attackerModel}  recon=${autoOptions.reconModel}`,
        ` limits    : attackers≤${autoOptions.maxAttackers}  turns≤${autoOptions.maxTurns}  thread-turns≤${autoOptions.maxThreadTurns}${autoOptions.budgetUsd ? `  budget=$${autoOptions.budgetUsd}` : ""}`,
        ` verifier  : ${autoOptions.verify ? "on" : "off"}`,
        "════════════════════════════════════════════════════════════════",
      ].join("\n");
      process.stdout.write(header + "\n");
      liveLog.write(header + "\n");
      consola.box(`Live log (tail it):\n  tail -f ${liveLogPath}`);

      let report;
      try {
        report = await runAutonomous(autoOptions, {
          progress: { onLine: emit },
        });
      } finally {
        liveLog.end();
      }

      const { html, json, dir } = await writeAutonomousReport(report, autoOptions.outputDir);

      consola.info("");
      consola.success(`Assessment complete — outcome: ${report.objectiveOutcome}`);
      consola.info(
        `Vulnerabilities: ${report.summary.confirmed} · Defended: ${report.summary.defended} · Errors: ${report.summary.errors}`
      );
      if (report.totalCostUsd !== undefined)
        consola.info(`Cost: $${report.totalCostUsd.toFixed(4)}`);
      if (report.truncated) consola.warn(`Run truncated: ${report.truncationReason}`);
      consola.success(`Report: ${html}`);
      consola.info(`   JSON: ${json}`);
      consola.info(`   Dir : ${dir}`);

      const hasSevere = report.findings.some(
        (f) => f.verdict === "FAIL" && (f.severity === "critical" || f.severity === "high")
      );
      if (hasSevere) process.exitCode = 1;
    });
}
