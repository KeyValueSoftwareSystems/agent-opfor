# URL (SSE/Streamable HTTP) Transport Target Adapter

This adapter describes how to connect to MCP servers exposed over HTTP — either via Server-Sent Events (SSE) or the newer Streamable HTTP transport.

## What This Is

Some MCP servers run as standalone HTTP services rather than local child processes. They accept connections via:

- **SSE transport** — client opens an SSE connection, receives a session endpoint URL, then sends JSON-RPC via HTTP POST to that endpoint
- **Streamable HTTP** — client POSTs JSON-RPC directly to a single endpoint; responses may stream back

Typical scenarios:

- Remote MCP servers deployed as cloud services
- MCP servers behind API gateways or proxies
- Docker-containerized servers exposed on a port
- Any server configured with a URL rather than a command

## Connection Setup

### 1. Discover the Server URL

Look for the server URL in one of:

- `.cursor/mcp.json` → `mcpServers.<name>.url`
- User-provided config (e.g. `opfor.config.json` → `mcp.url`)
- Direct user input ("server is at `http://localhost:3000/sse`")

Example:

```json
{
  "url": "http://localhost:3000/sse"
}
```

### 2. Connect via SSE

Open an SSE connection to the server URL:

```bash
curl -N http://localhost:3000/sse
```

The server sends an initial event containing the session endpoint:

```
event: endpoint
data: /messages?sessionId=abc123
```

This is the POST endpoint for sending JSON-RPC messages.

### 3. Initialize the Session

POST the `initialize` request to the session endpoint:

```bash
curl -X POST http://localhost:3000/messages?sessionId=abc123 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"opfor","version":"0.2.0"}}}'
```

The response arrives via the SSE stream. Wait for the initialization result, then send `initialized`:

```bash
curl -X POST http://localhost:3000/messages?sessionId=abc123 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
```

### Alternative: Streamable HTTP

If the server uses Streamable HTTP (no SSE), POST directly to the server URL:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

Response comes back in the HTTP response body (may be streamed).

## Tool Discovery

```bash
curl -X POST <endpoint> \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Record the tool definitions — names, descriptions, and input schemas.

## Resource Discovery

```bash
curl -X POST <endpoint> \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"resources/list"}'
```

Record resource URIs for resource-based attacks.

## Executing Attacks

### Tool Call Attack

```bash
curl -X POST <endpoint> \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"<tool-name>","arguments":<crafted-args>}}'
```

Capture the full response from the SSE stream or HTTP response body.

### Resource Read Attack

```bash
curl -X POST <endpoint> \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"<crafted-uri>"}}'
```

## Authentication

Some URL-based servers require authentication headers:

- **Bearer token**: Add `-H "Authorization: Bearer <token>"` to all requests
- **API key**: Add `-H "X-API-Key: <key>"` or similar custom header
- **Basic auth**: Add `-u "user:password"`

Check the config `notes` section or environment variables for auth details. Never ask the user to paste secrets into chat — instruct them to set environment variables.

## Error Handling

**Connection refused**: Server is not running or URL is wrong. Verify the URL and that the server is accessible.

**SSE stream closes**: Server disconnected. Re-establish the SSE connection and get a new session endpoint.

**HTTP 401/403**: Authentication failed. Check credentials in config or environment.

**HTTP 404**: Endpoint not found. Verify the URL path.

**HTTP 429**: Rate limited. Wait 5 seconds and retry.

**HTTP 5xx**: Server error. Retry once, then record error and continue.

**Timeout (>30s)**: Server is unresponsive. Record timeout error, continue with remaining attacks.

**Invalid JSON response**: Server sent malformed data. Record raw response as evidence and continue.

## Shutdown

Close the SSE connection (terminate the curl process or close the EventSource). No explicit shutdown message is needed — the server will clean up the session.

## Integration Example

When `opfor-run` invokes an MCP attack via URL transport:

```
1. Connect SSE: curl -N http://localhost:3000/sse
2. Receive session endpoint from SSE event
3. Initialize session (POST initialize + initialized)
4. Discover tools (POST tools/list) and resources (POST resources/list)
5. For each attack:
   a. Construct crafted tool call or resource read
   b. POST JSON-RPC message to session endpoint
   c. Read response from SSE stream
   d. Record: tool name, arguments, response, any error
6. Close SSE connection when done
```
