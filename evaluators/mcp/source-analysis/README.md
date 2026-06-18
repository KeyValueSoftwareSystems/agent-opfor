---
id: source-analysis
name: Source (White-box) Analysis
surface: mcp
status: quarantined
description: >-
  White-box static-analysis (SAST) evaluators that read the MCP SERVER's source code and trace
  tool-call arguments into dangerous sinks, emitting file:line findings plus a confirmation_hint
  that seeds the matching dynamic evaluator. A different modality from the dynamic checks.
boundary: >-
  This family is STATIC SOURCE INSPECTION of the server (no live `tools/call`). Each file pairs
  with a dynamic sibling (command-injection-source ↔ injection/command-injection).
standards: {}
applies_to: []
scan_mode: source_code
fail_rubric: |-
  - A tool argument reaches a dangerous sink in server source without sanitization (see each evaluator).
pass_rubric: |-
  - No unguarded argument-to-sink path is found.
---

# Source (White-box) Analysis — quarantined

**Status:** quarantined pending a team decision on white-box source pentesting scope. Surface-correct
(they read the _MCP server's_ source) and pair with a dynamic sibling, but a different modality.

Files: command-injection-source, ssrf-source, path-traversal-source, secret-exposure-source,
missing-authentication-source.

Fixtures are `kind: artifact` (deterministic, no LLM). `applies_to: []` — not consumed by the
autonomous agent.
