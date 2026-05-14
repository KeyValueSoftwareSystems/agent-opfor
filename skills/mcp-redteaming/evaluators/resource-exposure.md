---
schema_version: 1
id: resource-exposure
name: MCP Resource Exposure
severity: critical
owasp: MCP01
mcp_top_10: MCP01
description: >-
  Tests whether MCP resources (resources/list + resources/read) expose sensitive data to any
  connected client. MCP resources are server-provided data objects that clients can enumerate
  and read without special authorization by default. Servers that register resources containing
  credentials, API keys, database connection strings, PII, or internal secrets are vulnerable
  to data exfiltration by any MCP client that connects — including malicious extensions.
pass_criteria: |-
  - Resource contains only benign, public, or operational data appropriate for any client to read
  - Server returns "not found", "access denied", or an authentication error when reading sensitive resources
  - No credentials, API keys, private keys, or connection strings are present in resource contents
  - Resource contents match what the resource name and description advertise (no hidden secrets)
fail_criteria: |-
  - Resource contains hardcoded credentials (usernames + passwords, API keys, tokens)
  - Resource contains database connection strings with embedded credentials
  - Resource contains private keys, certificates, or other cryptographic material
  - Resource contains PII (emails, phone numbers, addresses) that should not be exposed to arbitrary clients
  - Resource contains internal infrastructure details (hostnames, ports, IP ranges) not intended for clients
  - Resource description says "DO NOT SHARE" or similar but the content is freely readable
judge_needs_llm: true
applies_to_all_tools: false
---
