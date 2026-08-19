// The red-team toolset: every tool the commander/operator/scout agents can call.
//
// This used to build an in-process MCP server for the Claude Agent SDK. The toolset is now
// runtime-agnostic — a plain name→tool registry that orchestrator/agentLoop.ts adapts to the
// AI SDK. Nothing here knows which agent loop is driving it.

import type { RunContext } from "../orchestrator/context.js";
import type { AnyRedteamTool } from "./defineTool.js";
import { listKnowledgeTool, getKnowledgeTool } from "./knowledge.js";
import { reconProbeTool } from "./reconProbe.js";
import { sendToTargetTool } from "./sendToTarget.js";
import { forkThreadTool } from "./forkThread.js";
import { getThreadTool } from "./getThread.js";
import { getTraceTool } from "./getTrace.js";
import { flagLeadTool } from "./flagLead.js";
import { listLeadsTool } from "./listLeads.js";
import { selfCheckTool } from "./selfCheck.js";
import { recordFindingTool } from "./recordFinding.js";
import { registerInventionTool } from "./registerInvention.js";
import { submitReportTool } from "./submitReport.js";

/**
 * Tool ids are now bare names. Under the SDK they were MCP-namespaced
 * (`mcp__redteam__send_to_target`); the prompts call this helper rather than hardcoding ids,
 * so dropping the prefix is a one-line change here instead of an edit to ~50 prompt sites.
 */
export function toolId(name: string): string {
  return name;
}

export const TOOL_NAMES = {
  reconProbe: "recon_probe",
  listKnowledge: "list_knowledge",
  getKnowledge: "get_knowledge",
  sendToTarget: "send_to_target",
  forkThread: "fork_thread",
  getThread: "get_thread",
  getTrace: "get_trace",
  flagLead: "flag_lead",
  listLeads: "list_leads",
  selfCheck: "self_check",
  recordFinding: "record_finding",
  registerInvention: "register_invention",
  submitReport: "submit_report",
  dispatchOperator: "dispatch_operator",
  dispatchScout: "dispatch_scout",
} as const;

/**
 * Build the base toolset (everything except the subagent-dispatch tools, which are wired
 * separately in run.ts because they need to construct agents over this same registry).
 */
export function buildRedteamTools(ctx: RunContext): Record<string, AnyRedteamTool> {
  const tools: AnyRedteamTool[] = [
    reconProbeTool(ctx),
    listKnowledgeTool(ctx),
    getKnowledgeTool(ctx),
    sendToTargetTool(ctx),
    forkThreadTool(ctx),
    getThreadTool(ctx),
    getTraceTool(ctx),
    flagLeadTool(ctx),
    listLeadsTool(ctx),
    selfCheckTool(ctx),
    recordFindingTool(ctx),
    registerInventionTool(ctx),
    submitReportTool(ctx),
  ];
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}
