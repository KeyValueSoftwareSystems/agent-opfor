import type { Command } from "commander";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { consola } from "consola";
import type { AutoOptions, TargetConfig, TargetMode } from "../lib/types.js";
import type { RunEvent } from "../state/observe.js";
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
  maxTotalThreads: string;
  maxForksPerThread: string;
  maxTotalSends?: string;
  maxDepth: string;
  maxLeadsPerWave: string;
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
    .option(
      "--max-thread-turns <n>",
      "Per-thread depth SAFETY CEILING — not the operating limit; the agent stops on diminishing returns well before this",
      "25"
    )
    .option(
      "--max-total-threads <n>",
      "Hard ceiling on total attack threads incl. forks (tree-size backstop)",
      "40"
    )
    .option(
      "--max-forks-per-thread <n>",
      "Hard ceiling on direct forks of any one thread (fan-out backstop)",
      "4"
    )
    .option(
      "--max-total-sends <n>",
      "Deterministic ceiling on total target sends (real-time cost backstop; default ≈ budget-usd × 50)"
    )
    .option(
      "--max-depth <n>",
      "Max exploration generations (follow-up waves spawned from leads)",
      "3"
    )
    .option(
      "--max-leads-per-wave <n>",
      "How many queued leads the commander expands per wave (top-K guidance)",
      "4"
    )
    .option("--max-recon-probes <n>", "Max benign recon probes", "8")
    .option(
      "--budget-usd <n>",
      "Hard USD budget; finalizes a partial report when reached (the real cost backstop; 0 = unlimited)",
      "10"
    )
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
        maxThreadTurns: intOr(opts.maxThreadTurns, 25),
        maxTotalThreads: intOr(opts.maxTotalThreads, 40),
        maxForksPerThread: intOr(opts.maxForksPerThread, 4),
        maxTotalSends: opts.maxTotalSends ? intOr(opts.maxTotalSends, 0) || undefined : undefined,
        maxDepth: intOr(opts.maxDepth, 3),
        maxLeadsPerWave: intOr(opts.maxLeadsPerWave, 4),
        maxReconProbes: intOr(opts.maxReconProbes, 8),
        // Default to a $10 backstop; an explicit `--budget-usd 0` means unlimited.
        budgetUsd:
          opts.budgetUsd !== undefined
            ? Number(opts.budgetUsd) > 0
              ? Number(opts.budgetUsd)
              : undefined
            : 10,
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

      // Structured event trail (one JSON object per line) — machine-readable for debugging and
      // the foundation a future "opfor view" web UI consumes. Stamped with a wall-clock time.
      const eventLogPath = path.join(autoOptions.outputDir, `run-${startedAt}.jsonl`);
      const eventLog: WriteStream = createWriteStream(eventLogPath, { flags: "a" });
      const emitEvent = (event: RunEvent): void => {
        // An observability sink must never crash the run. Guard JSON.stringify (data is
        // Record<string, unknown> — a future event could carry a circular ref / BigInt).
        try {
          eventLog.write(JSON.stringify({ ...event, wall: clock() }) + "\n");
        } catch (err) {
          eventLog.write(
            JSON.stringify({
              type: "serialization_error",
              eventType: event.type,
              error: String(err),
              wall: clock(),
            }) + "\n"
          );
        }
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
          progress: { onLine: emit, onEvent: emitEvent },
        });
      } finally {
        liveLog.end();
        eventLog.end();
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
      consola.info(`   Events: ${eventLogPath}`);

      // Findings are the expected OUTPUT of a successful assessment — not a failure. Exit 0 on a
      // clean run regardless of severity. Only genuine errors (bad config above, or a run that
      // couldn't produce a report) are non-zero.
    });
}
