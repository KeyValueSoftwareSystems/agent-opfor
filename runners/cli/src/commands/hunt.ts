import type { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { consola } from "consola";
import type {
  HuntOptions,
  TargetConfig,
} from "@keyvaluesystems/agent-opfor-core/autonomous/lib/types.js";
import type { RunEvent } from "@keyvaluesystems/agent-opfor-core/autonomous/state/observe.js";
import { parseAgentTarget } from "@keyvaluesystems/agent-opfor-core/config/schema.js";
import { runAutonomous } from "@keyvaluesystems/agent-opfor-core/autonomous/orchestrator/run.js";
import {
  writeAutonomousReport,
  reportDirFor,
} from "@keyvaluesystems/agent-opfor-core/autonomous/report/writeReport.js";
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
  targetConfig?: string;
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

// Map a run-style `target` block onto hunt's TargetConfig. Hunt is HTTP-only,
// and resolves the API key from `apiKeyEnv` (the file holds the var name).
function mapAgentTargetToAutonomous(t: ReturnType<typeof parseAgentTarget>): TargetConfig {
  if (t.type === "local-script") {
    if (!t.scriptPath) throw new Error("local-script target is missing `scriptPath`.");
    return {
      name: t.name || path.basename(t.scriptPath),
      type: "local-script",
      scriptPath: t.scriptPath,
      // Report/UI/prompt code treats `endpoint` as an opaque display label — never a real URL.
      endpoint: `local-script:${t.scriptPath}`,
      mode: t.stateful === false ? "stateless" : "stateful",
      promptPath: t.promptPath,
      responsePath: t.responsePath,
      sessionField: t.sessionIdField,
      session: t.session,
      model: t.model,
    };
  }
  if (!t.endpoint) throw new Error("target is missing `endpoint`.");
  return {
    name: t.name || new URL(t.endpoint).host,
    endpoint: t.endpoint,
    apiKey: t.apiKeyEnv ? process.env[t.apiKeyEnv] : undefined,
    headers: t.headers,
    mode: t.stateful === false ? "stateless" : "stateful",
    promptPath: t.promptPath,
    responsePath: t.responsePath,
    sessionField: t.sessionIdField,
    session: t.session,
    model: t.model,
  };
}

const NO_BRAIN_AUTH_MESSAGE =
  "No Claude credentials found. Set ANTHROPIC_API_KEY, or run `claude login` / `claude setup-token` to use a Claude subscription.";

/**
 * Resolve which credential the Claude Agent SDK will authenticate with, for a
 * user-facing log line — or null if none is configured.
 *
 * The SDK resolves credentials itself (first match wins): ANTHROPIC_API_KEY →
 * CLAUDE_CODE_OAUTH_TOKEN → a stored `~/.claude/.credentials.json` from a Claude
 * subscription login (`claude setup-token` / `claude login`). This is a courtesy
 * pre-check so we can emit an actionable message instead of a cryptic SDK error;
 * it must therefore recognize the subscription path, not just env vars.
 */
function resolveBrainAuth(): string | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "ANTHROPIC_API_KEY";
  // ANTHROPIC_AUTH_TOKEN only counts alongside ANTHROPIC_BASE_URL: buildChildEnv()
  // strips a bare token (it's treated as an inherited session token), so counting
  // it here without a gateway URL would pass the gate then lose the credential.
  if (process.env.ANTHROPIC_AUTH_TOKEN?.trim() && process.env.ANTHROPIC_BASE_URL?.trim()) {
    return `gateway (${process.env.ANTHROPIC_BASE_URL})`;
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return "CLAUDE_CODE_OAUTH_TOKEN";
  // Claude subscription: credentials stored on disk by `claude setup-token` / `claude login`.
  if (existsSync(path.join(homedir(), ".claude", ".credentials.json"))) {
    return "Claude subscription (~/.claude/.credentials.json)";
  }
  return null;
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
    .option(
      "--target-config <path>",
      "JSON file with a run-style `target` block (bare or { target }); enables server-owned sessions and header session ids. CLI flags override its fields."
    )
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

      // If --ui is set and no target was given at all (neither --endpoint nor
      // --target-config, e.g. a local-script target), launch the setup wizard.
      // Otherwise --ui means the live dashboard for the already-configured target.
      if (opts.ui && !opts.endpoint && !opts.targetConfig) {
        const brainAuth = resolveBrainAuth();
        if (!brainAuth) {
          consola.error(NO_BRAIN_AUTH_MESSAGE);
          process.exitCode = 1;
          return;
        }
        consola.info(`Authenticating via: ${brainAuth}`);

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

        // First Ctrl+C aborts a running assessment (partial report via onComplete), or exits if
        // idle on the setup form; second Ctrl+C force-quits.
        let setupSigintCount = 0;
        const onSetupSigint = (): void => {
          setupSigintCount++;
          if (setupSigintCount >= 2) {
            void cleanup(130);
            return;
          }
          if (serverHandle?.abortAssessment()) {
            consola.warn(
              "\nCaught interrupt — finalizing a partial report… (Ctrl+C again to force quit)"
            );
          } else {
            void cleanup(0);
          }
        };
        process.on("SIGINT", onSetupSigint);

        // Keep process alive until onComplete is called
        await new Promise(() => {});
        return;
      }

      const brainAuth = resolveBrainAuth();
      if (!brainAuth) {
        consola.error(NO_BRAIN_AUTH_MESSAGE);
        process.exitCode = 1;
        return;
      }
      consola.info(`Authenticating via: ${brainAuth}`);

      // Check endpoint is provided when not using setup UI (the endpoint may
      // instead come from --target-config).
      if (!opts.endpoint && !opts.targetConfig) {
        consola.error(
          "Provide --endpoint, --target-config, or use --ui to launch the setup wizard."
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

      // Base target: from --target-config (a run-style `target` block) if given,
      // else an empty stateless shell that the flags fill in below.
      let baseTarget: TargetConfig;
      if (opts.targetConfig) {
        try {
          const raw = JSON.parse(await readFile(path.resolve(opts.targetConfig), "utf8"));
          baseTarget = mapAgentTargetToAutonomous(parseAgentTarget(raw));
        } catch (err) {
          consola.error(`--target-config: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
      } else {
        baseTarget = { name: "", endpoint: "", mode: "stateless" };
      }

      // Explicit flags override the file's fields.
      const apiKeyFromFlags =
        opts.targetKey ?? (opts.targetKeyEnv ? process.env[opts.targetKeyEnv] : undefined);
      const flagHeaders = parseHeaders(opts.header);
      const target: TargetConfig = {
        ...baseTarget,
        name: opts.name ?? baseTarget.name,
        endpoint: opts.endpoint ?? baseTarget.endpoint,
        apiKey: apiKeyFromFlags ?? baseTarget.apiKey ?? process.env.TARGET_API_KEY,
        headers: flagHeaders ?? baseTarget.headers,
        mode: opts.stateful ? "stateful" : opts.stateless ? "stateless" : baseTarget.mode,
        promptPath: opts.promptPath ?? baseTarget.promptPath,
        responsePath: opts.responsePath ?? baseTarget.responsePath,
        sessionField: opts.sessionField ?? baseTarget.sessionField,
        // --session-field overrides a structured `session` from --target-config too,
        // since resolveSessionPlan prefers session.send over the legacy field.
        session: opts.sessionField ? undefined : baseTarget.session,
        model: opts.targetModel ?? baseTarget.model,
      };
      if (target.type === "local-script") {
        if (!target.scriptPath) {
          consola.error(
            "No scriptPath: set `scriptPath` on the local-script target in --target-config."
          );
          process.exitCode = 1;
          return;
        }
      } else if (!target.endpoint) {
        consola.error("No endpoint: set --endpoint or an `endpoint` in --target-config.");
        process.exitCode = 1;
        return;
      }
      if (!target.name) {
        target.name =
          target.type === "local-script"
            ? path.basename(target.scriptPath!)
            : new URL(target.endpoint).host;
      }

      if (target.mode === "stateful" && !target.sessionField && !target.session) {
        consola.warn(
          "Stateful mode without a session id config: the target won't receive a session id."
        );
      }

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

      const header = [
        "════════════════════════════════════════════════════════════════",
        ` AUTONOMOUS RED-TEAM`,
        ` target    : ${target.name} (${target.mode})  ${target.endpoint}`,
        ` objective : ${objective}`,
        ` models    : commander=${huntOptions.commanderModel}  operator=${huntOptions.operatorModel}  scout=${huntOptions.scoutModel}`,
        ` limits    : operators≤${huntOptions.maxOperators}  turns≤${huntOptions.maxTurns}  thread-turns≤${huntOptions.maxThreadTurns}${huntOptions.budgetUsd ? `  budget=$${huntOptions.budgetUsd}` : ""}`,
        ` verifier  : ${huntOptions.verify ? "on" : "off"}`,
        "════════════════════════════════════════════════════════════════",
      ].join("\n");
      process.stdout.write(header + "\n");

      // Folder + streams are created from `onRunLog` below, before any progress event can fire.
      let reportDir = "";
      let liveLogPath = "";
      let eventLogPath = "";
      let liveLog: WriteStream | undefined;
      let eventLog: WriteStream | undefined;

      const emit = (line: string): void => {
        const stamped = `[${clock()}] ${line}`;
        process.stdout.write(stamped + "\n");
        liveLog?.write(stamped + "\n");
      };

      // Structured event trail (one JSON object per line) — machine-readable for debugging and
      // the foundation a future "opfor view" web UI consumes. Stamped with a wall-clock time.
      const emitEvent = (event: RunEvent): void => {
        if (!eventLog) return;
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
          return;
        }
      }

      const fileReporter = { onLine: emit, onEvent: emitEvent };
      const progress = uiHandle ? mergeReporters(fileReporter, uiHandle.bridge) : fileReporter;

      // First Ctrl+C aborts and finalizes a partial report; second Ctrl+C force-quits.
      const ac = new AbortController();
      let sigintCount = 0;
      const onSigint = (): void => {
        sigintCount++;
        if (sigintCount === 1) {
          consola.warn("\nCaught interrupt — stopping agents and finalizing a partial report…");
          consola.warn("Press Ctrl+C again to force quit (no report will be written).\n");
          ac.abort();
        } else {
          process.exit(130);
        }
      };
      process.on("SIGINT", onSigint);

      let report;
      try {
        report = await runAutonomous(huntOptions, {
          progress,
          signal: ac.signal,
          onRunLog: (log) => {
            reportDir = reportDirFor(huntOptions.outputDir, {
              targetName: log.targetName,
              runId: log.runId,
              startedAt: log.startedAt,
            });
            mkdirSync(reportDir, { recursive: true });
            liveLogPath = path.join(reportDir, "hunt-live.log");
            eventLogPath = path.join(reportDir, "run-events.jsonl");
            liveLog = createWriteStream(liveLogPath, { flags: "a" });
            eventLog = createWriteStream(eventLogPath, { flags: "a" });
            liveLog.write(header + "\n");
            consola.box(`Live log (tail it):\n  tail -f ${liveLogPath}`);
            uiHandle?.attachRunLog(log);
          },
        });
      } finally {
        // Stop intercepting SIGINT before the post-run UI wait installs its own handler.
        process.off("SIGINT", onSigint);
        liveLog?.end();
        eventLog?.end();
      }

      const interrupted = ac.signal.aborted;

      const { html, json, dir } = await writeAutonomousReport(report, huntOptions.outputDir);

      // `outcome` is the dashboard's final status label (rendered verbatim). On interrupt show
      // "interrupted" so a cancelled run isn't mistaken for a normal finish; otherwise show the
      // assessment verdict, which is more useful than a generic "completed".
      uiHandle?.markComplete({
        reportDir: dir,
        outcome: interrupted ? "interrupted" : report.objectiveOutcome,
      });

      consola.info("");
      if (interrupted) {
        consola.warn(`Assessment interrupted — partial report written from work completed so far.`);
      } else {
        consola.success(`Assessment complete — outcome: ${report.objectiveOutcome}`);
      }
      consola.info(
        `Vulnerabilities: ${report.summary.confirmed} · Defended: ${report.summary.defended} · Errors: ${report.summary.errors}`
      );
      if (report.totalCostUsd !== undefined)
        consola.info(`Cost: $${report.totalCostUsd.toFixed(4)}`);
      if (report.truncated && !interrupted)
        consola.warn(`Run truncated: ${report.truncationReason}`);
      consola.success(`Report: ${html}`);
      consola.info(`   JSON: ${json}`);
      consola.info(`   Dir : ${dir}`);
      consola.info(`   Live log: ${liveLogPath}`);
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
