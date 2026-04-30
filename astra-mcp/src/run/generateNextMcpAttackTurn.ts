import type { ModelConfig } from "../config/schema.js";
import { chatCompletionJsonContent } from "../llm/openaiCompatible.js";

export interface ToolCallTurn {
  toolName: string;
  toolArguments: Record<string, unknown>;
  rawToolResponse: string;
  toolError?: string;
}

const ATTACKER_SYSTEM = `You are an authorized AI red team researcher conducting a controlled security evaluation of an MCP (Model Context Protocol) server.

Given prior tool call attempts and their responses, generate new tool call arguments that escalate toward the attack goal. Be adaptive — learn from what the server returned and craft arguments that are more likely to expose a vulnerability.

Respond with ONLY a valid JSON object of tool arguments. No explanation, no markdown, no wrapper keys.`;

export async function generateNextMcpAttackTurn(
  history: ToolCallTurn[],
  attackGoal: string,
  toolName: string,
  model: ModelConfig
): Promise<Record<string, unknown>> {
  const historyText = history.map((t, i) => {
    const args = JSON.stringify(t.toolArguments, null, 2);
    const response = t.toolError
      ? `ERROR: ${t.toolError}`
      : t.rawToolResponse.slice(0, 800) + (t.rawToolResponse.length > 800 ? "\n…(truncated)" : "");
    return `Turn ${i + 1}: called ${t.toolName} with\n${args}\n→ response: ${response}`;
  }).join("\n\n");

  const user = [
    `Attack goal: ${attackGoal}`,
    `Tool to call: ${toolName}`,
    ``,
    `Prior attempts:`,
    historyText,
    ``,
    `The server has not yet revealed a vulnerability. Generate new tool arguments that escalate the attack — try a different angle, use data from prior responses, or probe a different boundary.`,
    `Respond with ONLY a valid JSON object of tool arguments.`,
  ].join("\n");

  const raw = await chatCompletionJsonContent({ model, system: ATTACKER_SYSTEM, user });

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
