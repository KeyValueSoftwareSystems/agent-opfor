import { z } from "zod";
import type { EvaluatorDoc } from "../catalog/loadEvaluatorPatterns.js";
import type { AstraMcpConfig } from "../config/schema.js";
import { chatCompletionJsonContent } from "../llm/openaiCompatible.js";
import { AttackScenarioSchema, type AttackPlanWritten } from "./planSchema.js";
import { attachReplayHints } from "./replayArtifacts.js";

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function toolsDigest(tools: ToolInfo[]) {
  return tools.map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
  }));
}

export async function generateAttackPlan(args: {
  cfg: AstraMcpConfig;
  suiteId: string;
  tools: ToolInfo[];
  evaluatorDocs: EvaluatorDoc[];
  turns?: number;
}): Promise<AttackPlanWritten> {
  const transport = args.cfg.server.transport;
  const serverSummary =
    transport === "stdio"
      ? `stdio: command=${args.cfg.server.command} args=${JSON.stringify(args.cfg.server.args)}`
      : `url: ${args.cfg.server.url}`;

  const evaluatorBlocks = args.evaluatorDocs
    .map((d) => {
      const patterns = d.patterns
        .map((p) => `  - (${p.name}): ${p.template.replace(/\s+/g, " ").slice(0, 600)}`)
        .join("\n");
      return `Evaluator ${d.id} (${d.name}):\n${patterns || "  (no patterns)"}`;
    })
    .join("\n\n");

  const toolNames = args.tools.map((t) => t.name);
  const evalIds = args.evaluatorDocs.map((d) => d.id);
  const requiredCombinations = evalIds.flatMap((ev) => toolNames.map((t) => `${ev} × ${t}`)).join(", ");

  const system = [
    "You are a security red-team expert specializing in MCP (Model Context Protocol) server vulnerabilities.",
    "Return ONLY valid JSON (no markdown, no explanation) matching this exact shape:",
    '{"attacks":[{"id":"string","evaluatorId":"string","patternName":"string|null","summary":"string","suggestedToolName":"string|null","suggestedToolArguments":{}}]}',
    "",
    "COVERAGE REQUIREMENT — THIS IS MANDATORY:",
    `- You MUST generate at least one attack for EVERY combination of (evaluator × tool).`,
    `- Required combinations (${evalIds.length} evaluators × ${toolNames.length} tools = ${evalIds.length * toolNames.length} minimum attacks):`,
    `  ${requiredCombinations}`,
    `- If an evaluator does not naturally apply to a tool, still generate a probing attack for that combination.`,
    `- Maximum total attacks = ${Math.max(60, evalIds.length * toolNames.length * 2)}.`,
    "",
    "OTHER RULES:",
    "- Each attack must map to one evaluatorId from the provided list.",
    "- suggestedToolName must exactly match a name from the TOOLS list.",
    "- suggestedToolArguments must be a valid JSON object whose keys match the tool's inputSchema — use ADVERSARIAL values.",
    "- id must be unique: use format evaluatorId-toolName-N (e.g. secret-exposure-netra_query_traces-1).",
    "- Keep summaries concise (1 sentence describing what the attack tests).",
    "",
    "ADVERSARIAL ARGUMENT STRATEGIES (pick the most relevant for each tool):",
    "1. INJECTION: pass filter value strings like \"' OR 1=1--\" or \"{$gt:''}\" as plain string literals",
    "2. ENUMERATION: use realistic UUIDs like \"00000000-0000-0000-0000-000000000001\" to test tenant isolation",
    "3. DATA DUMP: use maximum time ranges (startTime: \"2020-01-01T00:00:00Z\", endTime: \"2030-12-31T23:59:59Z\") with limit: 100",
    "4. CONFLICTING INPUTS: for tools with mutually exclusive params (e.g. session_id + trace_id), provide both simultaneously",
    "5. OVERSIZED STRING: use a literal long string — e.g. \"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\" — NEVER use code like repeat() or any function calls",
    "6. BOUNDARY VALUES: empty strings \"\", negative numbers -1, or strings with special chars like \"<script>alert(1)</script>\" or \"; DROP TABLE--\"",
    "7. PII HARVEST: for trace/observability tools, use wide time ranges and has_pii filter to find traces containing sensitive data",
    "8. FILTER BYPASS: use is_null or is_not_null operators to extract records where sensitive fields exist",
    "",
    "STRICT JSON OUTPUT RULES (any violation makes the output unusable):",
    "- Output ONLY a JSON object. No markdown, no prose, no code blocks.",
    "- Every value must be a literal JSON value: string, number, boolean, array, or object.",
    "- NEVER write JavaScript expressions. FORBIDDEN: 'a'.repeat(500), Math.random(), Date.now(), or any function call.",
    "- Oversized strings must be typed out literally as a long string of characters.",
    "- Escape special chars inside strings: use \\\" for a quote, \\\\ for backslash.",
    "- Use double quotes only — no single quotes anywhere in the JSON.",
  ].join("\n");

  const user = [
    `SUITE_ID: ${args.suiteId}`,
    `TRANSPORT: ${transport}`,
    `SERVER: ${serverSummary}`,
    "",
    "TOOLS (name, description, inputSchema):",
    JSON.stringify(toolsDigest(args.tools), null, 2),
    "",
    "EVALUATOR PATTERNS:",
    evaluatorBlocks,
  ].join("\n");

  const raw = await chatCompletionJsonContent({
    model: args.cfg.models.setup,
    system,
    user,
  });

  let parsedInner: { attacks?: unknown };
  try {
    parsedInner = JSON.parse(raw) as { attacks?: unknown };
  } catch (firstErr) {
    // Log a window around the error position to diagnose
    const posMatch = String(firstErr).match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      const snippet = raw.slice(Math.max(0, pos - 60), pos + 60);
      throw new Error(`LLM JSON parse failed at position ${pos}.\nContext: ...${JSON.stringify(snippet)}...\nFull error: ${firstErr}`);
    }
    throw firstErr;
  }

  const attacksUnknown = parsedInner.attacks;
  if (!Array.isArray(attacksUnknown)) {
    throw new Error("LLM JSON missing attacks[]");
  }

  const parsedAttacks = z.array(AttackScenarioSchema).parse(attacksUnknown);
  const multiTurn = args.turns && args.turns > 1;
  const attacks = multiTurn
    ? parsedAttacks.map((a) => ({ ...a, turns: args.turns }))
    : parsedAttacks;

  // Inject description-scan attacks programmatically for tool-description-scan evaluator.
  // These don't need the LLM — they embed the real tool description for static analysis.
  const hasScanEvaluator = args.evaluatorDocs.some((d) => d.id === "tool-description-scan");
  const descriptionScanAttacks = hasScanEvaluator
    ? args.tools.map((tool) => ({
        id: `tool-description-scan-${tool.name}-1`,
        evaluatorId: "tool-description-scan",
        patternName: "Hidden Instruction Scan",
        summary: `Inspect the description of tool ${tool.name} for hidden LLM directives`,
        suggestedToolName: tool.name,
        suggestedToolArguments: {
          _astra_scan: "tool_description",
          _tool_description: tool.description ?? "(no description)",
          _tool_name: tool.name,
        } as Record<string, unknown>,
      }))
    : [];

  const allAttacks = [
    ...attacks.map((a) => attachReplayHints(a, args.cfg.server)),
    ...descriptionScanAttacks.map((a) => attachReplayHints(a, args.cfg.server)),
  ];

  const plan: AttackPlanWritten = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    transport,
    suiteId: args.suiteId,
    serverSummary,
    toolsDigest: toolsDigest(args.tools),
    attacks: allAttacks,
  };

  return plan;
}
