# @keyvaluesystems/agent-opfor-mcp

Opfor MCP server — expose red-team tools to any MCP-compatible AI agent (Cursor, Claude Desktop, etc.).

## Installation

Add to your MCP host config (e.g. `.cursor/mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opfor": {
      "command": "npx",
      "args": ["-y", "@keyvaluesystems/agent-opfor-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "<your-key>"
      }
    }
  }
}
```

## Available Tools

| Tool                    | Description                              |
| ----------------------- | ---------------------------------------- |
| `opfor_list_evaluators` | List available evaluators and suites     |
| `opfor_setup`           | Generate a red-team config interactively |
| `opfor_run`             | Run a full evaluation and return results |

## Documentation

See [docs.agentopfor.ai/mcp](https://docs.agentopfor.ai/mcp) for full MCP server reference.

## License

Apache-2.0
