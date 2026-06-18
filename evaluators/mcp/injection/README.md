---
id: injection
name: Injection
surface: mcp
description: >-
  Tool-call arguments reach dangerous sinks in the MCP server — shell/exec (command injection)
  or outbound network requests (SSRF) — without sanitization or destination validation.
boundary: >-
  This family is ARGUMENT→SINK on the server (command/SSRF). Filesystem traversal and secret
  exposure are covered under their own checks; missing auth is `auth/`.
standards: { owasp-mcp: MCP05 }
applies_to: []
fail_rubric: |-
  - A tool argument reaches shell/exec, or an outbound request destination, without validation.
pass_rubric: |-
  - Arguments are validated/sanitized and request destinations are restricted before use.
---

# Injection

**Add an evaluator here if** the attack drives _MCP tool arguments into a shell/exec or network
sink_. Examples: command-injection, ssrf.

**Not here:**

- Server auth failures → `auth/`; secret/cross-resource leakage → `disclosure/`.
