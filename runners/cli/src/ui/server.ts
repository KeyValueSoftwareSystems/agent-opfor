// Local Express server for the live autonomous run dashboard (SSE + REST).

import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import express from "express";
import type { RunLog } from "@keyvaluesystems/agent-opfor-core/autonomous/state/runLog.js";
import type {
  HuntOptions,
  TargetConfig,
  TargetMode,
} from "@keyvaluesystems/agent-opfor-core/autonomous/lib/types.js";
import type { RunEvent } from "@keyvaluesystems/agent-opfor-core/autonomous/state/observe.js";
import { UiBridge, type SseClient } from "./bridge.js";
import type { SnapshotMeta } from "./snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface InitialConfig {
  endpoint?: string;
  model?: string;
  targetName?: string;
  objective?: string;
  apiKeyEnv?: string;
  commanderModel?: string;
  operatorModel?: string;
  scoutModel?: string;
  maxOperators?: string;
  maxTurns?: string;
  maxThreadTurns?: string;
  budgetUsd?: string;
}

export interface UiServerOptions {
  port: number;
  meta: SnapshotMeta;
  openBrowser?: boolean;
  setupMode?: boolean;
  initialConfig?: InitialConfig;
  /** Called for each log line - use to stream to terminal */
  onLog?: (line: string) => void;
  /** Called when the run completes or fails - use to exit the process */
  onComplete?: (result: { success: boolean; error?: string; reportDir?: string }) => void;
}

export interface UiServerHandle {
  bridge: UiBridge;
  port: number;
  url: string;
  attachRunLog: (runLog: RunLog) => void;
  markComplete: (payload: { reportDir?: string; outcome?: string }) => void;
  close: () => Promise<void>;
}

