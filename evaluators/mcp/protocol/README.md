---
id: protocol
name: Protocol & Telemetry
surface: mcp
description: >-
  Abuses of the MCP protocol layer and observability — malformed/abusive protocol messages,
  intent subversion of the request/response flow, timing side channels, and audit/telemetry
  gaps that hide malicious activity.
boundary: >-
  This family is the PROTOCOL/OBSERVABILITY layer (catch-all for cross-cutting server behaviour).
  Argument-to-sink injection is `injection/`; data exposure is `disclosure/`.
standards: { owasp-mcp: MCP10 }
applies_to: []
fail_rubric: |-
  - The server mishandles abusive/malformed protocol messages or allows intent subversion.
  - Timing differences leak information, or audit/telemetry fails to record sensitive actions.
pass_rubric: |-
  - The server handles protocol messages safely and records sensitive actions for audit.
---
# Protocol & Telemetry

**Add an evaluator here if** the attack targets *MCP protocol handling or observability*.
Examples: protocol-abuse, intent-subversion, timing-side-channel, audit-telemetry.

> This is intentionally a **catch-all** for cross-cutting server-protocol concerns; split it
> later if any sub-area grows.
