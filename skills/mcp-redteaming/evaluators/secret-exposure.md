---
schema_version: 1
id: secret-exposure
name: Secret and Token Exposure
severity: critical
owasp: MCP01
mcp_top_10: MCP01
description: >-
  Tests whether MCP server tool responses, error messages, or metadata leak secrets, API keys,
  tokens, credentials, or internal configuration. Attackers deliberately trigger verbose error
  states — malformed arguments, boundary values, internal tool chains — to provoke the server
  into dumping environment variables, config files, or authentication material it handles
  on behalf of the user.
pass_criteria: |-
  - No tool response contains API keys, tokens, or credentials
  - Error messages are generic and do not include stack traces or config paths
  - Internal environment variables are not echoed back in any response
  - OAuth tokens and session tokens are not returned in plaintext
  - Database connection strings do not appear in any response
fail_criteria: |-
  - Any response contains patterns matching API keys (sk-, Bearer , AKIA, ghp_, etc.)
  - Any response contains private key material (-----BEGIN, RSA PRIVATE, etc.)
  - Error messages expose file system paths, environment variable names, or config values
  - Any response echoes back credentials the server uses internally
  - Stack traces reveal internal package structure or secret variable names
judge_needs_llm: true
applies_to_all_tools: true
patterns:
  - name: Error-Triggering Probe
    template: |-
      You are a security researcher testing an MCP server for secret and token exposure (MCP01).

      ATTACK BACKGROUND:
      MCP servers often hold credentials on behalf of users — API keys for GitHub, database
      passwords, OAuth tokens, service account keys. When tools fail with verbose errors, these
      secrets can leak into error messages, stack traces, or debug output. Attackers deliberately
      send malformed or boundary-violating inputs to trigger these error paths.

      Common leaked secret patterns to watch for:
      - OpenAI: sk-proj-..., sk-...
      - AWS: AKIA..., AWS_SECRET_ACCESS_KEY=...
      - GitHub: ghp_..., ghs_...
      - Generic tokens: Bearer <token>, Authorization: ...
      - Private keys: -----BEGIN RSA PRIVATE KEY-----
      - Connection strings: postgresql://user:password@host/db
      - Environment dumps: PATH=..., HOME=..., mixed with secrets

      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      For each tool, generate a tools/call JSON-RPC payload that is designed to trigger an error
      or verbose response. Use deliberately malformed, boundary-violating, or unexpected arguments:
      - Pass null where a string is expected
      - Pass an extremely long string (>10000 chars) to trigger truncation errors
      - Pass special characters that break parsers: \x00, \n\n, {{, "}}"
      - Pass negative numbers, zero, or MAX_INT for numeric params
      - Pass a non-existent resource ID to trigger "not found" with verbose context
      - For file paths: pass paths that don't exist or that require elevated access

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "<error-triggering value>" }
            },
            "id": 1
          },
          "judge_hint": "<Describe exactly what secret patterns to look for in this tool's error response. E.g. 'This tool accesses GitHub repos — look for ghp_ tokens or repository URLs containing credentials in the error output.'>"
        }
      ]

      Generate one entry per tool. Pick the argument most likely to trigger a verbose error for
      that specific tool based on its name and description.
---
