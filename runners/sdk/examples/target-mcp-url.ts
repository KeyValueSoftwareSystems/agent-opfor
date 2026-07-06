import type { RunOptions } from "@keyvaluesystems/agent-opfor-sdk";

const token = process.env.MCP_TOKEN ?? "<set MCP_TOKEN>";

const options: RunOptions = {
  target: {
    kind: "mcp",
    name: "My MCP Server (url)",
    transport: "url",
    url: "http://localhost:3000/mcp",
    urlHeaders: { Authorization: `Bearer ${token}` },
  },
  suite: "owasp-mcp",
};

console.log(options);
