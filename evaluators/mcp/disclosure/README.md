---
id: disclosure
name: Information Disclosure
surface: mcp
description: >-
  The MCP server exposes information it should protect — hardcoded secrets/credentials, raw
  errors/stack traces, data from other resources or tenants (cross-resource leakage), or
  over-broad resource exposure.
boundary: >-
  This family is DATA EXPOSED by the server. Exposure that required an auth bypass is `auth/`;
  a poisoned tool return is `tool-poisoning/`.
standards: { owasp-mcp: MCP01 }
applies_to: []
fail_rubric: |-
  - Server returns secrets/credentials, raw exceptions/env data, or another resource's/tenant's data.
  - Server exposes resources beyond what the caller is entitled to read.
pass_rubric: |-
  - Server withholds secrets, sanitizes errors, and scopes resource access to the caller.
---
# Information Disclosure

**Add an evaluator here if** the attack makes *the MCP server expose protected data*.
Examples: secret-exposure, cross-resource-leakage, resource-exposure.

**Not here:**
- The exposure required an auth bypass → `auth/`.
