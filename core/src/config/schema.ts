import { z } from "zod";
import { PROVIDERS, type ProviderName } from "./types.js";

const providerValues = Object.values(PROVIDERS) as [ProviderName, ...ProviderName[]];
export const ProviderNameSchema = z.enum(providerValues);
export type { ProviderName };

export const ModelConfigSchema = z.object({
  provider: ProviderNameSchema,
  model: z.string().min(1),
  apiKeyEnv: z.string().min(1).optional(),
  baseURL: z.string().url().optional(),
});

export const McpServerStdioConfigSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).default({}),
});

export const McpServerUrlConfigSchema = z.object({
  transport: z.literal("url"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  McpServerStdioConfigSchema,
  McpServerUrlConfigSchema,
]);

export const OpforMcpConfigSchema = z.object({
  server: McpServerConfigSchema,
  generatorModel: ModelConfigSchema,
  judgeModel: ModelConfigSchema.optional(),
  /** Suite ID to use (default: "owasp-mcp-top10"). Ignored if evaluators[] is set. */
  suite: z.string().min(1).optional(),
  /** Explicit evaluator IDs. Takes priority over suite when both are set. */
  evaluators: z.array(z.string().min(1)).optional(),
  /** "single" (default) fires one attack per scenario; "multi" runs adaptive multi-turn red-teaming. */
  turnMode: z.enum(["single", "multi"]).optional(),
  /** Number of adaptive turns per attack when turnMode is "multi" (default 3). */
  turns: z.number().int().min(2).max(10).optional(),
  notes: z.string().optional(),
  /** Free-form instructions for the attacker LLM: real resource IDs, attack focus areas, known weaknesses, domain context, etc. High priority. */
  attackerInstructions: z.string().optional(),
  /** Whether to enumerate and read MCP resources during execution (default: true). */
  scanResources: z.boolean().optional(),
});

export type OpforMcpConfig = z.infer<typeof OpforMcpConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpScannerSectionSchema = OpforMcpConfigSchema;
export type McpScannerSection = z.infer<typeof McpScannerSectionSchema>;

export const OpforConfigFileV3Schema = z.object({
  mcp: McpScannerSectionSchema.optional(),
  /** Agent scan settings (`opfor setup --agent` / `opfor generate --config`) — parsed as `SetupConfigFile` in the CLI. */
  agent: z.record(z.string(), z.unknown()).optional(),
});

export type OpforConfigFileV3 = z.infer<typeof OpforConfigFileV3Schema>;

/**
 * Resolve MCP scanner settings from unified **`opfor.config.json`** (`schemaVersion: 3`, `"mcp"` section).
 */
export function extractMcpScannerConfig(raw: unknown): OpforMcpConfig {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Config must be a JSON object");
  }
  const o = raw as Record<string, unknown>;

  if (!o.mcp || typeof o.mcp !== "object") {
    throw new Error('No MCP scanner settings: add an "mcp" section (run `opfor setup --mcp`).');
  }
  const parsed = OpforMcpConfigSchema.safeParse(o.mcp);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid "mcp" section: ${msg}`);
  }
  return parsed.data;
}
