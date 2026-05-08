import path from "node:path";
import { Command } from "commander";
import { generateAttackPlan } from "../../../../core/dist/attacks/generatePlan.js";
import { loadCatalog, getEvaluatorIdSet } from "../../../../core/dist/catalog/loadCatalog.js";
import { loadEvaluatorDoc } from "../../../../core/dist/catalog/loadEvaluatorPatterns.js";
import { DEFAULT_ASTRA_CONFIG, requireAstraMcpConfig } from "../../../../core/dist/lib/astraConfig.js";
import { loadAstraMcpConfigFile } from "../../../../core/dist/lib/loadAstraMcpConfig.js";
import { writeJsonFile } from "../../../../core/dist/lib/jsonFile.js";
import { log } from "../../../../core/dist/lib/logger.js";
import { connectMcpClient } from "../../../../core/dist/mcp-client/createClient.js";

const DEFAULT_SUITE_ID = "owasp-mcp-top10";
const DEFAULT_ATTACK_PLAN_OUT = "astra-mcp-attacks.json";

export async function runMcpGenerateAttackPlan(opts: {
  config?: string;
  out: string;
  maxTools?: string;
  configId?: string;
}): Promise<string> {
  const { config, out, maxTools, configId } = opts;

  const configPath = await requireAstraMcpConfig(config);
  log.info(`Using config: ${configPath}`);

  const cfg = await loadAstraMcpConfigFile(configPath);

  const catalog = await loadCatalog();
  const evalIds = getEvaluatorIdSet(catalog);
  log.info(`Evaluator catalog: ${catalog.evaluators.length} definitions`);

  const suite = catalog.suites.find((s) => s.id === DEFAULT_SUITE_ID);
  if (!suite) {
    throw new Error(`Suite "${DEFAULT_SUITE_ID}" not found (check skills/astra-setup/suites/).`);
  }
  const missing = suite.evaluatorIds.filter((id) => !evalIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Suite "${suite.id}" references missing evaluators: ${missing.join(", ")}`);
  }
  log.success(
    `Suite "${suite.id}" ready (${suite.evaluatorIds.length} evaluators: ${suite.evaluatorIds.join(", ")})`
  );

  log.start("Connecting to MCP server (stdio or URL)…");
  const mcp = await connectMcpClient(cfg.server);
  let tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  try {
    const listed = await mcp.client.listTools();
    tools = (listed.tools ?? []).map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    }));
    log.success(
      `tools/list: ${tools.length} tool(s) (${tools.filter((t) => t.inputSchema).length} with inputSchema)`
    );
  } finally {
    await mcp.close();
  }

  if (maxTools) {
    const n = parseInt(maxTools, 10);
    if (!isNaN(n) && n > 0 && n < tools.length) {
      tools = tools.slice(0, n);
      log.info(`Limiting to first ${n} tools (--max-tools ${n})`);
    }
  }

  const evaluatorDocs = [];
  for (const id of suite.evaluatorIds) {
    evaluatorDocs.push(await loadEvaluatorDoc(id));
  }

  log.start("Generating attack plan via setup model…");
  if (cfg.turnMode === "multi") {
    log.info(`Multi-turn mode: ${cfg.turns ?? 3} adaptive turns per attack`);
  }
  const plan = await generateAttackPlan({
    cfg,
    suiteId: suite.id,
    tools,
    evaluatorDocs,
    turns: cfg.turnMode === "multi" ? (cfg.turns ?? 3) : undefined,
  });

  (plan as unknown as Record<string, unknown>).mode = "mcp";
  (plan as unknown as Record<string, unknown>).configPath = configPath;
  if (configId) (plan as unknown as Record<string, unknown>).configId = configId;
  (plan as unknown as Record<string, unknown>).generatedAt = new Date().toISOString();

  const outPath = path.resolve(out);
  await writeJsonFile(outPath, plan);
  log.success(`Wrote attack plan: ${outPath}`);
  log.info(
    "Each attack includes replay hints: curl-friendly lines for URL transports, JSON-RPC lines for stdio."
  );

  return outPath;
}

export function registerSetupCommand(program: Command) {
  program
    .command("setup")
    .description("Discover MCP tools, call the setup LLM, and write an attack plan JSON")
    .option(
      "-c, --config <path>",
      `Path to config file (default: ./${DEFAULT_ASTRA_CONFIG})`
    )
    .option(
      "-o, --out <path>",
      `Output path for attack plan JSON (default: ./${DEFAULT_ATTACK_PLAN_OUT})`,
      DEFAULT_ATTACK_PLAN_OUT
    )
    .option(
      "--max-tools <n>",
      "Limit to the first N tools from tools/list (useful for rate-limited LLMs)"
    )
    .action(async ({ config, out, maxTools }: { config?: string; out: string; maxTools?: string }) => {
      try {
        await runMcpGenerateAttackPlan({ config, out, maxTools });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(msg);
        process.exitCode = 1;
      }
    });
}
