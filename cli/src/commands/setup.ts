import type { Command } from "commander";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { select } from "@inquirer/prompts";
import { buildEmptyMcpSection, collectMcpSectionInteractive } from "./mcp/init.js";
import { buildEmptyAgentSetupConfig, collectAgentSetupConfigInteractive } from "./agent/wizard.js";
import { loadEnvFromFlag } from "../lib/env.js";
import { ensureAstraDirs, newConfigPath, newId } from "../lib/artifacts.js";
import type { UnifiedMode, UnifiedConfigFileV1 } from "../lib/unifiedConfig.js";

export async function runUnifiedSetup(opts: {
  mcp?: boolean;
  agent?: boolean;
  empty?: boolean;
  env?: string;
  out?: string;
}): Promise<string> {
  if (opts.env) loadEnvFromFlag(opts.env);
  await ensureAstraDirs();

  const wantMcp = Boolean(opts.mcp);
  const wantAgent = Boolean(opts.agent);

  let finalWantMcp = wantMcp;
  let finalWantAgent = wantAgent;
  if (!finalWantMcp && !finalWantAgent) {
    const mode = await select<UnifiedMode>({
      message: "What do you want to test?",
      choices: [
        { name: "MCP server (tools/list + tool calls)", value: "mcp" },
        { name: "AI agent / LLM target (prompt-based attacks)", value: "agent" },
      ],
    });
    finalWantMcp = mode === "mcp";
    finalWantAgent = mode === "agent";
  }

  const configId = newId();
  const createdAt = new Date().toISOString();

  const empty = Boolean(opts.empty);
  const mcpSection = finalWantMcp
    ? empty
      ? buildEmptyMcpSection()
      : await collectMcpSectionInteractive()
    : undefined;
  const agentSection = finalWantAgent
    ? empty
      ? buildEmptyAgentSetupConfig()
      : await collectAgentSetupConfigInteractive()
    : undefined;

  const outPath = path.resolve(opts.out || newConfigPath());
  await mkdir(path.dirname(outPath), { recursive: true });

  const cfg: UnifiedConfigFileV1 = {
    configId,
    createdAt,
    mode: finalWantMcp && finalWantAgent ? "both" : finalWantMcp ? "mcp" : "agent",
    ...(mcpSection ? { mcp: mcpSection as unknown as Record<string, unknown> } : {}),
    ...(agentSection ? { agent: agentSection as unknown as Record<string, unknown> } : {}),
  };

  await writeFile(outPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return outPath;
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description(
      "Interactive wizard — writes a timestamped config under .astra/configs/.\n" +
        "Use --mcp/--agent to skip mode prompt, or --empty for minimal configs."
    )
    .option("--mcp", "Create an MCP config section")
    .option("--agent", "Create an agent config section")
    .option("--empty", "Write a minimal/empty config for the chosen mode(s)")
    .option("--env <path>", "Load env vars from a dotenv file before running")
    .option("--out <path>", "Override output path (advanced)")
    .action(
      async (opts: {
        mcp?: boolean;
        agent?: boolean;
        empty?: boolean;
        env?: string;
        out?: string;
      }) => {
        const outPath = await runUnifiedSetup(opts);
        console.log(`\nConfig written:\n  ${outPath}\n`);
        const envArg = opts.env ? ` --env ${path.resolve(opts.env)}` : "";
        console.log(`Next:\n  astra generate --config ${outPath}${envArg}\n`);
      }
    );
}
