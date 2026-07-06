import type { RunOptions } from "@keyvaluesystems/agent-opfor-sdk";

const options: RunOptions = {
  target: {
    kind: "mcp",
    name: "My MCP Server (url)",
    transport: "url",
    url: "http://localhost:3000/mcp",
    urlHeaders: { Authorization: "Bearer $MCP_TOKEN" },
  },
  suite: "owasp-mcp",
};

console.log(options);
