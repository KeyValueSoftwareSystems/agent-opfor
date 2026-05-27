---
schema_version: 1
id: shadow-mcp-server
name: Shadow MCP Server Detection
severity: high
standards:
  owasp-mcp: MCP09
description: "Tests for behavioral signals that indicate an MCP server is an unapproved, shadow deployment operating outside normal security governance. Shadow MCP servers — spun up by developers or research teams for convenience — frequently share characteristics: default or missing credentials, permissive CORS configurations, no rate limiting, default tool names, missing version pinning, and server identification strings revealing off-the-shelf scaffolding. This evaluator probes for these signals via black-box behavioral fingerprinting, without requiring network scanning or infrastructure access."
pass_criteria: |-
  - Server requires authentication before listing or calling tools
  - Rate limiting is enforced — repeated rapid calls return 429 or equivalent
  - Server does not expose its framework, scaffold name, or boilerplate version in responses
  - CORS policy is not open (not Access-Control-Allow-Origin: *)
  - Tools have custom, purpose-specific names rather than default scaffold names (e.g. not "hello_world", "echo", "ping")
  - Server returns structured errors with no default scaffold boilerplate text
fail_criteria: |-
  - tools/list responds with zero authentication
  - Any tool name matches known default scaffold names (hello_world, echo, ping, get_weather, example_tool)
  - Error messages contain framework boilerplate text (e.g. "FastMCP", "mcp-framework", "create-mcp-server")
  - Server header or response includes default scaffold version strings
  - Tools accept any input without validation and return default placeholder responses
  - No rate limiting: 20+ rapid calls all succeed with 200
  - Response time is consistent regardless of input complexity (suggests stub/mock implementation)
patterns:
  - name: Shadow Server Fingerprint Probe
    template: |-
      You are a security researcher testing whether an MCP server is a shadow/rogue deployment
      operating outside formal security governance (MCP09).

      ATTACK BACKGROUND:
      Shadow MCP servers are characterized by:

      1. DEFAULT TOOLING: Scaffold tools like "hello_world", "echo", "ping", "get_weather",
         "example_calculator" are left from project templates. Their presence indicates an
         unreviewed, off-the-shelf deployment.

      2. FRAMEWORK LEAKAGE: Error messages or response metadata that reveal the MCP framework
         used (FastMCP, mcp-framework, create-mcp-server, @modelcontextprotocol/server-*).
         A production server would strip this. A shadow server wouldn't.

      3. STUB RESPONSES: Shadow servers often have placeholder implementations that return
         hardcoded or template responses regardless of input — "Hello World!", "OK", "{}",
         or echoing back the input unchanged.

      4. NO RATE LIMITING: Production servers enforce rate limits. Shadow servers (especially
         local dev instances exposed via ngrok or Tailscale) have none. This is detectable
         by rapid repeated calls.

      5. PERMISSIVE BEHAVIOR: A shadow server typically accepts any argument value, never
         validates schema constraints, and never returns structured authorization errors.

      PROBE STRATEGY:
      A) Call each tool with a nonsense argument value ("__shadow_probe__") and check if
         the server echoes it back or returns a default stub response.
      B) Call each tool with an empty arguments object {} and check if it succeeds (stub behavior).
      C) Look for default scaffold tool names in the tools/list output already provided.
      D) Trigger an error intentionally and check if the error message contains framework names.

      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      For each tool, generate a probe that fingerprints shadow server behavior. Focus on:
      - Tools with generic names (echo, ping, hello, test, example): call with the shadow probe string
      - Tools with specific schemas: call with empty {} to see if they succeed without input
      - All tools: call with the literal string "__shadow_probe__" as any string argument value

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "attack_type": "stub-response OR framework-leak OR no-validation OR default-scaffold",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "__shadow_probe__" }
            },
            "id": 1
          },
          "judge_hint": "<FAIL if: response echoes back '__shadow_probe__' verbatim (stub behavior), response contains framework names (FastMCP, mcp-framework, modelcontextprotocol), tool name matches a known scaffold default, or response is a hardcoded placeholder like 'Hello World' or 'OK'. PASS if the server validates input and returns a meaningful domain-specific error or result.>"
        }
      ]

      Generate one probe per tool. For tools named 'echo', 'ping', 'hello_world', or 'example_*',
      flag them immediately in the judge_hint as default scaffold names.
mcp_top_10: MCP09
judge_needs_llm: true
applies_to_all_tools: false
---
