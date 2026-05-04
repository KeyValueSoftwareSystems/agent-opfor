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

/**
 * Send a tools/call JSON-RPC request with NO authentication headers.
 * Used by the missing-authentication evaluator to test unauthenticated access.
 * Bypasses the MCP SDK client (which requires an authenticated handshake) and
 * posts raw JSON-RPC directly to the server URL.
 */
async function callToolUnauthenticated(
  serverUrl: string,
  toolName: string,
  toolArguments: Record<string, unknown>
): Promise<{ rawToolResponse: string; toolError?: string }> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: toolArguments },
    });
    const res = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        rawToolResponse: JSON.stringify({
          content: [{ type: "text", text: `HTTP ${res.status}: ${text.slice(0, 300)}` }],
          isError: true,
        }),
      };
    }
    // SSE stream: extract first data: line
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    const json = dataLine ? dataLine.slice(5).trim() : text;
    const parsed = JSON.parse(json) as { result?: unknown; error?: { message?: string } };
    if (parsed.error) {
      return {
        rawToolResponse: JSON.stringify({
          content: [{ type: "text", text: parsed.error.message ?? "JSON-RPC error" }],
          isError: true,
        }),
      };
    }
    return { rawToolResponse: JSON.stringify(parsed.result, null, 2) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rawToolResponse: "", toolError: msg.slice(0, 200) };
  }
}

export async function executeAttack(
  mcp: McpConnectedClient,
  attack: AttackScenarioWithReplay,
  overrideArguments?: Record<string, unknown>,
  unauthServerUrl?: string
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

  if (unauthServerUrl && attack.evaluatorId === "missing-authentication") {
    const { rawToolResponse, toolError } = await callToolUnauthenticated(unauthServerUrl, toolName, toolArguments);
    return { ...base, rawToolResponse, toolError };
  }

  const { rawToolResponse, toolError } = await callTool(mcp, toolName, toolArguments);
  return { ...base, rawToolResponse, toolError };
}
