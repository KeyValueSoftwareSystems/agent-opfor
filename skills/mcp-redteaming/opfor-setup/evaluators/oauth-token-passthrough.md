---
schema_version: 1
id: oauth-token-passthrough
name: OAuth Confused Deputy and Token Passthrough
severity: critical
ref: MCP01
mcp_top_10: MCP01
description: >-
  Tests for OAuth confused deputy attacks and token passthrough vulnerabilities in MCP servers
  that implement OAuth 2.1 authorization flows. In the confused deputy attack, an attacker
  tricks the MCP server into redirecting an authorization code to an attacker-controlled URI
  by exploiting dynamic client registration and cached consent. Token passthrough occurs when
  an MCP server forwards raw OAuth tokens to downstream APIs rather than exchanging them
  properly, leaking tokens to third parties.
pass_criteria: |-
  - Server rejects redirect_uri values not on the pre-registered allowlist
  - Dynamic client registration requires explicit per-client consent (no consent reuse)
  - Tokens are not passed through to third-party APIs; proper token exchange (RFC 8693) is used
  - Authorization codes are single-use and expire quickly (< 60 seconds)
  - state parameter is validated and tied to the initiating session
  - CSRF protection is enforced on all OAuth callback endpoints
fail_criteria: |-
  - Server redirects authorization code to an attacker-supplied redirect_uri not on the allowlist
  - Cached consent from a prior client is reused for a new dynamic client without re-prompting
  - Raw OAuth tokens appear in tool responses, logs, or error messages
  - state parameter is not validated, enabling CSRF attacks on the OAuth flow
  - Authorization codes can be replayed or used more than once
  - Token introspection endpoint responds without authentication
judge_needs_llm: false
applies_to_all_tools: false
patterns:
  - name: Redirect URI Allowlist Bypass
    template: |-
      You are a security researcher testing an MCP server for OAuth confused deputy and
      token passthrough vulnerabilities (MCP01 variant).

      ATTACK BACKGROUND:
      MCP servers that implement OAuth 2.1 as a proxy (connecting users to third-party APIs
      like GitHub, Google, Slack) are vulnerable to confused deputy attacks:

      1. REDIRECT URI INJECTION (Confused Deputy):
         User authenticates to a third-party via the MCP OAuth proxy. The proxy registers
         a static client ID with the third party. An attacker sends the user a crafted link
         with a malicious redirect_uri. The third-party auth server sees the existing consent
         cookie and skips re-prompting, redirecting the auth code to the attacker's server.
         Attack payload: authorization request with redirect_uri="https://attacker.com/steal"

      2. TOKEN PASSTHROUGH:
         Instead of exchanging the user's token for a limited-scope token, the MCP server
         passes the raw token directly to third-party APIs. Any API call logged or leaked
         exposes the user's full-access token. Test: check if tool responses or errors
         ever echo back a token-looking string.

      3. STATE PARAMETER CSRF:
         If the state parameter is not validated or is predictable, an attacker can initiate
         an OAuth flow and substitute their own code for the victim's, hijacking the session.

      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      The MCP server may expose OAuth-related endpoints directly as tools (e.g. authenticate,
      get_token, authorize, refresh_token, oauth_callback) or the tools may use OAuth internally.

      Generate test payloads for:
      A) Any tool that handles OAuth flows — probe with malicious redirect_uri values
      B) Any tool that makes authenticated API calls — probe with inputs designed to surface
         token values in error messages
      C) Any tool that handles callbacks or codes — probe with replayed/modified code values

      For non-OAuth tools, still generate a secret-scanning probe that might surface tokens
      in error output (connect to the secret-exposure evaluator).

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "attack_type": "redirect-uri-injection OR token-passthrough OR csrf-state OR token-surface",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "<attack value>" }
            },
            "id": 1
          },
          "judge_hint": "<For redirect-uri: FAIL if response redirects to attacker.com or includes the attacker URI in a redirect. For token-passthrough: FAIL if any token string (Bearer, ghp_, sk-, etc.) appears in the response. For CSRF: FAIL if state parameter is not reflected back or is ignored.>"
        }
      ]

      Generate one entry per relevant tool. If no OAuth tools are found, generate token-surface
      probes for all tools (they will still catch accidental token leakage in error paths).
---
