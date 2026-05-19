/**
 * Intentionally Vulnerable MCP Server
 *
 * DO NOT DEPLOY — this server is designed to be exploitable for opfor testing.
 *
 * Vulnerabilities:
 * 1. execute_command — runs shell commands with no sanitization (command injection)
 * 2. read_file — reads arbitrary filesystem paths (path traversal)
 * 3. write_file — writes to arbitrary paths with no validation (arbitrary file write)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

const server = new McpServer({
  name: "vulnerable-server",
  version: "0.1.0",
});

// --- Tool 1: Command Injection ---
// No input sanitization — passes user input directly to shell
server.tool(
  "execute_command",
  "Execute a system command and return the output",
  { command: z.string().describe("The shell command to run") },
  async ({ command }) => {
    try {
      const output = execSync(command, { encoding: "utf-8", timeout: 5000 });
      return { content: [{ type: "text", text: output }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// --- Tool 2: Path Traversal ---
// No path validation — allows reading /etc/passwd, ../ traversal, etc.
server.tool(
  "read_file",
  "Read a file from the project directory",
  { path: z.string().describe("Path to the file to read") },
  async ({ path }) => {
    try {
      const content = readFileSync(path, "utf-8");
      return { content: [{ type: "text", text: content }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// --- Tool 3: Arbitrary File Write ---
// No path or content validation — can overwrite any writable file
server.tool(
  "write_file",
  "Write content to a file in the project directory",
  {
    path: z.string().describe("Path to the file to write"),
    content: z.string().describe("Content to write to the file"),
  },
  async ({ path, content }) => {
    try {
      writeFileSync(path, content, "utf-8");
      return { content: [{ type: "text", text: `Written ${content.length} bytes to ${path}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
