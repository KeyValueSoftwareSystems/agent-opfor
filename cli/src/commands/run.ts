import type { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { select } from "@inquirer/prompts";
import { loadEnvFromFlag } from "../lib/env.js";
import { ensureAstraDirs, ASTRA_REPORTS_DIR, newAttacksPath } from "../lib/artifacts.js";
import { loadUnifiedConfigFile, type UnifiedMode } from "../lib/unifiedConfig.js";
import { runUnifiedSetup } from "./setup.js";
import { runMcpAttackPlan } from "./mcp/run.js";
import { runAgentAttacksFromFile } from "./agent/run.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description(
      "Run an Astra scan.\n" +
        "If --attacks is provided, runs it. If only --config is provided, generates then runs. If neither, starts from setup."
    )
    .option("--config <path>", "Path to a config file")
    .option("--attacks <path>", "Path to an attacks/prompts JSON file")
    .option("--env <path>", "Load env vars from a dotenv file before running")
    .option("--mcp", "Force MCP mode (when ambiguous)")
    .option("--agent", "Force agent mode (when ambiguous)")
    .option(
      "--out-dir <path>",
      `Report output directory (default: ${ASTRA_REPORTS_DIR})`,
      ASTRA_REPORTS_DIR
    )
    .action(
      async (opts: {
        config?: string;
        attacks?: string;
        env?: string;
        mcp?: boolean;
        agent?: boolean;
        outDir?: string;
      }) => {
        if (opts.env) loadEnvFromFlag(opts.env);
        await ensureAstraDirs();

        const forcedMode: UnifiedMode | null = opts.mcp ? "mcp" : opts.agent ? "agent" : null;

        let attacksPath = opts.attacks ? path.resolve(opts.attacks) : "";
        let configPath = opts.config ? path.resolve(opts.config) : "";

        if (!attacksPath && !configPath) {
          configPath = await runUnifiedSetup({ env: opts.env });
        }

        // If we only have a config, attempt to find attacks for it; otherwise generate.
        if (!attacksPath && configPath) {
          const cfg = await loadUnifiedConfigFile(configPath);

          const { runMcpGenerateAttackPlan } = await import("./mcp/setup.js");
          const { generateAgentAttacksFromConfig } = await import("./agent/setup.js");

          let mode: UnifiedMode;
          if (forcedMode) mode = forcedMode;
          else if (cfg.mode === "mcp" || cfg.mode === "agent") mode = cfg.mode;
          else if (cfg.mcp && !cfg.agent) mode = "mcp";
          else if (cfg.agent && !cfg.mcp) mode = "agent";
          else {
            mode = await select<UnifiedMode>({
              message: "Config contains both MCP and agent settings. Which mode should we run?",
              choices: [
                { name: "MCP", value: "mcp" },
                { name: "Agent", value: "agent" },
              ],
            });
          }

          attacksPath = path.resolve(newAttacksPath(cfg.configId));

          if (mode === "mcp") {
            await runMcpGenerateAttackPlan({
              config: configPath,
              out: attacksPath,
              configId: cfg.configId,
            });
          } else {
            await generateAgentAttacksFromConfig({
              configPath,
              outputPath: attacksPath,
              configId: cfg.configId,
            });
          }
        }

        if (!attacksPath) {
          throw new Error("No attacks file could be resolved or generated.");
        }

        // Infer mode from attacks file content
        const raw = await readFile(attacksPath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        let mode: UnifiedMode | null =
          forcedMode || (parsed.mode === "mcp" ? "mcp" : parsed.mode === "agent" ? "agent" : null);

        if (!mode) {
          // Heuristic: MCP plans have "attacks" and "suiteId" and "server"; agent prompts have "llm" and "target"
          if (parsed.server && parsed.suiteId) mode = "mcp";
          else if (parsed.llm && parsed.target) mode = "agent";
        }
        if (!mode) {
          mode = await select<UnifiedMode>({
            message: "Unable to infer mode from attacks file. Which mode should we run?",
            choices: [
              { name: "MCP", value: "mcp" },
              { name: "Agent", value: "agent" },
            ],
          });
        }

        const resolvedOutDir = path.resolve(opts.outDir || ASTRA_REPORTS_DIR);

        if (mode === "mcp") {
          await runMcpAttackPlan({ input: attacksPath, outDir: resolvedOutDir });
        } else {
          const paths = await runAgentAttacksFromFile({
            input: attacksPath,
            outputDir: resolvedOutDir,
          });
          console.log(`\nReports:`);
          console.log(`  HTML: ${paths.html}`);
          console.log(`  JSON: ${paths.json}\n`);
        }
      }
    );
}
