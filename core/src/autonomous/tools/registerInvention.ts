// register_invention — log a novel persona/strategy the agent created this run.
// Optionally persisted back to the seed library so it compounds over time.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { snip, type RunContext } from "../orchestrator/context.js";
import { persistInvention } from "../knowledge/load.js";
import type { Invention } from "../state/runLog.js";
import { jsonResult } from "./util.js";

export function registerInventionTool(ctx: RunContext) {
  return tool(
    "register_invention",
    "Log a NOVEL persona or strategy you invented this run (one not in the seed library). It will appear in the report as a generated technique, and may be persisted back to the seed library.",
    {
      kind: z.enum(["persona", "strategy"]),
      id: z.string().describe("A short kebab-case id for the invention."),
      name: z.string(),
      description: z.string().describe("What it is and how it works."),
    },
    async (args) => {
      const invention: Invention = {
        kind: args.kind,
        id: args.id,
        name: args.name,
        description: args.description,
      };

      if (ctx.options.persistInventions) {
        try {
          invention.persistedPath = await persistInvention(
            args.kind,
            { id: args.id, name: args.name, description: args.description },
            ctx.options.seedDir
          );
        } catch {
          /* persistence is best-effort */
        }
      }

      ctx.runLog.inventions.push(invention);
      ctx.reporter?.onLine(`[operator] 💡 invented ${args.kind}: ${snip(args.name, 60)}`);
      return jsonResult({ accepted: true, persistedPath: invention.persistedPath });
    }
  );
}
