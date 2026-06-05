// PreToolUse/PostToolUse hooks → raw audit transcript + rich, human-readable
// live progress lines. Robust to whatever the model does; complements
// handler-side semantic logging.

import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { RunLog, TranscriptEntry } from "./runLog.js";

export interface ProgressReporter {
  /** A single formatted, human-readable progress line. */
  onLine(line: string): void;
}

function snippet(value: unknown, max = 150): string {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const one = str.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}

/**
 * The 8 redteam tools self-report accurate lines from their handlers (where the
 * structured data is exact). The hook only narrates subagent DISPATCH and the
 * knowledge-study calls (which have no handler-side reporter), to avoid both
 * double lines and fragile tool-output parsing.
 */
function formatLine(tool: string, input: unknown, who: string): string | null {
  const inp = (input ?? {}) as Record<string, string | undefined>;
  if (tool === "Agent" || tool === "Task") {
    return `${who} 🚀 dispatched subagent: ${snippet(inp.description ?? inp.prompt ?? inp.subagent_type, 90)}`;
  }
  return null;
}

/** Build the hooks config: records every tool call + emits a progress line. */
export function buildHooks(
  runLog: RunLog,
  progress?: ProgressReporter
): Partial<Record<string, HookCallbackMatcher[]>> {
  const postToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse") return { continue: true };
    const entry: TranscriptEntry = {
      at: new Date().toISOString(),
      agentId: input.agent_id,
      agentType: input.agent_type,
      tool: input.tool_name,
      input: input.tool_input,
      output: input.tool_response,
    };
    runLog.transcript.push(entry);

    if (progress) {
      const who = input.agent_type ? `[${input.agent_type}]` : "[commander]";
      const line = formatLine(input.tool_name, input.tool_input, who);
      if (line) progress.onLine(line);
    }
    return { continue: true };
  };

  return {
    PostToolUse: [{ hooks: [postToolUse] }],
  };
}
