// The agent loop that drives hunt's commander / operator / scout.
//
// Replaces the Claude Agent SDK's `query()`. Everything the SDK gave us is reconstructed here
// from AI SDK primitives, which keeps hunt provider-agnostic and free of a child process:
//
//   SDK `agents: {...}` + Task  → nested agents dispatched by tools (see tools/dispatch.ts)
//   SDK `allowedTools`          → each agent is constructed with only its own tools
//   SDK `hooks.PostToolUse`     → onStepFinish
//   SDK `maxTurns`              → stopWhen: stepCountIs(n)
//
// The tool-grant model gets strictly stronger in the process: an ungranted tool is not merely
// disallowed, it does not exist in that agent's toolset.

import {
  ToolLoopAgent,
  stepCountIs,
  tool as aiTool,
  type LanguageModel,
  type ToolSet,
  type StepResult,
} from "ai";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createModel } from "../../providers/factory.js";
import { brainLlmConfig } from "../lib/models.js";
import type { HuntOptions } from "../lib/types.js";
import type { AnyRedteamTool } from "../tools/defineTool.js";

/** Flatten an MCP-shaped tool result into the text the model sees. */
function flattenToolResult(result: CallToolResult): string {
  const text = (result.content ?? [])
    .map((block) => (block.type === "text" ? block.text : JSON.stringify(block)))
    .filter(Boolean)
    .join("\n");
  return text || (result.isError ? "(tool error)" : "(no output)");
}

/**
 * Adapt our runtime-agnostic tools to an AI SDK ToolSet.
 *
 * `names` is the grant list: only these tools are built, so an agent physically cannot call
 * anything outside its role. Unknown names throw — a typo in a grant list should fail loudly at
 * startup rather than silently hand an agent a smaller toolset than intended.
 */
export function toAiTools(registry: Record<string, AnyRedteamTool>, names: string[]): ToolSet {
  const set: ToolSet = {};
  for (const name of names) {
    const def = registry[name];
    if (!def) {
      throw new Error(
        `Unknown tool "${name}" in grant list. Available: ${Object.keys(registry).join(", ")}.`
      );
    }
    set[name] = aiTool({
      description: def.description,
      inputSchema: z.object(def.inputSchema),
      execute: async (args: unknown) => flattenToolResult(await def.handler(args as never)),
    });
  }
  return set;
}

/** Per-step callback: fires after each agent step with that step's tool calls and usage. */
export type StepObserver = (step: StepResult<ToolSet>, agent: AgentRole) => void;

export type AgentRole = "commander" | "operator" | "scout";

export interface BuildAgentSpec {
  role: AgentRole;
  instructions: string;
  model: LanguageModel;
  tools: ToolSet;
  /** Step ceiling for this agent's loop. */
  maxSteps: number;
}

/**
 * Resolve one brain model through the shared provider registry.
 *
 * Callers build the model themselves (rather than passing a model id to {@link buildAgent})
 * because token usage must be attributed to the model instance — `ToolLoopAgent` keeps its
 * settings private, so there is no way to recover it from the agent afterwards.
 */
export function brainModel(options: HuntOptions, modelId: string): LanguageModel {
  return createModel(brainLlmConfig(options.brain, modelId));
}

/** Construct one agent over an already-resolved model. */
export function buildAgent(spec: BuildAgentSpec): ToolLoopAgent<never, ToolSet> {
  return new ToolLoopAgent({
    id: spec.role,
    model: spec.model,
    instructions: spec.instructions,
    tools: spec.tools,
    stopWhen: stepCountIs(spec.maxSteps),
  });
}

/**
 * Run an agent to completion and return its final text.
 *
 * Errors are returned rather than thrown: a subagent that fails (rate limit, provider blip)
 * must not abort the whole hunt — the commander should see the failure as a tool result and
 * decide what to do, exactly as it would have under the SDK's Task tool.
 */
export async function runAgent(
  agent: ToolLoopAgent<never, ToolSet>,
  prompt: string,
  opts: { signal?: AbortSignal; onStep?: (step: StepResult<ToolSet>) => void }
): Promise<string> {
  try {
    const result = await agent.generate({
      prompt,
      abortSignal: opts.signal,
      onStepFinish: opts.onStep,
    });
    return result.text || "(agent returned no text)";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `AGENT ERROR: ${message}`;
  }
}
