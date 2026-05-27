---
schema_version: 1
id: missing-authentication
name: Missing Authentication
severity: critical
standards:
  owasp-mcp: MCP07
description: Tests whether MCP server tool endpoints respond to unauthenticated requests. Research shows 38% of publicly exposed MCP servers have zero authentication — tools/list and tools/call succeed with no credentials whatsoever. This gives any attacker on the network full access to all server capabilities.
pass_criteria: |-
  - Server responds with an explicit authentication error: "unauthorized", "unauthenticated", "invalid api key", "forbidden", HTTP 401, or HTTP 403
  - The response clearly rejects the request due to missing credentials, not due to a missing resource
  - NOTE: "not found", "does not exist", empty arrays, or generic errors are INCONCLUSIVE — they do not prove auth is enforced
fail_criteria: |-
  - Tool returns actual data (arrays, objects, real content) without any credentials — score 9
  - Server returns HTTP 200 with structured tool output on an unauthenticated request — score 9
  - Server returns tool data wrapped in an error (partial auth bypass) — score 7
  - Authentication enforced on some tools but not others (inconsistent enforcement) — score 6
patterns:
  - name: Unauthenticated Tool Call
    template: |-
      You are a security researcher testing an MCP server for missing authentication (MCP07).

      ATTACK BACKGROUND:
      Many MCP servers are deployed without any authentication layer, especially local and
      developer-focused ones. An attacker on the same network (or with any access to the endpoint)
      can call any tool without credentials. This is a critical vulnerability because MCP servers
      often have access to filesystems, databases, APIs, and secrets.

      The test: send a valid tools/call request with NO Authorization header, no API key, no
      session token. If the server responds with tool output instead of an auth error, it is
      vulnerable.

      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      For each tool, generate a tools/call JSON-RPC payload using realistic arguments. The payloads
      will be sent with zero authentication headers. Choose arguments that would produce real tool
      output if auth is missing — not edge-case inputs that might be rejected for other reasons.

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "<realistic value>" }
            },
            "id": 1
          },
          "judge_hint": "PASS if response is HTTP 401/403 or JSON-RPC error about authentication. FAIL if response is HTTP 200 with tool output, or if the JSON-RPC result contains actual data from the tool. Also FAIL if the error message leaks internal paths, stack traces, or config."
        }
      ]

      Generate one entry per tool with the most realistic arguments you can infer from the schema.
mcp_top_10: MCP07
judge_instructions: |-
  This request was sent with NO authentication headers — no API key, no token, nothing.
  The question is: did the server enforce authentication, or did it serve the request anyway?

  FAIL if the response contains actual tool output — real data, arrays, objects — score 9.

  PASS if the response contains explicit auth rejection language: "unauthorized",
  "unauthenticated", "invalid api key", "forbidden", "401", "403", "missing credentials".

  INCONCLUSIVE — treat as PASS but note it in reasoning:
  "Not found", "does not exist", empty arrays, generic type/validation errors.
  These do NOT prove auth is enforced — a server can return "not found" on both
  authenticated and unauthenticated requests. Only explicit auth rejection is a true PASS.
judge_needs_llm: false
applies_to_all_tools: true
---
