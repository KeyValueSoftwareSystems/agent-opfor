// list_knowledge + get_knowledge tools — the fetchable half of the seed library.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { RunContext } from "../orchestrator/context.js";
import { jsonResult, textResult } from "./util.js";

export function listKnowledgeTool(ctx: RunContext) {
  return tool(
    "list_knowledge",
    "List the seed knowledge library: vulnerability classes (what to look for + how to judge), personas (who to be), and strategies (how to apply pressure). These are a STARTING MENU — you are free to blend them and invent new ones.",
    {
      kind: z
        .enum(["vuln-class", "persona", "strategy", "all"])
        .optional()
        .describe("Filter to one kind, or 'all' (default)."),
    },
    async (args) => {
      const kind = args.kind ?? "all";
      const out: Record<string, unknown> = {};
      if (kind === "all" || kind === "vuln-class") {
        out.vulnClasses = ctx.knowledge.vulnClasses.map((v) => ({
          id: v.id,
          name: v.name,
          severity: v.severity,
          standards: v.standards,
          description: v.description,
        }));
      }
      if (kind === "all" || kind === "persona") {
        out.personas = ctx.knowledge.personas.map((p) => ({
          id: p.id,
          name: p.name,
          whenToUse: p.whenToUse,
        }));
      }
      if (kind === "all" || kind === "strategy") {
        out.strategies = ctx.knowledge.strategies.map((s) => ({
          id: s.id,
          name: s.name,
          whenToUse: s.whenToUse,
        }));
      }
      return jsonResult(out);
    }
  );
}

export function getKnowledgeTool(ctx: RunContext) {
  return tool(
    "get_knowledge",
    "Fetch the full detail of one seed item, including the fail/pass rubric for a vulnerability class (your judging criteria) or the full mechanics of a persona/strategy.",
    {
      kind: z.enum(["vuln-class", "persona", "strategy"]),
      id: z.string().describe("The seed item's id."),
    },
    async (args) => {
      if (args.kind === "vuln-class") {
        const v = ctx.knowledge.vulnClasses.find((x) => x.id === args.id);
        return v ? jsonResult(v) : textResult(`No vuln-class with id "${args.id}"`, true);
      }
      if (args.kind === "persona") {
        const p = ctx.knowledge.personas.find((x) => x.id === args.id);
        return p ? jsonResult(p) : textResult(`No persona with id "${args.id}"`, true);
      }
      const s = ctx.knowledge.strategies.find((x) => x.id === args.id);
      return s ? jsonResult(s) : textResult(`No strategy with id "${args.id}"`, true);
    }
  );
}
