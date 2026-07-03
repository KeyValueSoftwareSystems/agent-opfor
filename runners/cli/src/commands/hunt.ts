import type { Command } from "commander";
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { consola } from "consola";
import type {
  HuntOptions,
  TargetConfig,
  TargetMode,
} from "@keyvaluesystems/agent-opfor-core/autonomous/lib/types.js";
import type { RunEvent } from "@keyvaluesystems/agent-opfor-core/autonomous/state/observe.js";
import { runAutonomous } from "@keyvaluesystems/agent-opfor-core/autonomous/orchestrator/run.js";
import { writeAutonomousReport } from "@keyvaluesystems/agent-opfor-core/autonomous/report/writeReport.js";
import { startUiServer } from "../ui/server.js";
import { mergeReporters } from "../ui/bridge.js";

/** Short HH:MM:SS timestamp for live log lines. */
function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

interface HuntCliOptions {
  endpoint?: string;
  objective?: string;
  objectiveFile?: string;
  targetKeyEnv?: string;
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
  operatorModel: string;
  scoutModel: string;
  maxOperators: string;
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
  ui?: boolean;
  uiPort: string;
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

/**
 * Whether the Claude Agent SDK will be able to authenticate.
 *
 * The SDK resolves credentials itself (first match wins): ANTHROPIC_API_KEY →
 * CLAUDE_CODE_OAUTH_TOKEN → a stored `~/.claude/.credentials.json` from a Claude
 * subscription login (`claude setup-token` / `claude login`). This is a courtesy
 * pre-check so we can emit an actionable message instead of a cryptic SDK error;
 * it must therefore recognize the subscription path, not just env vars.
 */
function brainAuthConfigured(): boolean {
  // ANTHROPIC_AUTH_TOKEN only counts alongside ANTHROPIC_BASE_URL: buildChildEnv()
  // strips a bare token (it's treated as an inherited session token), so counting
  // it here without a gateway URL would pass the gate then lose the credential.
  const gatewayToken =
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() && process.env.ANTHROPIC_BASE_URL?.trim();
  if (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    gatewayToken ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  ) {
    return true;
  }
  // Claude subscription: credentials stored on disk by `claude setup-token` / `claude login`.
  return existsSync(path.join(homedir(), ".claude", ".credentials.json"));
}

function intOr(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function registerHuntCommand(program: Command): void {
  program
    .command("hunt")
    .description(
      "Autonomously red-team a target agent: recon, adaptive multi-turn attacks, self-judging, and a full report."
    )
    .option("--endpoint <url>", "Target agent HTTP endpoint (required unless using --ui setup)")
    .option("--objective <text>", "Free-text attack objective")
    .option("--objective-file <path>", "Read the objective from a file")
    .option(
      "--target-key-env <envvar>",
      "Env var name containing target API key (e.g., TARGET_API_KEY)"
    )
    .option("--target-key <key>", "Target API key directly (prefer --target-key-env)")
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
    .option("--model <id>", "Commander model (alias or id)", "sonnet")
    .option("--operator-model <id>", "Operator subagent model", "sonnet")
    .option("--scout-model <id>", "Scout subagent model", "haiku")
    .option("--max-operators <n>", "Max parallel operator subagents", "6")
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
    .option("--sequential", "Dispatch operators one at a time (rate-limited targets)")
    .option("--persist-inventions", "Persist novel personas/strategies back to the seed library")
    .option(
      "--seed-dir <path>",
      "Override the personas/strategies seed directory (vuln-classes always come from evaluators/agent/)"
    )
    .option("--output <dir>", "Report output directory", ".opfor/reports")
    .option("--env <path>", "Path to a .env file to load")
    .option("--ui", "Launch live dashboard UI in the browser")
    .option("--ui-port <port>", "Port for the live dashboard UI", "3847")
    .action(async (opts: HuntCliOptions) => {
      if (opts.env) {
        const { config: loadDotenv } = await import("dotenv");
        loadDotenv({ path: path.resolve(opts.env), override: true });
      }

      // If --ui is set and endpoint is missing, launch setup UI
      if (opts.ui && !opts.endpoint) {
        if (!brainAuthConfigured()) {
          consola.error(
            "Set ANTHROPIC_API_KEY, or run `claude setup-token` to drive the agent with a Claude subscription."
          );
          process.exitCode = 1;
          return;
        }

        const uiPort = intOr(opts.uiPort, 3847);

        // Pass any provided CLI flags as initial config for prefill
        const initialConfig = {
          endpoint: opts.endpoint,
          model: opts.targetModel,
          targetName: opts.name,
          objective: opts.objective,
          apiKeyEnv: opts.targetKeyEnv,
          commanderModel: opts.model,
          operatorModel: opts.operatorModel,
          scoutModel: opts.scoutModel,
          maxOperators: opts.maxOperators,
          maxTurns: opts.maxTurns,
          maxThreadTurns: opts.maxThreadTurns,
          budgetUsd: opts.budgetUsd,
        };

        consola.info(`Starting setup UI at http://127.0.0.1:${uiPort}`);

        // eslint-disable-next-line prefer-const
        let serverHandle: Awaited<ReturnType<typeof startUiServer>> | undefined;

        const cleanup = async (exitCode: number) => {
          if (serverHandle) {
            await serverHandle.close().catch(() => {});
          }
          process.exit(exitCode);
        };

        serverHandle = await startUiServer({
          port: uiPort,
          meta: {
            objective: "",
            targetName: "",
          },
          setupMode: true,
          initialConfig,
          openBrowser: true,
          onLog: (line) => {
            process.stdout.write(line + "\n");
          },
          onComplete: async (result) => {
            if (result.success) {
              consola.success(`Assessment completed! Report: ${result.reportDir}`);
              await cleanup(0);
            } else {
              consola.error(`Assessment failed: ${result.error}`);
              await cleanup(1);
            }
          },
        });

        // Keep process alive until onComplete is called
        await new Promise(() => {});
        return;
      }

      if (!brainAuthConfigured()) {
        consola.error(
          "Set ANTHROPIC_API_KEY, or run `claude setup-token` to drive the agent with a Claude subscription."
        );
        process.exitCode = 1;
        return;
      }

      // Check endpoint is provided when not using setup UI
      if (!opts.endpoint) {
        consola.error("Provide --endpoint or use --ui to launch the setup wizard.");
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
        apiKey:
          opts.targetKey ??
          (opts.targetKeyEnv ? process.env[opts.targetKeyEnv] : undefined) ??
          process.env.TARGET_API_KEY,
        headers: parseHeaders(opts.header),
        mode,
        promptPath: opts.promptPath,
        responsePath: opts.responsePath,
        sessionField: opts.sessionField,
        model: opts.targetModel,
      };

      const huntOptions: HuntOptions = {
        target,
        objective,
        commanderModel: opts.model,
        operatorModel: opts.operatorModel,
        scoutModel: opts.scoutModel,
        maxOperators: intOr(opts.maxOperators, 6),
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

      // Live log file the user can `tail -f` while the run is in progress.
      await mkdir(huntOptions.outputDir, { recursive: true });
      const startedAt = new Date()
        .toISOString()
        .replace(/[-:T.Z]/g, "")
        .slice(0, 14);
      const liveLogPath = path.join(huntOptions.outputDir, `hunt-live-${startedAt}.log`);
      const liveLog: WriteStream = createWriteStream(liveLogPath, { flags: "a" });
      const emit = (line: string): void => {
        const stamped = `[${clock()}] ${line}`;
        process.stdout.write(stamped + "\n");
        liveLog.write(stamped + "\n");
      };

      // Structured event trail (one JSON object per line) — machine-readable for debugging and
      // the foundation a future "opfor view" web UI consumes. Stamped with a wall-clock time.
      const eventLogPath = path.join(huntOptions.outputDir, `run-${startedAt}.jsonl`);
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
        ` models    : commander=${huntOptions.commanderModel}  operator=${huntOptions.operatorModel}  scout=${huntOptions.scoutModel}`,
        ` limits    : operators≤${huntOptions.maxOperators}  turns≤${huntOptions.maxTurns}  thread-turns≤${huntOptions.maxThreadTurns}${huntOptions.budgetUsd ? `  budget=$${huntOptions.budgetUsd}` : ""}`,
        ` verifier  : ${huntOptions.verify ? "on" : "off"}`,
        "════════════════════════════════════════════════════════════════",
      ].join("\n");
      process.stdout.write(header + "\n");
      liveLog.write(header + "\n");
      consola.box(`Live log (tail it):\n  tail -f ${liveLogPath}`);

      let uiHandle: Awaited<ReturnType<typeof startUiServer>> | undefined;
      if (opts.ui) {
        const uiPort = intOr(opts.uiPort, 3847);
        try {
          uiHandle = await startUiServer({
            port: uiPort,
            meta: {
              objective,
              targetName: target.name,
              targetEndpoint: target.endpoint,
              budgetUsd: huntOptions.budgetUsd,
              commanderModel: huntOptions.commanderModel,
              operatorModel: huntOptions.operatorModel,
              scoutModel: huntOptions.scoutModel,
            },
          });
          consola.success(`Live UI: ${uiHandle.url}`);
          uiHandle.bridge.onLine("Live dashboard connected — initializing agent…");
        } catch (err) {
          consola.error(`Failed to start UI server: ${String(err)}`);
          process.exitCode = 1;
          liveLog.end();
          eventLog.end();
          return;
        }
      }

      const fileReporter = { onLine: emit, onEvent: emitEvent };
      const progress = uiHandle ? mergeReporters(fileReporter, uiHandle.bridge) : fileReporter;

      let report;
      try {
        report = await runAutonomous(huntOptions, {
          progress,
          onRunLog: uiHandle ? (log) => uiHandle!.attachRunLog(log) : undefined,
        });
      } finally {
        liveLog.end();
        eventLog.end();
      }

      const { html, json, dir } = await writeAutonomousReport(report, huntOptions.outputDir);

      uiHandle?.markComplete({ reportDir: dir, outcome: report.objectiveOutcome });

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
      if (uiHandle) {
        consola.info(`   UI    : ${uiHandle.url} (press Ctrl+C to exit)`);
        consola.info(`   Note  : CLI waits here so you can review the dashboard`);
        await new Promise<void>((resolve) => {
          const onSignal = () => {
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
            resolve();
          };
          process.on("SIGINT", onSignal);
          process.on("SIGTERM", onSignal);
        });
        await uiHandle.close();
      }

      // Findings are the expected OUTPUT of a successful assessment — not a failure. Exit 0 on a
      // clean run regardless of severity. Only genuine errors (bad config above, or a run that
      // couldn't produce a report) are non-zero.
    });
}
