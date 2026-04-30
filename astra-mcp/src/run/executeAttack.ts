import type { McpConnectedClient } from "../mcp/createClient.js";
import type { AttackExecutionResult } from "./types.js";
import type { AttackScenarioWithReplay } from "../attacks/planSchema.js";

async function callTool(
  mcp: McpConnectedClient,
  toolName: string,
  toolArguments: Record<string, unknown>
): Promise<{ rawToolResponse: string; toolError?: string }> {
  try {
    const result = await mcp.client.callTool({ name: toolName, arguments: toolArguments });
    return { rawToolResponse: JSON.stringify(result, null, 2) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const clean = msg.split("\n")[0].replace(/^Error:\s*/i, "").slice(0, 200);
    return { rawToolResponse: "", toolError: clean };
  }
}

export async function executeAttack(
  mcp: McpConnectedClient,
  attack: AttackScenarioWithReplay,
  overrideArguments?: Record<string, unknown>
): Promise<AttackExecutionResult> {
  const toolName = attack.suggestedToolName ?? "(none)";
  const toolArguments = overrideArguments ?? (attack.suggestedToolArguments ?? {}) as Record<string, unknown>;

  const base: Omit<AttackExecutionResult, "rawToolResponse"> = {
    attackId: attack.id,
    evaluatorId: attack.evaluatorId,
    toolName,
    toolArguments,
  };

  if (!attack.suggestedToolName) {
    return { ...base, rawToolResponse: "", toolError: "no suggestedToolName in attack" };
  }

  // Description scan: return embedded tool description without a live call
  if (toolArguments._astra_scan === "tool_description") {
    const description = String(toolArguments._tool_description ?? "(no description)");
    return {
      ...base,
      rawToolResponse: JSON.stringify({
        content: [{ type: "text", text: description }],
        _scan_mode: "tool_description",
      }),
    };
  }

  const { rawToolResponse, toolError } = await callTool(mcp, toolName, toolArguments);
  return { ...base, rawToolResponse, toolError };
}
