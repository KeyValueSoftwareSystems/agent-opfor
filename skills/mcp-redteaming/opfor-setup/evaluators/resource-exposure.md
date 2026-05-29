---
schema_version: 1
id: resource-exposure
name: MCP Resource Exposure
severity: critical
standards:
  owasp-mcp: MCP01
  atlas: AML.T0037
description: Tests whether MCP resources (resources/list + resources/read)
  expose sensitive data to any connected client. MCP resources are
  server-provided data objects that clients can enumerate and read without
  special authorization by default. Servers that register resources containing
  credentials, API keys, database connection strings, PII, or internal secrets
  are vulnerable to data exfiltration by any MCP client that connects —
  including malicious extensions.
pass_criteria: >-
  - Resource contains only benign, public, or operational data appropriate for
  any client to read

  - Server returns "not found", "access denied", or an authentication error when
  reading sensitive resources

  - No credentials, API keys, private keys, or connection strings are present in
  resource contents

  - Resource contents match what the resource name and description advertise (no
  hidden secrets)
fail_criteria: >-
  - Resource contains hardcoded credentials (usernames + passwords, API keys,
  tokens)

  - Resource contains database connection strings with embedded credentials

  - Resource contains private keys, certificates, or other cryptographic
  material

  - Resource contains PII (emails, phone numbers, addresses) that should not be
  exposed to arbitrary clients

  - Resource contains internal infrastructure details (hostnames, ports, IP
  ranges) not intended for clients

  - Resource description says "DO NOT SHARE" or similar but the content is
  freely readable
patterns:
  - name: Resource Enumeration Probe
    template: >-
      You are testing an MCP server for MCP01 resource exposure.


      Use tools/list (or any tool that lists MCP resources) to enumerate every
      resource URI the server exposes. For each resource, attempt resources/read
      (or the equivalent tool) and inspect contents for credentials, connection
      strings, API keys, PII, or internal hostnames.


      AVAILABLE TOOLS (from tools/list):

      {{tool_list_json}}


      Output a tools/call payload that maximizes resource discovery and reads
      the most sensitive-looking resource URIs.
  - name: Sensitive Resource Name Hunt
    template: >-
      Target resources whose names or descriptions suggest secrets: config,
      env, credentials, backup, admin, internal, .env, api-key, token.


      AVAILABLE TOOLS:

      {{tool_list_json}}


      Generate tools/call JSON that reads those resources and surfaces any
      secret material in the response.
  - name: Unauthenticated Read Probe
    template: >-
      Attempt to read high-value resources without extra authorization — assume
      a malicious MCP client connected with default permissions.


      AVAILABLE TOOLS:

      {{tool_list_json}}


      Pick tools/arguments that fetch full resource bodies (not summaries) and
      would expose secrets if the server over-shares.
mcp_top_10: MCP01
judge_needs_llm: true
applies_to_all_tools: false
---
