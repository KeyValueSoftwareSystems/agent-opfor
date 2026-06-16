// Local Express server for the live autonomous run dashboard (SSE + REST).

import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exec, spawn } from "node:child_process";
import express from "express";
import type { RunLog } from "../state/runLog.js";
import { UiBridge, type SseClient } from "./bridge.js";
import type { SnapshotMeta } from "./snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface UiServerOptions {
  port: number;
  meta: SnapshotMeta;
  openBrowser?: boolean;
  setupMode?: boolean;
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
    path.join(process.cwd(), "runners", "autonomous", "dist", "ui-static"),
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
  let runProcess: ReturnType<typeof spawn> | null = null;

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/state", (_req, res) => {
    res.json(bridge.snapshot());
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
    app.post("/api/start", (req, res) => {
      if (runProcess) {
        res.status(400).json({ error: "A run is already in progress" });
        return;
      }

      const config = req.body as Record<string, string>;
      const args: string[] = ["auto"];

      if (config.endpoint) args.push("--endpoint", config.endpoint);
      if (config.targetModel) args.push("--target-model", config.targetModel);
      if (config.targetName) args.push("--name", config.targetName);
      if (config.objective) args.push("--objective", config.objective);
      if (config.commanderModel) args.push("--model", config.commanderModel);
      if (config.operatorModel) args.push("--operator-model", config.operatorModel);
      if (config.scoutModel) args.push("--scout-model", config.scoutModel);
      if (config.maxAttackers) args.push("--max-attackers", config.maxAttackers);
      if (config.maxTurns) args.push("--max-turns", config.maxTurns);
      if (config.maxThreadTurns) args.push("--max-thread-turns", config.maxThreadTurns);
      if (config.budgetUsd) args.push("--budget-usd", config.budgetUsd);

      // Find the CLI entry point
      const cliPath = path.join(__dirname, "..", "index.js");

      // Set up environment
      const env = { ...process.env };
      if (config.apiKey) {
        env.TARGET_API_KEY = config.apiKey;
      }

      bridge.onLine("Starting assessment from UI…");
      bridge.setMeta({
        objective: config.objective,
        targetName: config.targetName || new URL(config.endpoint || "").hostname,
        targetEndpoint: config.endpoint,
        budgetUsd: config.budgetUsd ? parseFloat(config.budgetUsd) : undefined,
        commanderModel: config.commanderModel,
        operatorModel: config.operatorModel,
        scoutModel: config.scoutModel,
      });

      runProcess = spawn("node", [cliPath, ...args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      runProcess.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          bridge.onLine(line);
        }
      });

      runProcess.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          bridge.onLine(`[stderr] ${line}`);
        }
      });

      runProcess.on("close", (code) => {
        bridge.onLine(`Assessment process exited with code ${code}`);
        bridge.markComplete({ outcome: code === 0 ? "completed" : "failed" });
        runProcess = null;
      });

      res.json({ ok: true, message: "Assessment started" });
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
      if (runProcess) {
        runProcess.kill();
      }
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