function resolveStaticDir(): string {
  const candidates = [
    path.join(__dirname, "..", "ui-static"),
    path.join(__dirname, "..", "..", "ui-static"),
    path.join(process.cwd(), "dist", "ui-static"),
  ];
  for (const dir of candidates) {
    const index = path.join(dir, "index.html");
    if (existsSync(index)) return dir;
  }
  return path.join(__dirname, "..", "ui-static");
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

export async function startUiServer(options: UiServerOptions): Promise<UiServerHandle> {
  const app = express();
  const bridge = new UiBridge();
  bridge.setMeta(options.meta);
  const staticDir = resolveStaticDir();

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/state", (_req, res) => {
    res.json(bridge.snapshot());
  });

  // Return initial config from CLI flags for setup page prefill
  app.get("/api/initial-config", (_req, res) => {
    res.json(options.initialConfig ?? {});
  });

  app.get("/api/lines", (_req, res) => {
    res.json({ lines: bridge.getRecentLines() });
  });

  app.get("/api/state/threads/:threadId", (req, res) => {
    const state = bridge.snapshot();
    const thread = state.threads.find((t) => t.threadId === req.params.threadId);
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }
    res.json(thread);
  });

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const client: SseClient = {
      send(payload) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      },
      close() {
        res.end();
      },
    };

    bridge.registerClient(client);
    req.on("close", () => bridge.unregisterClient(client));

    const heartbeat = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);
    req.on("close", () => clearInterval(heartbeat));
  });

  // Setup mode: start a run from the UI
  if (options.setupMode) {
    let runningAssessment = false;

    app.post("/api/start", async (req, res) => {
      if (runningAssessment) {
        res.status(400).json({ error: "A run is already in progress" });
        return;
      }

      const config = req.body as Record<string, string>;

      if (!config.endpoint) {
        res.status(400).json({ error: "Endpoint URL is required" });
        return;
      }
      if (!config.objective) {
        res.status(400).json({ error: "Objective is required" });
        return;
      }

      runningAssessment = true;

      // Resolve API key from env var
      const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : process.env.TARGET_API_KEY;

      const mode: TargetMode = "stateless";
      const targetName = config.targetName || new URL(config.endpoint).hostname;

      const target: TargetConfig = {
        name: targetName,
        endpoint: config.endpoint,
        apiKey,
        headers: {},
        mode,
        model: config.model || undefined,
      };

      const intOr = (val: string | undefined, fallback: number): number => {
        if (!val) return fallback;
        const n = parseInt(val, 10);
        return Number.isNaN(n) ? fallback : n;
      };

      // Resolve model aliases to full model IDs from env vars if available
      const resolveModel = (alias: string | undefined, fallback: string): string => {
        const a = alias || fallback;
        switch (a) {
          case "haiku":
            return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "haiku";
          case "sonnet":
            return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "sonnet";
          case "opus":
            return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "opus";
          default:
            return a;
        }
      };

      const autoOptions: HuntOptions = {
        target,
        objective: config.objective,
        commanderModel: resolveModel(config.commanderModel, "sonnet"),
        operatorModel: resolveModel(config.operatorModel, "sonnet"),
        scoutModel: resolveModel(config.scoutModel, "haiku"),
        maxOperators: intOr(config.maxOperators, 3),
        maxTurns: intOr(config.maxTurns, 50),
        maxThreadTurns: intOr(config.maxThreadTurns, 8),
        maxTotalThreads: 40,
        maxForksPerThread: 4,
        maxDepth: 3,
        maxLeadsPerWave: 4,
        maxReconProbes: 8,
        budgetUsd: config.budgetUsd ? parseFloat(config.budgetUsd) : 2,
        verify: false,
        sequential: false,
        persistInventions: false,
        outputDir: path.resolve(".opfor/reports"),
      };

      bridge.onLine("Starting assessment from UI…");
      bridge.setMeta({
        objective: config.objective,
        targetName,
        targetEndpoint: config.endpoint,
        budgetUsd: autoOptions.budgetUsd,
        commanderModel: autoOptions.commanderModel,
        operatorModel: autoOptions.operatorModel,
        scoutModel: autoOptions.scoutModel,
      });

      res.json({ ok: true, message: "Assessment started" });

      // Run the assessment in-process (async, don't await in handler)
      runAssessmentInProcess(autoOptions, bridge, options.onLog)
        .then((reportDir) => {
          options.onComplete?.({ success: true, reportDir });
        })
        .catch((err) => {
          const errorMsg = String(err);
          console.error("[UI Server] Assessment error:", err);
          bridge.onLine(`[ERROR] ${errorMsg}`);
          bridge.markComplete({ outcome: "failed" });
          options.onComplete?.({ success: false, error: errorMsg });
        })
        .finally(() => {
          runningAssessment = false;
        });
    });
  }

  app.use(express.static(staticDir));

  app.use((_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : options.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = options.setupMode ? `${baseUrl}?setup=1` : baseUrl;

  if (options.openBrowser !== false) {
    openInBrowser(url);
  }

  return {
    bridge,
    port,
    url,
    attachRunLog(runLog: RunLog) {
      bridge.attachRunLog(runLog, options.meta);
    },
    markComplete(payload) {
      bridge.markComplete(payload);
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** Run the autonomous assessment in-process, wired to the UI bridge. */
async function runAssessmentInProcess(
  autoOptions: HuntOptions,
  bridge: UiBridge,
  onLog?: (line: string) => void
): Promise<string | undefined> {
  const { runAutonomous } =
    await import("@keyvaluesystems/agent-opfor-core/autonomous/orchestrator/run.js");
  const { writeAutonomousReport } =
    await import("@keyvaluesystems/agent-opfor-core/autonomous/report/writeReport.js");

  // Set up output directory and log files
  await mkdir(autoOptions.outputDir, { recursive: true });
  const startedAt = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const liveLogPath = path.join(autoOptions.outputDir, `hunt-live-${startedAt}.log`);
  const liveLog: WriteStream = createWriteStream(liveLogPath, { flags: "a" });
  const eventLogPath = path.join(autoOptions.outputDir, `run-${startedAt}.jsonl`);
  const eventLog: WriteStream = createWriteStream(eventLogPath, { flags: "a" });

  const clock = () => new Date().toISOString().slice(11, 19);

  const emit = (line: string): void => {
    const stamped = `[${clock()}] ${line}`;
    liveLog.write(stamped + "\n");
    bridge.onLine(line);
    // Also stream to terminal
    onLog?.(stamped);
  };

  const emitEvent = (event: RunEvent): void => {
    try {
      eventLog.write(JSON.stringify({ ...event, wall: clock() }) + "\n");
    } catch {
      // Ignore serialization errors
    }
    bridge.onEvent(event);
  };

  emit(`Starting autonomous assessment against ${autoOptions.target.name}`);
  emit(`Objective: ${autoOptions.objective}`);

  let reportDir: string | undefined;

  try {
    const report = await runAutonomous(autoOptions, {
      progress: { onLine: emit, onEvent: emitEvent },
      onRunLog: (runLog) => {
        bridge.attachRunLog(runLog, {
          objective: autoOptions.objective,
          targetName: autoOptions.target.name,
          targetEndpoint: autoOptions.target.endpoint,
          budgetUsd: autoOptions.budgetUsd,
          commanderModel: autoOptions.commanderModel,
          operatorModel: autoOptions.operatorModel,
          scoutModel: autoOptions.scoutModel,
        });
      },
    });

    emit("Run completed, writing report…");
    const reportFiles = await writeAutonomousReport(report, autoOptions.outputDir);
    reportDir = reportFiles.dir;
    emit(`Report written to ${reportDir}`);

    bridge.markComplete({ reportDir, outcome: "completed" });
  } finally {
    liveLog.end();
    eventLog.end();
  }

  return reportDir;
}
