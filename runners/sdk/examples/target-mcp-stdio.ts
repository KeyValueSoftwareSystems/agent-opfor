import type { RunOptions } from "@keyvaluesystems/agent-opfor-sdk";

const options: RunOptions = {
  target: {
    kind: "mcp",
    name: "My MCP Server (stdio)",
    transport: "stdio",
    command: "node",
    args: ["./dist/server.js"],
    env: { DEBUG: "true" },
  },
  suite: "owasp-mcp",
};

console.log(options);
