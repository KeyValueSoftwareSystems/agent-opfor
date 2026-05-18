# Stdio Transport Target Adapter

This adapter describes how to connect to MCP servers that communicate via standard I/O (stdin/stdout).

## What This Is

Stdio is the most common MCP transport for local development and testing. The MCP server is launched as a child process — you write JSON-RPC 2.0 messages to its stdin and read responses from its stdout.

Typical scenarios:

- Local MCP servers started with `npx`, `node`, `python`, `uvx`, etc.
- Servers defined in `mcp.json` or `claude_desktop_config.json` with a `command` field
- Any server that reads/writes newline-delimited JSON-RPC on stdio

## Connection Setup

### 1. Discover the Server Command

Look for the server launch command in one of:

- `.cursor/mcp.json` → `mcpServers.<name>.command` + `.args`
- `claude_desktop_config.json` → `mcpServers.<name>.command` + `.args`
- User-provided config (e.g. `opfor.config.json` → `mcp.command`)
- Direct user input ("run `npx @myorg/mcp-server`")

Example:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
}
```

### 2. Launch the Server Process

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

The process stays alive — communicate over its stdin/stdout pipes.

### 3. Initialize the Session

Send the MCP `initialize` request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "opfor", "version": "0.2.0" }
  }
}
```

Wait for the response (confirms supported protocol version and server capabilities).

Then send `initialized` notification:

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

## Tool Discovery

List available tools:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

Response contains an array of tool definitions with names, descriptions, and input schemas. Record these — they define the attack surface.

## Resource Discovery

List available resources:

```json
{ "jsonrpc": "2.0", "id": 3, "method": "resources/list" }
```

Response contains resource URIs that can be read via `resources/read`.

## Executing Attacks

### Tool Call Attack

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"<tool-name>","arguments":<crafted-args>}}
```

Capture the full response (result content, errors, isError flag).

### Resource Read Attack

```json
{ "jsonrpc": "2.0", "id": 5, "method": "resources/read", "params": { "uri": "<crafted-uri>" } }
```

Capture the full response (resource contents or error).

## Error Handling

**Process exits unexpectedly**: Server crashed. Record the exit code and any stderr output. Restart and continue with remaining attacks.

**No response (timeout > 30s)**: Server may be hung. Kill the process, record timeout error, restart for next attack.

**JSON-RPC error responses**: These are expected — record the error code and message. Some errors _are_ the vulnerability evidence (e.g., the server executing a destructive command and returning the result instead of refusing).

**Malformed JSON on stdout**: Server is emitting non-JSON (debug output, logs). Filter lines — valid JSON-RPC messages start with `{`. Skip non-JSON lines.

## Shutdown

When assessment is complete, send a close or simply terminate the child process:

```bash
kill <pid>
```

Or send a graceful close if the server supports it.

## Integration Example

When `opfor-execute` invokes an MCP attack via stdio:

```
1. Launch server: npx @myorg/mcp-server
2. Initialize session (initialize + initialized)
3. Discover tools (tools/list) and resources (resources/list)
4. For each attack:
   a. Construct crafted tool call or resource read
   b. Send JSON-RPC message to stdin
   c. Read response from stdout
   d. Record: tool name, arguments, response, any error
5. Kill process when done
```
