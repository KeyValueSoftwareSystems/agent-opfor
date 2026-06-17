// get_thread — read back a thread's recorded transcript. Because a forked child inherits the
// parent's turns, this returns the FULL lineage transcript for a branch, so an agent picking up
// a forked/handed-off thread can see exactly what was already tried.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { RunContext } from "../orchestrator/context.js";
import { jsonResult, textResult } from "./util.js";

export function getThreadTool(ctx: RunContext) {
  return tool(
    "get_thread",
    "Read the recorded transcript of an attack thread (its full conversation, including any turns inherited from a parent when it was forked). Use this to orient before continuing a forked or handed-off thread.",
    {
      threadId: z.string().describe("The thread to read."),
    },
    async (args) => {
      const thread = ctx.runLog.threads.get(args.threadId);
      if (!thread) {
        return textResult(`No thread "${args.threadId}".`, true);
      }
      return jsonResult({
        threadId: thread.threadId,
        vulnClassId: thread.vulnClassId,
        parentThreadId: thread.parentThreadId,
        forkedFromTurn: thread.forkedFromTurn,
        turns: thread.turns.map((t) => ({
          turnIndex: t.turnIndex,
          inherited: thread.forkedFromTurn !== undefined && t.turnIndex <= thread.forkedFromTurn,
          persona: t.persona,
          strategy: t.strategy,
          prompt: t.prompt,
          response: t.response,
          score: t.score,
          isError: t.isError,
        })),
      });
    }
  );
}
