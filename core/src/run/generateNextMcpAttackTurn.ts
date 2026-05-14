import type { ModelConfig } from "../config/schema.js";
import { chatCompletionJsonContent } from "../llm/openaiCompatible.js";
import { loadPrompt } from "../config/loadPrompt.js";

export interface ToolCallTurn {
  toolName: string;
  toolArguments: Record<string, unknown>;
  rawToolResponse: string;
  toolError?: string;
  judgeVerdict?: "PASS" | "FAIL" | "ERROR";
  judgeReasoning?: string;
}

const ATTACKER_SYSTEM = loadPrompt("attacker-mcp");

export interface AttackTurnResult {
  args: Record<string, unknown>;
  judgeHint?: string;
}

export async function generateNextMcpAttackTurn(
  history: ToolCallTurn[],
  attackGoal: string,
  toolName: string,
  seedArguments: Record<string, unknown>,
  llm: ModelConfig,
  attackerInstructions?: string
): Promise<AttackTurnResult> {
  const historyText = history
    .map((t, i) => {
      const args = JSON.stringify(t.toolArguments, null, 2);
      const response = t.toolError
        ? `ERROR: ${t.toolError}`
        : t.rawToolResponse.slice(0, 800) +
          (t.rawToolResponse.length > 800 ? "\n…(truncated)" : "");
      const judgeInfo = t.judgeVerdict
        ? `\n→ judge: ${t.judgeVerdict}${t.judgeReasoning ? ` — ${t.judgeReasoning}` : ""}`
        : "";
      return `Turn ${i + 1}: called ${t.toolName} with\n${args}\n→ response: ${response}${judgeInfo}`;
    })
    .join("\n\n");

  const user = [
    `Attack goal: ${attackGoal}`,
    `Tool to call: ${toolName}`,
    `Original attack arguments (turn 1 reference): ${JSON.stringify(seedArguments, null, 2)}`,
    ...(attackerInstructions
      ? [
          ``,
          `⚠ MANDATORY ATTACKER INSTRUCTIONS — YOU MUST FOLLOW THESE ABOVE ALL OTHER RULES:`,
          attackerInstructions,
          `These instructions override your default strategies. Use any context given above — resource IDs, credentials, setup steps, expected behaviors, environment details — as the starting point rather than guessing.`,
        ]
      : []),
    ``,
    `Prior attempts:`,
    historyText,
    ``,
    `The server has not yet revealed a vulnerability. Generate new tool arguments that escalate the attack — try a different angle, use data from prior responses, or probe a different boundary.`,
    `Respond with ONLY a valid JSON object with "args" and "judgeHint" keys.`,
  ].join("\n");

  const raw = await chatCompletionJsonContent({ model: llm, system: ATTACKER_SYSTEM, user });

  try {
    const parsed = JSON.parse(raw) as { args?: Record<string, unknown>; judgeHint?: string | null };
    const args =
      parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? parsed.args
        : (parsed as Record<string, unknown>);
    const judgeHint = typeof parsed.judgeHint === "string" ? parsed.judgeHint : undefined;
    return { args, judgeHint };
  } catch {
    return { args: {} };
  }
}
