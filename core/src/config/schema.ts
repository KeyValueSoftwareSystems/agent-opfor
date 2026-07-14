import { z } from "zod";
import { PROVIDERS, type ProviderName } from "./types.js";

const providerValues = Object.values(PROVIDERS) as [ProviderName, ...ProviderName[]];
export const ProviderNameSchema = z.enum(providerValues);
export type { ProviderName };

/**
 * Single source of truth for an LLM endpoint config. This is the zod-inferred
 * `LlmConfig` used everywhere — the agent run path (`RunConfig.attackerLlm`/`judgeLlm`)
 * AND the MCP path (`mcp.generatorModel`/`judgeModel`). The former hand-written
 * `LlmConfig` interface (config/types.ts) and the `ModelConfig`/`resolveModelConfig`
 * bridge have been collapsed into this one schema.
 *
 * `apiKeyEnv` is DELIBERATELY optional: the MCP/openai-compatible path resolves the
 * key lazily and falls back to a provider default, so requiring it here would reject
 * configs that work today. Presence is enforced at use time by `validateLlmConfig`
 * and `createModel` (which throw with an actionable message when a key is needed).
 */
export const LlmConfigSchema = z.object({
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
  generatorModel: LlmConfigSchema,
  judgeModel: LlmConfigSchema.optional(),
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
/** The one canonical LLM config type. Re-exported from config/types.js for back-compat. */
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpScannerSectionSchema = OpforMcpConfigSchema;
export type McpScannerSection = z.infer<typeof McpScannerSectionSchema>;

export const OpforConfigFileV3Schema = z.object({
  mcp: McpScannerSectionSchema.optional(),
  /** Agent scan settings (`opfor setup --agent` / `opfor run --config`) — parsed as `SetupConfigFile` in the CLI. */
  agent: z.record(z.string(), z.unknown()).optional(),
});

export type OpforConfigFileV3 = z.infer<typeof OpforConfigFileV3Schema>;

// ---------------------------------------------------------------------------
// RunConfig validation — the shape `opfor run --config <file>` parses.
// Previously this was a bare `JSON.parse(raw) as RunConfig` cast with no runtime
// check (the agent path had no validation, unlike the MCP path). These schemas
// validate the hand-editable entry point. They are intentionally lenient
// (`.passthrough()`, optional `effort`/`turns`) so that extra or legacy fields and
// downstream-normalized values are not rejected — the goal is to catch genuine
// structural mistakes (missing target, wrong types, bad enums), not to re-encode
// every field of the ~450-line config/types.ts.
// ---------------------------------------------------------------------------

const AgentTargetConfigSchema = z
  .object({
    kind: z.literal("agent"),
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(["http-endpoint", "local-script"]),
    endpoint: z.string().optional(),
    requestFormat: z.enum(["auto", "openai", "json"]).optional(),
    apiKeyEnv: z.string().optional(),
    model: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    sessionIdField: z.string().optional(),
    session: z
      .object({
        send: z.object({ in: z.enum(["body", "header"]), name: z.string().min(1) }),
        receive: z
          .union([
            z.object({ in: z.enum(["body", "header"]), name: z.string().min(1) }),
            z.object({ in: z.literal("set-cookie"), name: z.string().optional() }),
          ])
          .optional(),
      })
      .optional(),
    promptPath: z.string().optional(),
    responsePath: z.string().optional(),
    scriptPath: z.string().optional(),
    stateful: z.boolean().optional(),
  })
  .passthrough();

const McpTargetConfigSchema = z
  .object({
    kind: z.literal("mcp"),
    name: z.string().min(1),
    description: z.string().optional(),
    transport: z.enum(["stdio", "url"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    urlHeaders: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const dependsOnSchema = z.record(z.string(), z.array(z.string())).optional();

const EvaluatorSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("suite"), suite: z.string().min(1), dependsOn: dependsOnSchema }),
  z.object({
    mode: z.literal("evaluators"),
    evaluators: z.array(z.string().min(1)).min(1),
    dependsOn: dependsOnSchema,
  }),
  // `preloaded` carries in-memory EvaluatorSpec objects (browser/SDK paths); it never
  // originates from a hand-edited file, so the array contents are left unchecked here.
  z.object({
    mode: z.literal("preloaded"),
    evaluators: z.array(z.unknown()),
    dependsOn: dependsOnSchema,
  }),
]);

export const RunConfigSchema = z
  .object({
    target: z.discriminatedUnion("kind", [AgentTargetConfigSchema, McpTargetConfigSchema]),
    selection: EvaluatorSelectionSchema,
    attackerLlm: LlmConfigSchema,
    judgeLlm: LlmConfigSchema.optional(),
    // Lenient: run.ts coerces via normalizeEffort(), accepting legacy values.
    effort: z.string().optional(),
    turnMode: z.enum(["single", "multi"]).optional(),
    turns: z.number().int().positive().optional(),
    telemetry: z.unknown().optional(),
    attackObjective: z.string().optional(),
    judgeHint: z.string().optional(),
    businessUseCase: z.string().optional(),
  })
  .passthrough();

/**
 * Validate a parsed `opfor run --config` object. Throws with an actionable,
 * path-prefixed message on failure (mirrors `extractMcpScannerConfig`). The
 * returned value is the validated object; callers narrow it to their `RunConfig`
 * TS type (effort is normalized downstream).
 */
export function parseRunConfig(raw: unknown): z.infer<typeof RunConfigSchema> {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Config must be a JSON object");
  }
  const parsed = RunConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config: ${msg}`);
  }
  return parsed.data;
}

/**
 * Validate a standalone agent `target` block (bare object or a `{ target: {...} }`
 * wrapper, so an existing run config file is accepted). Used by `opfor hunt
 * --target-config`.
 */
export function parseAgentTarget(raw: unknown): z.infer<typeof AgentTargetConfigSchema> {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Target config must be a JSON object");
  }
  const candidate =
    "target" in (raw as Record<string, unknown>) ? (raw as Record<string, unknown>).target : raw;
  const parsed = AgentTargetConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid target config: ${msg}`);
  }
  return parsed.data;
}

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
