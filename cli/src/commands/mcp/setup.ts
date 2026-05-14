import path from "node:path";
import { Command } from "commander";
import { generateAttackPlan } from "../../../../core/dist/attacks/generatePlan.js";
import { loadCatalog, getEvaluatorIdSet } from "../../../../core/dist/catalog/loadCatalog.js";
import { loadEvaluatorDoc } from "../../../../core/dist/catalog/loadEvaluatorPatterns.js";
import {
  DEFAULT_OPFOR_CONFIG,
  requireOpforMcpConfig,
} from "../../../../core/dist/lib/opforConfig.js";
import { loadOpforMcpConfigFile } from "../../../../core/dist/lib/loadOpforMcpConfig.js";
import { writeJsonFile } from "../../../../core/dist/lib/jsonFile.js";
import { log } from "../../../../core/dist/lib/logger.js";
import { connectMcpClient } from "../../../../core/dist/mcp-client/createClient.js";
import type { ResourceInfo } from "../../../../core/dist/run/scanResources.js";

const DEFAULT_SUITE_ID = "owasp-mcp-top10";
const DEFAULT_ATTACK_PLAN_OUT = "opfor-mcp-attacks.json";

export async function runMcpGenerateAttackPlan(opts: {
  config?: string;
  out: string;
  maxTools?: string;
  configId?: string;
  suite?: string;
  evaluators?: string[];
  toolFilter?: boolean;
}): Promise<string> {
  const { config, out, maxTools, configId, toolFilter } = opts;

  const configPath = await requireOpforMcpConfig(config);
  log.info(`Using config: ${configPath}`);

  const cfg = await loadOpforMcpConfigFile(configPath);

  const catalog = await loadCatalog();
  const evalIds = getEvaluatorIdSet(catalog);
  log.info(`Evaluator catalog: ${catalog.evaluators.length} definitions`);

  // Priority: CLI --evaluators > CLI --suite > config evaluators > config suite > default
  const cliEvaluators = opts.evaluators;
  const cliSuite = opts.suite;
  const cfgEvaluators = cfg.evaluators;
  const cfgSuite = cfg.suite;

  let resolvedEvaluatorIds: string[];
  let resolvedSuiteId: string;

  if (cliEvaluators && cliEvaluators.length > 0) {
    // Explicit evaluator list from CLI (highest priority)
    const unknown = cliEvaluators.filter((id) => !evalIds.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown evaluator(s): ${unknown.join(", ")}. Run 'opfor list-evaluators' to see available IDs.`
      );
    }
    resolvedEvaluatorIds = cliEvaluators;
    resolvedSuiteId = "custom";
    log.success(
      `Using ${resolvedEvaluatorIds.length} evaluators (from --evaluators): ${resolvedEvaluatorIds.join(", ")}`
    );
  } else if (cliSuite) {
    // Suite from CLI flag
    const suite = catalog.suites.find((s) => s.id === cliSuite);
    if (!suite) {
      const available = catalog.suites.map((s) => s.id).join(", ");
      throw new Error(`Suite "${cliSuite}" not found. Available: ${available}`);
    }
    const missing = suite.evaluatorIds.filter((id) => !evalIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Suite "${suite.id}" references missing evaluators: ${missing.join(", ")}`);
    }
    resolvedEvaluatorIds = suite.evaluatorIds;
    resolvedSuiteId = suite.id;
    log.success(
      `Suite "${suite.id}" ready (${suite.evaluatorIds.length} evaluators: ${suite.evaluatorIds.join(", ")})`
    );
  } else if (cfgEvaluators && cfgEvaluators.length > 0) {
    // Explicit evaluator list from config
    const unknown = cfgEvaluators.filter((id: string) => !evalIds.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Config references unknown evaluator(s): ${unknown.join(", ")}. Run 'opfor list-evaluators' to see available IDs.`
      );
    }
    resolvedEvaluatorIds = cfgEvaluators;
    resolvedSuiteId = "custom";
    log.success(
      `Using ${resolvedEvaluatorIds.length} evaluators (from config): ${resolvedEvaluatorIds.join(", ")}`
    );
  } else if (cfgSuite) {
    // Suite from config
    const suite = catalog.suites.find((s) => s.id === cfgSuite);
    if (!suite) {
      const available = catalog.suites.map((s) => s.id).join(", ");
      throw new Error(`Suite "${cfgSuite}" not found. Available: ${available}`);
    }
    const missing = suite.evaluatorIds.filter((id) => !evalIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Suite "${suite.id}" references missing evaluators: ${missing.join(", ")}`);
    }
    resolvedEvaluatorIds = suite.evaluatorIds;
    resolvedSuiteId = suite.id;
    log.success(
      `Suite "${suite.id}" ready (${suite.evaluatorIds.length} evaluators: ${suite.evaluatorIds.join(", ")})`
    );
  } else {
    // Default suite
    const suite = catalog.suites.find((s) => s.id === DEFAULT_SUITE_ID);
    if (!suite) {
      throw new Error(
        `Default suite "${DEFAULT_SUITE_ID}" not found (check skills/mcp-redteaming/suites/).`
      );
    }
    const missing = suite.evaluatorIds.filter((id) => !evalIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Suite "${suite.id}" references missing evaluators: ${missing.join(", ")}`);
    }
    resolvedEvaluatorIds = suite.evaluatorIds;
    resolvedSuiteId = suite.id;
    log.success(
      `Suite "${suite.id}" ready (${suite.evaluatorIds.length} evaluators: ${suite.evaluatorIds.join(", ")})`
    );
  }

  log.start("Connecting to MCP server (stdio or URL)…");
  const mcp = await connectMcpClient(cfg.server);
  let tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  let resources: ResourceInfo[] = [];
  try {
    const listed = await mcp.client.listTools();
    tools = (listed.tools ?? []).map(
      (t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
      })
    );
    log.success(
      `tools/list: ${tools.length} tool(s) (${tools.filter((t) => t.inputSchema).length} with inputSchema)`
    );

    // Collect resource metadata for the generator (best-effort, not all servers support resources)
    try {
      const listed = await mcp.client.listResources();
      resources = (listed.resources ?? []).map(
        (r: { uri: string; name: string; description?: string; mimeType?: string }) => ({
          uri: r.uri,
          name: r.name,
          ...(r.description ? { description: r.description } : {}),
          ...(r.mimeType ? { mimeType: r.mimeType } : {}),
        })
      );
      if (resources.length > 0) {
        log.success(`resources/list: ${resources.length} resource(s)`);
      }
    } catch {
      // Server doesn't support resources
    }
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
  for (const id of resolvedEvaluatorIds) {
    evaluatorDocs.push(await loadEvaluatorDoc(id));
  }

  log.start("Generating attack plan via setup model…");
  if (cfg.turnMode === "multi") {
    log.info(`Multi-turn mode: ${cfg.turns ?? 3} adaptive turns per attack`);
  }
  const plan = await generateAttackPlan({
    cfg,
    suiteId: resolvedSuiteId,
    tools,
    evaluatorDocs,
    turns: cfg.turnMode === "multi" ? (cfg.turns ?? 3) : undefined,
    toolFilter,
    resources: resources.length > 0 ? resources : undefined,
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
    .option("-c, --config <path>", `Path to config file (default: ./${DEFAULT_OPFOR_CONFIG})`)
    .option(
      "-o, --out <path>",
      `Output path for attack plan JSON (default: ./${DEFAULT_ATTACK_PLAN_OUT})`,
      DEFAULT_ATTACK_PLAN_OUT
    )
    .option(
      "--max-tools <n>",
      "Limit to the first N tools from tools/list (useful for rate-limited LLMs)"
    )
    .option("--suite <id>", "Suite to use (overrides config; ignored if --evaluators is set)")
    .option(
      "--evaluators <ids...>",
      "Specific evaluator IDs (highest priority, overrides --suite and config)"
    )
    .option(
      "--no-tool-filter",
      "Disable automatic tool-relevance filtering (test every tool against every evaluator)"
    )
    .action(
      async (rawOpts: {
        config?: string;
        out: string;
        maxTools?: string;
        suite?: string;
        evaluators?: string[];
        toolFilter: boolean;
      }) => {
        try {
          await runMcpGenerateAttackPlan({
            config: rawOpts.config,
            out: rawOpts.out,
            maxTools: rawOpts.maxTools,
            suite: rawOpts.suite,
            evaluators: rawOpts.evaluators,
            toolFilter: rawOpts.toolFilter,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(msg);
          process.exitCode = 1;
        }
      }
    );
}
