import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AstraMcpConfig } from "../config/schema.js";

export type McpConnectedClient = {
  client: Client;
  close: () => Promise<void>;
};

function headersFromRecord(h: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (k) headers.set(k, v);
  }
  return headers;
}

async function connectUrlTransport(url: string, headers: Record<string, string>): Promise<McpConnectedClient> {
  const u = new URL(url);
  const requestInit = { headers: headersFromRecord(headers) };
  const client = new Client({ name: "astra-mcp", version: "0.0.1" });

  try {
    const transport = new StreamableHTTPClientTransport(u, { requestInit });
    await client.connect(transport);
    return {
      client,
      close: async () => {
        try {
          await transport.terminateSession?.();
        } catch {
          // ignore — not all servers support DELETE
        }
        await client.close();
      },
    };
  } catch {
    await client.close().catch(() => undefined);
    const client2 = new Client({ name: "astra-mcp", version: "0.0.1" });
    const sse = new SSEClientTransport(u, { requestInit });
    await client2.connect(sse);
    return {
      client: client2,
      close: async () => {
        await client2.close();
      },
    };
  }
}

/** Expand ${VAR_NAME} references in env values from process.env. */
function expandEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = v.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
  }
  return result;
}

export async function connectMcpClient(
  server: AstraMcpConfig["server"],
  opts: { suppressServerStderr?: boolean } = {}
): Promise<McpConnectedClient> {
  if (server.transport === "stdio") {
    const client = new Client({ name: "astra-mcp", version: "0.0.1" });
    const env = { ...getDefaultEnvironment(), ...expandEnv(server.env) };
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env,
      // Pipe stderr so the child process's internal logs don't pollute our output.
      // The MCP protocol only uses stdout/stdin — stderr is purely the server's own logging.
      stderr: opts.suppressServerStderr !== false ? "pipe" : "inherit",
    });
    await client.connect(transport);
    return {
      client,
      close: async () => {
        await client.close();
        // StdioClientTransport keeps the child process alive after client.close();
        // explicitly close the transport to send SIGTERM to the child.
        await transport.close().catch(() => undefined);
      },
    };
  }

  return connectUrlTransport(server.url, expandEnv(server.headers));
}
