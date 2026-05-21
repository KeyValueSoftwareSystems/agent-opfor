import path from "node:path";
import { generateAttackPlan } from "../../../../core/dist/attacks/generatePlan.js";
import { loadCatalog, getEvaluatorIdSet } from "../../../../core/dist/catalog/loadCatalog.js";
import { loadEvaluatorDoc } from "../../../../core/dist/catalog/loadEvaluatorPatterns.js";
import { loadOpforMcpConfigFile } from "../../../../core/dist/lib/loadOpforMcpConfig.js";
import { writeJsonFile } from "../../../../core/dist/lib/jsonFile.js";
import { connectMcpClient } from "../../../../core/dist/mcp-client/createClient.js";
import type { ResourceInfo } from "../../../../core/dist/run/scanResources.js";

const DEFAULT_SUITE_ID = "owasp-mcp-top10";
const DEFAULT_ATTACK_PLAN_OUT = "opfor-mcp-attacks.json";

export interface McpSetupOptions {
  configPath: string;
  outputPath?: string;
  suite?: string;
  evaluators?: string[];
  maxTools?: number;
  noToolFilter?: boolean;
}

export interface McpSetupResult {
  planPath: string;
  attackCount: number;
  evaluatorCount: number;
  toolCount: number;
  resourceCount: number;
  suiteId: string;
  serverSummary: string;
}

export async function runMcpSetup(opts: McpSetupOptions): Promise<McpSetupResult> {
  const configPath = path.resolve(opts.configPath);
  const cfg = await loadOpforMcpConfigFile(configPath);

  const catalog = await loadCatalog();
  const evalIds = getEvaluatorIdSet(catalog);

  const cliEvaluators = opts.evaluators;
  const cliSuite = opts.suite;
  const cfgEvaluators = cfg.evaluators;
  const cfgSuite = cfg.suite;

  let resolvedEvaluatorIds: string[];
  let resolvedSuiteId: string;

  if (cliEvaluators && cliEvaluators.length > 0) {
    const unknown = cliEvaluators.filter((id) => !evalIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown evaluator(s): ${unknown.join(", ")}`);
    }
    resolvedEvaluatorIds = cliEvaluators;
    resolvedSuiteId = "custom";
  } else if (cliSuite) {
    const suite = catalog.suites.find((s) => s.id === cliSuite);
    if (!suite) {
      const available = catalog.suites.map((s) => s.id).join(", ");
      throw new Error(`Suite "${cliSuite}" not found. Available: ${available}`);
    }
    resolvedEvaluatorIds = suite.evaluatorIds;
    resolvedSuiteId = suite.id;
  } else if (cfgEvaluators && cfgEvaluators.length > 0) {
    const unknown = cfgEvaluators.filter((id: string) => !evalIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Config references unknown evaluator(s): ${unknown.join(", ")}`);
    }
    resolvedEvaluatorIds = cfgEvaluators;
    resolvedSuiteId = "custom";
  } else if (cfgSuite) {
    const suite = catalog.suites.find((s) => s.id === cfgSuite);
    if (!suite) {
      const available = catalog.suites.map((s) => s.id).join(", ");
      throw new Error(`Suite "${cfgSuite}" not found. Available: ${available}`);
    }
    resolvedEvaluatorIds = suite.evaluatorIds;
    resolvedSuiteId = suite.id;
  } else {
    const suite = catalog.suites.find((s) => s.id === DEFAULT_SUITE_ID);
    if (!suite) {
      throw new Error(`Default suite "${DEFAULT_SUITE_ID}" not found.`);
    }
    resolvedEvaluatorIds = suite.evaluatorIds;
    resolvedSuiteId = suite.id;
  }

  const mcp = await connectMcpClient(cfg.server);
  let tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
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
    } catch {
      // Server doesn't support resources
    }
  } finally {
    await mcp.close();
  }

  if (opts.maxTools && opts.maxTools > 0 && opts.maxTools < tools.length) {
    tools = tools.slice(0, opts.maxTools);
  }

  const evaluatorDocs = [];
  for (const id of resolvedEvaluatorIds) {
    evaluatorDocs.push(await loadEvaluatorDoc(id));
  }

  const plan = await generateAttackPlan({
    cfg,
    suiteId: resolvedSuiteId,
    tools,
    evaluatorDocs,
    turns: cfg.turnMode === "multi" ? (cfg.turns ?? 3) : undefined,
    toolFilter: opts.noToolFilter !== true,
    resources: resources.length > 0 ? resources : undefined,
  });

  (plan as unknown as Record<string, unknown>).mode = "mcp";
  (plan as unknown as Record<string, unknown>).configPath = configPath;
  (plan as unknown as Record<string, unknown>).generatedAt = new Date().toISOString();

  const outPath = path.resolve(opts.outputPath ?? DEFAULT_ATTACK_PLAN_OUT);
  await writeJsonFile(outPath, plan);

  const serverSummary =
    cfg.server.transport === "stdio" ? `stdio: ${cfg.server.command}` : `url: ${cfg.server.url}`;

  return {
    planPath: outPath,
    attackCount: plan.attacks.length,
    evaluatorCount: resolvedEvaluatorIds.length,
    toolCount: tools.length,
    resourceCount: resources.length,
    suiteId: resolvedSuiteId,
    serverSummary,
  };
}
