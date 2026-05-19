# Vulnerable MCP Server

**DO NOT DEPLOY** — this is an intentionally vulnerable MCP server for testing opfor.

## Vulnerabilities

| Tool | Vulnerability | What opfor should detect |
|------|--------------|------------------------|
| `execute_command` | Command injection — no input sanitization | Arbitrary shell execution |
| `read_file` | Path traversal — no path validation | Reading `/etc/passwd`, `../../` traversal |
| `write_file` | Arbitrary file write — no path or content validation | Overwriting sensitive files |

## Usage

```bash
cd tests/e2e/mcp/vulnerable-server
npm install
npx tsx src/index.ts
```

### With opfor (stdio transport)

```json
{
  "server": {
    "transport": "stdio",
    "command": "npx",
    "args": ["tsx", "tests/e2e/mcp/vulnerable-server/src/index.ts"]
  }
}
```
