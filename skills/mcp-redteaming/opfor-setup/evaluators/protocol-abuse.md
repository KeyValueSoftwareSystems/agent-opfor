---
schema_version: 1
id: protocol-abuse
name: MCP Protocol Abuse
severity: high
ref: MCP05
mcp_top_10: MCP05
description: >-
  Tests MCP server resilience to protocol-level attacks — malformed JSON-RPC messages,
  unknown method calls, invalid parameter types, oversized payloads, and rapid concurrent
  requests. Well-implemented servers should reject malformed requests gracefully without
  crashing, leaking stack traces, or exposing internal state. This evaluator targets the
  transport and framing layer rather than application-level tool logic.
pass_criteria: |-
  - Server returns proper JSON-RPC error responses (code -32600, -32601, -32602, -32603)
  - No stack traces, internal file paths, or framework internals in error messages
  - Server remains responsive after receiving malformed input
  - Server rejects unknown methods with standard "method not found" errors
  - No information about server implementation, framework, or runtime version leaked
fail_criteria: |-
  - Server crashes, hangs, or becomes unresponsive after malformed input
  - Error responses contain full stack traces with internal file paths
  - Error responses reveal server framework name and version (e.g. "FastMCP 1.2.3")
  - Server executes or acknowledges methods it should not support
  - Server returns data from internal state when called with unknown methods
  - Error messages contain database queries, environment variables, or config values
judge_needs_llm: true
applies_to_all_tools: true
patterns:
  - name: Unknown Method Probing
    template: |-
      You are a security researcher testing an MCP server for protocol abuse vulnerabilities.

      MCP servers should only respond to standard JSON-RPC methods (tools/list, tools/call,
      resources/list, resources/read, etc.). Calling non-standard methods should return a
      clean -32601 "method not found" error.

      ATTACK STRATEGY:
      Call methods that might expose internal state or admin functionality:
      1. "admin/shutdown", "admin/restart", "admin/config"
      2. "debug/state", "debug/env", "debug/logs"
      3. "tools/delete", "tools/update", "tools/create"
      4. "server/info", "server/version", "server/status"
      5. "internal/metrics", "internal/health"

      Pick the most interesting tool from the available tools list and generate a
      tools/call request using that tool, but with the tool name replaced by one of the
      admin/debug method names above. The goal is to see if the server leaks information
      in its error response.

      Available tools:
      {{tool_list_json}}

      Output valid JSON:
      {
        "toolName": "<one of the probe method names above>",
        "toolArguments": {},
        "judgeHint": "Check if the error response contains stack traces, framework names, internal paths, or server state. A clean -32601 error is a PASS."
      }

  - name: Oversized Payload Injection
    template: |-
      You are a security researcher testing an MCP server for protocol-level
      resilience to oversized inputs.

      Servers should handle oversized arguments gracefully — reject with a validation
      error, not crash or leak memory-related errors.

      ATTACK STRATEGY:
      Pick a tool that accepts string arguments and send an extremely long string
      (10,000+ characters of repeated text) as one of the arguments. The goal is to
      trigger buffer overflow errors, out-of-memory messages, or crash the server.

      Available tools:
      {{tool_list_json}}

      Pick the tool most likely to be vulnerable (one with string parameters) and
      generate a tools/call request with an oversized argument.

      Output valid JSON:
      {
        "toolName": "<tool name>",
        "toolArguments": {"<string_param>": "<10000+ char string>"},
        "judgeHint": "Check if response contains memory errors, buffer overflow messages, stack traces, or if the server became unresponsive. A clean validation error or truncation is PASS."
      }
---

# MCP Protocol Abuse

## What It Tests

This evaluator probes the MCP server's protocol-level robustness — how it handles
requests that are technically valid JSON-RPC but target undefined behavior in the
MCP spec (unknown methods, oversized payloads, type mismatches).

## Why It Matters

Protocol-level attacks are often the first step in reconnaissance. A server that
leaks its framework name and version in error messages gives an attacker a head
start on finding known CVEs. A server that crashes on oversized input is vulnerable
to denial-of-service.

## Remediation

- Return standard JSON-RPC error codes without implementation details
- Validate input sizes before processing
- Use structured error responses that never include stack traces in production
- Rate-limit and size-limit incoming requests at the transport layer
