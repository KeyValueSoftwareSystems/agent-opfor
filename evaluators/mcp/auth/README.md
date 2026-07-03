---
id: auth
name: Authentication & Authorization
surface: mcp
severity: critical
description: >-
  The MCP server fails to authenticate or authorize callers before sensitive tool actions —
  missing auth on handlers, OAuth token passthrough/confused-deputy, or scope escalation beyond
  the granted permissions.
boundary: >-
  This family is IDENTITY/PERMISSION enforcement on the server. Data that leaks without an
  authorization failure is `disclosure/`; injecting into a sink is `injection/`.
standards: { owasp-mcp: MCP07 }
applies_to: []
fail_rubric: |-
  - A tool handler acts on sensitive resources with no identity/permission check.
  - The server passes through or confuses OAuth tokens, or allows scope escalation.
pass_rubric: |-
  - Handlers verify authentication/authorization and enforce scope before acting.
---

# Authentication & Authorization

**Add an evaluator here if** the attack tests _the MCP server's auth/authz enforcement_.
Examples: missing-authentication, oauth-token-passthrough, scope-escalation.

**Not here:**

- Pure data exposure with no auth failure → `disclosure/`.
