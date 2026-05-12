import type { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { select } from "@inquirer/prompts";
import { loadEnvFromFlag } from "../lib/env.js";
import { ensureAstraDirs, newAttacksPath } from "../lib/artifacts.js";
import { loadUnifiedConfigFile, type UnifiedMode } from "../lib/unifiedConfig.js";
import { runUnifiedSetup } from "./setup.js";
import { runMcpGenerateAttackPlan } from "./mcp/setup.js";
import { generateAgentAttacksFromConfig } from "./agent/setup.js";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description(
      "Generate adversarial attacks from a config (writes .astra/attacks/...).\n" +
        "If no --config is provided, starts from `astra setup`."
    )
    .option("--config <path>", "Path to a config file (if omitted, runs setup first)")
    .option("--env <path>", "Load env vars from a dotenv file before running")
    .option("--out <path>", "Override output path for attacks JSON (advanced)")
    .option("--mcp", "Force MCP mode (useful when config contains both blocks)")
    .option("--agent", "Force agent mode (useful when config contains both blocks)")
    .option("--suite <id>", "Suite to use (overrides config; ignored if --evaluators is set)")
    .option(
      "--evaluators <ids...>",
      "Specific evaluator IDs to run (highest priority, overrides --suite and config)"
    )
    .option("--no-tool-filter", "Disable automatic tool-relevance filtering")
    .action(
      async (opts: {
        config?: string;
        env?: string;
        out?: string;
        mcp?: boolean;
        agent?: boolean;
        suite?: string;
        evaluators?: string[];
        toolFilter: boolean;
      }) => {
        if (opts.env) loadEnvFromFlag(opts.env);
        await ensureAstraDirs();

        let configPath = opts.config ? path.resolve(opts.config) : "";
        if (!configPath) {
          configPath = await runUnifiedSetup({ env: opts.env });
        }

        const cfg = await loadUnifiedConfigFile(configPath);

        const forcedMode: UnifiedMode | null = opts.mcp ? "mcp" : opts.agent ? "agent" : null;

        let mode: UnifiedMode;
        if (forcedMode) {
          mode = forcedMode;
        } else if (cfg.mode === "mcp" || cfg.mode === "agent") {
          mode = cfg.mode;
        } else if (cfg.mcp && !cfg.agent) {
          mode = "mcp";
        } else if (cfg.agent && !cfg.mcp) {
          mode = "agent";
        } else {
          mode = await select<UnifiedMode>({
            message:
              "Config contains both MCP and agent settings. Which mode should we generate attacks for?",
            choices: [
              { name: "MCP", value: "mcp" },
              { name: "Agent", value: "agent" },
            ],
          });
        }

        const outPath = path.resolve(opts.out || newAttacksPath(cfg.configId));

        if (mode === "mcp") {
          await runMcpGenerateAttackPlan({
            config: configPath,
            out: outPath,
            configId: cfg.configId,
            suite: opts.suite,
            evaluators: opts.evaluators,
            toolFilter: opts.toolFilter,
          });
        } else {
          await generateAgentAttacksFromConfig({
            configPath,
            outputPath: outPath,
            configId: cfg.configId,
          });
        }

        // Ensure the file exists (best-effort sanity check)
        await readFile(outPath, "utf8");

        console.log(`\nAttacks written:\n  ${outPath}\n`);
        const envArg = opts.env ? ` --env ${path.resolve(opts.env)}` : "";
        console.log(`Next:\n  astra run --attacks ${outPath}${envArg}\n`);
      }
    );
}
