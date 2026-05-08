import type { AstraMcpConfig } from "../config/schema.js";
import type { AttackScenario, AttackScenarioWithReplay } from "./planSchema.js";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** JSON-RPC line as sent on MCP stdio (newline-terminated framing). */
export function jsonRpcLine(method: string, params: unknown, id: number): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

export function buildToolsListCurl(
  url: string,
  headers: Record<string, string>,
  id = 1
): string {
  const body = { jsonrpc: "2.0", id, method: "tools/list", params: {} };
  const hdrParts = Object.entries(headers).map(([k, v]) => `-H ${shellQuote(`${k}: ${v}`)}`);
  const hdr = hdrParts.length ? `${hdrParts.join(" ")} ` : "";
  return `curl -sS -X POST ${shellQuote(url)} ${hdr}-H ${shellQuote(
    "Content-Type: application/json"
  )} -H ${shellQuote("Accept: application/json, text/event-stream")} -d ${shellQuote(JSON.stringify(body))}`;
}

export function buildToolsCallCurl(
  url: string,
  headers: Record<string, string>,
  toolName: string,
  args: unknown,
  id = 1
): string {
  const body = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args ?? {} },
  };
  const hdrParts = Object.entries(headers).map(([k, v]) => `-H ${shellQuote(`${k}: ${v}`)}`);
  const hdr = hdrParts.length ? `${hdrParts.join(" ")} ` : "";
  return `curl -sS -X POST ${shellQuote(url)} ${hdr}-H ${shellQuote(
    "Content-Type: application/json"
  )} -H ${shellQuote("Accept: application/json, text/event-stream")} -d ${shellQuote(JSON.stringify(body))}`;
}

export function attachReplayHints(
  attack: AttackScenario,
  server: AstraMcpConfig["server"]
): AttackScenarioWithReplay {
  const toolsListLine = jsonRpcLine("tools/list", {}, 1);
  const toolsCallLine =
    attack.suggestedToolName !== undefined
      ? jsonRpcLine(
          "tools/call",
          { name: attack.suggestedToolName, arguments: attack.suggestedToolArguments ?? {} },
          2
        )
      : undefined;

  if (server.transport === "url") {
    const toolsListCurl = buildToolsListCurl(server.url, server.headers);
    const toolsCallCurl =
      attack.suggestedToolName !== undefined
        ? buildToolsCallCurl(
            server.url,
            server.headers,
            attack.suggestedToolName,
            attack.suggestedToolArguments ?? {}
          )
        : undefined;
    return {
      ...attack,
      replay: {
        http: {
          toolsListCurl,
          ...(toolsCallCurl ? { toolsCallCurl } : {}),
        },
        stdio: { toolsListLine, ...(toolsCallLine ? { toolsCallLine } : {}) },
      },
    };
  }

  return {
    ...attack,
    replay: {
      stdio: {
        toolsListLine,
        ...(toolsCallLine ? { toolsCallLine } : {}),
      },
    },
  };
}
