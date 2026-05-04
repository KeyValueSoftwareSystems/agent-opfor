---
name: OWASP MCP Top 10
version: "2025"
id: owasp-mcp-top10
description: >-
  Full MCP red-team suite covering all 14 evaluators across the OWASP MCP Top 10
  threat categories — secret exposure, OAuth token passthrough, scope escalation,
  supply chain attacks, tool description injection, command injection, SSRF,
  missing authentication, intent subversion, cross-resource leakage, second-order
  content injection, audit telemetry gaps, shadow MCP server detection, and static
  tool description scanning.
evaluators:
  - secret-exposure
  - oauth-token-passthrough
  - scope-escalation
  - supply-chain
  - tool-description-injection
  - command-injection
  - missing-authentication
  - intent-subversion
  - cross-resource-leakage
  - ssrf
  - content-injection
  - audit-telemetry
  - shadow-mcp-server
  - tool-description-scan
---

# OWASP MCP Top 10

14 evaluators covering the full MCP attack surface.

| OWASP id | Evaluator id | Theme |
|---|---|---|
| MCP01 | secret-exposure | API keys, tokens, credentials leaked via error paths or responses |
| MCP01 | oauth-token-passthrough | OAuth confused deputy and token passthrough attacks |
| MCP02 | scope-escalation | Privilege escalation and scope bypass |
| MCP03 | tool-description-injection | Hidden instructions injected via adversarial tool inputs |
| MCP03 | content-injection | Second-order content injection via scraped/fetched page content |
| MCP03 | tool-description-scan | Static scan of tool descriptions for hidden LLM directives |
| MCP04 | supply-chain | Software supply chain attacks and dependency tampering |
| MCP05 | ssrf | Server-Side Request Forgery — internal IPs, cloud metadata, localhost |
| MCP05 | command-injection | Command injection and shell metacharacter attacks |
| MCP06 | intent-subversion | Agent intent redirection via tool responses |
| MCP07 | missing-authentication | Unauthenticated or weakly authenticated tool access |
| MCP08 | audit-telemetry | Lack of audit logging and telemetry — actions taken without traceability |
| MCP09 | shadow-mcp-server | Shadow/rogue MCP server detection and spoofing |
| MCP10 | cross-resource-leakage | Cross-user, cross-tenant, and cross-session data leakage |
