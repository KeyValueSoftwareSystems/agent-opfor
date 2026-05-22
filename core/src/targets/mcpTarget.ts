import type { McpTargetConfig } from "../execute/types.js";
import { connectMcpClient, type McpConnectedClient } from "../mcp-client/createClient.js";
import type { ToolInfo } from "../generate/generateAttacks.js";
import type { ResourceInfo } from "../run/scanResources.js";

export interface McpToolCallResult {
  response: string;
  toolError?: string;
}

export interface McpTarget {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
  listTools(): Promise<ToolInfo[]>;
  listResources(): Promise<ResourceInfo[]>;
  readResource(uri: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Create a connected MCP target from config.
 * Caller is responsible for calling close() when done.
 */
export async function createMcpTarget(config: McpTargetConfig): Promise<McpTarget> {
  const serverConfig = buildServerConfig(config);
  const conn = await connectMcpClient(serverConfig, { suppressServerStderr: true });
  return new ConnectedMcpTarget(conn);
}

function expandEnvInHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name.trim()] ?? "");
  }
  return out;
}

function buildServerConfig(config: McpTargetConfig): Parameters<typeof connectMcpClient>[0] {
  if (config.transport === "stdio") {
    if (!config.command) throw new Error("MCP stdio target requires command");
    return {
      transport: "stdio",
      command: config.command,
      args: config.args ?? [],
      cwd: config.cwd,
      env: config.env ?? {},
    };
  }
  if (!config.url) throw new Error("MCP url target requires url");
  return {
    transport: "url",
    url: config.url,
    headers: expandEnvInHeaders(config.urlHeaders ?? {}),
  };
}

class ConnectedMcpTarget implements McpTarget {
  constructor(private readonly conn: McpConnectedClient) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    try {
      const result = await this.conn.client.callTool({ name, arguments: args });
      return { response: JSON.stringify(result, null, 2) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        response: "",
        toolError: msg
          .split("\n")[0]
          .replace(/^Error:\s*/i, "")
          .slice(0, 200),
      };
    }
  }

  async listTools(): Promise<ToolInfo[]> {
    try {
      const listed = await this.conn.client.listTools();
      return (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    } catch {
      return [];
    }
  }

  async listResources(): Promise<ResourceInfo[]> {
    try {
      const listed = await this.conn.client.listResources();
      return (listed.resources ?? []).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<string> {
    try {
      const read = await this.conn.client.readResource({ uri });
      const parts = (read.contents ?? [])
        .filter(
          (c): c is { uri: string; text: string } => "text" in c && typeof c.text === "string"
        )
        .map((c) => c.text);
      return parts.join("\n").trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: ${msg.slice(0, 300)}`;
    }
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
