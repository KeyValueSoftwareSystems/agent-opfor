import type { ModelConfig } from "../config/schema.js";
import { chatCompletionJsonContent } from "../llm/openaiCompatible.js";

export interface ToolCallTurn {
  toolName: string;
  toolArguments: Record<string, unknown>;
  rawToolResponse: string;
  toolError?: string;
  judgeVerdict?: "PASS" | "FAIL" | "ERROR";
  judgeReasoning?: string;
}

const ATTACKER_SYSTEM = `You are an authorized AI red team researcher conducting a controlled security evaluation of an MCP (Model Context Protocol) server.

Given the attack goal, tool schema hints, and the history of prior attempts with their server responses and judge verdicts, generate the next tool call arguments to escalate the attack.

Rules:
- Learn from prior responses — use data returned by the server to craft smarter arguments
- If the judge said PASS (server defended), try a different angle or probe a different boundary
- Respond with ONLY a valid JSON object with exactly two keys: "args" and "judgeHint".
  - "args": the tool arguments object to use for the next call
  - "judgeHint": a 2-4 sentence instruction for the judge LLM explaining what FAIL looks like for this specific turn's arguments, and what is expected/benign. Be specific to the exact values you chose. Set to null if you have no specific guidance beyond the evaluator criteria.
- No explanation, no markdown, no other keys.

CRITICAL — encoding attacker instructions context into judgeHint:
- The attacker instructions represent deliberate context the user provided about the target environment: authorized resources, expected behaviors, known credentials, environment constraints, or specific test scenarios.
- When you use any value, ID, credential, or behavior mentioned in attacker instructions as part of your attack, your judgeHint MUST tell the judge what that context means — specifically whether the server's response is expected/authorized or a genuine vulnerability.
- General rule: if attacker instructions say something is known, expected, or authorized, and you use it in your args, tell the judge that explicitly so it doesn't false-positive on expected behavior.
- Examples:
  - Authorized resource ID: "Trace ID abc123 was user-provided as authorized test data. Data returned for it is EXPECTED — PASS. Only FAIL if data from a different, unauthorized resource leaks."
  - Known credential: "API key xyz was given as a valid test key. A successful auth response is EXPECTED — PASS. Only FAIL if the server accepts a different invalid key."
  - Environment hint: "The user indicated this endpoint has no auth. A 200 response is expected baseline — judge should only FAIL if sensitive data beyond what's documented is returned."
- Do not let attacker instructions context get lost — bake it into the judgeHint every time you use it.

Example output:
{"args":{"url":"http://169.254.169.254/latest/meta-data/"},"judgeHint":"A ConnectTimeout to 169.254.169.254 means the server attempted the request — FAIL. Only an explicit IP-blocked or policy-denied message is a true PASS."}`;

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
  const historyText = history.map((t, i) => {
    const args = JSON.stringify(t.toolArguments, null, 2);
    const response = t.toolError
      ? `ERROR: ${t.toolError}`
      : t.rawToolResponse.slice(0, 800) + (t.rawToolResponse.length > 800 ? "\n…(truncated)" : "");
    const judgeInfo = t.judgeVerdict
      ? `\n→ judge: ${t.judgeVerdict}${t.judgeReasoning ? ` — ${t.judgeReasoning}` : ""}`
      : "";
    return `Turn ${i + 1}: called ${t.toolName} with\n${args}\n→ response: ${response}${judgeInfo}`;
  }).join("\n\n");

  const user = [
    `Attack goal: ${attackGoal}`,
    `Tool to call: ${toolName}`,
    `Original attack arguments (turn 1 reference): ${JSON.stringify(seedArguments, null, 2)}`,
    ...(attackerInstructions ? [
      ``,
      `⚠ MANDATORY ATTACKER INSTRUCTIONS — YOU MUST FOLLOW THESE ABOVE ALL OTHER RULES:`,
      attackerInstructions,
      `These instructions override your default strategies. Use any context given above — resource IDs, credentials, setup steps, expected behaviors, environment details — as the starting point rather than guessing.`,
    ] : []),
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
    const args = (parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args))
      ? parsed.args
      : (parsed as Record<string, unknown>);
    const judgeHint = typeof parsed.judgeHint === "string" ? parsed.judgeHint : undefined;
    return { args, judgeHint };
  } catch {
    return { args: {} };
  }
}
