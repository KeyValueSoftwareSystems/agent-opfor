// Assemble all custom tools into one in-process SDK MCP server.
// Tool ids become `mcp__redteam__<tool>`.

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { RunContext } from "../orchestrator/context.js";
import { listKnowledgeTool, getKnowledgeTool } from "./knowledge.js";
import { reconProbeTool } from "./reconProbe.js";
import { sendToTargetTool } from "./sendToTarget.js";
import { forkThreadTool } from "./forkThread.js";
import { getThreadTool } from "./getThread.js";
import { flagLeadTool } from "./flagLead.js";
import { listLeadsTool } from "./listLeads.js";
import { selfCheckTool } from "./selfCheck.js";
import { recordFindingTool } from "./recordFinding.js";
import { registerInventionTool } from "./registerInvention.js";
import { submitReportTool } from "./submitReport.js";

export const REDTEAM_SERVER_NAME = "redteam";

/** Fully-qualified tool id for a given tool name. */
export function toolId(name: string): string {
  return `mcp__${REDTEAM_SERVER_NAME}__${name}`;
}

export const TOOL_NAMES = {
  reconProbe: "recon_probe",
  listKnowledge: "list_knowledge",
  getKnowledge: "get_knowledge",
  sendToTarget: "send_to_target",
  forkThread: "fork_thread",
  getThread: "get_thread",
  flagLead: "flag_lead",
  listLeads: "list_leads",
  selfCheck: "self_check",
  recordFinding: "record_finding",
  registerInvention: "register_invention",
  submitReport: "submit_report",
} as const;

export function buildRedteamServer(ctx: RunContext) {
  return createSdkMcpServer({
    name: REDTEAM_SERVER_NAME,
    version: "0.1.0",
    tools: [
      reconProbeTool(ctx),
      listKnowledgeTool(ctx),
      getKnowledgeTool(ctx),
      sendToTargetTool(ctx),
      forkThreadTool(ctx),
      getThreadTool(ctx),
      flagLeadTool(ctx),
      listLeadsTool(ctx),
      selfCheckTool(ctx),
      recordFindingTool(ctx),
      registerInventionTool(ctx),
      submitReportTool(ctx),
    ],
  });
}
