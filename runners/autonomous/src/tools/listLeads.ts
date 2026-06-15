// list_leads — the commander reads the queue of operator-flagged seams between waves, ranks them,
// and expands the best. Optional markSpawned/markDismissed resolve leads in the same round-trip so
// the same seam is never spawned twice. Read-mostly (the marks are bookkeeping on the queue).

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { RunContext } from "../orchestrator/context.js";
import { markLead } from "../state/runLog.js";
import { noteEvent } from "../state/hooks.js";
import { jsonResult } from "./util.js";

export function listLeadsTool(ctx: RunContext) {
  return tool(
    "list_leads",
    "Read the queue of open seam leads flagged by operators (with their objective progress signal, evidence, recommendation, and exploration generation). Rank these and dispatch follow-up operators for the best, within maxDepth and the thread/budget backstops. Pass markSpawned/markDismissed to resolve leads you act on so they aren't expanded twice.",
    {
      markSpawned: z
        .array(z.string())
        .optional()
        .describe("Lead ids you are dispatching follow-ups for now."),
      markDismissed: z
        .array(z.string())
        .optional()
        .describe("Lead ids you are dropping (not worth expanding)."),
    },
    async (args) => {
      for (const id of args.markSpawned ?? []) {
        markLead(ctx.runLog, id, "spawned");
        noteEvent(ctx.reporter, {
          at: new Date().toISOString(),
          type: "lead_spawned",
          data: { leadId: id },
        });
      }
      for (const id of args.markDismissed ?? []) {
        markLead(ctx.runLog, id, "dismissed");
        noteEvent(ctx.reporter, {
          at: new Date().toISOString(),
          type: "lead_dismissed",
          data: { leadId: id },
        });
      }

      const open = ctx.runLog.leads.filter((l) => l.status === "open");
      return jsonResult({
        open: open.map((l) => ({
          id: l.id,
          threadId: l.threadId,
          atTurn: l.atTurn,
          suggestedClassId: l.suggestedClassId,
          recommend: l.recommend,
          rationale: l.rationale,
          evidenceSnippet: l.evidenceSnippet,
          progressHint: l.progressHint,
          gen: l.gen,
          expandable: ctx.budget.depthAllowed(l.gen),
        })),
        limits: {
          maxDepth: ctx.budget.maxDepth,
          maxLeadsPerWave: ctx.options.maxLeadsPerWave,
          totalThreads: ctx.runLog.threads.size,
          maxTotalThreads: ctx.budget.maxTotalThreads,
        },
      });
    }
  );
}
