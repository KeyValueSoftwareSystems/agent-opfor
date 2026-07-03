---
id: source-analysis
name: Source (White-box) Analysis
surface: mcp
severity: critical
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

# Source (White-box) Analysis — skills only

> **These evaluators are meant to be run by SKILLS, not the CLI attack engine.**
> They are white-box SAST checks (`surface: code`, `scan_mode: source_code`) that read the
> _MCP server's_ own source — a different modality from the dynamic CLI checks, which issue live
> `tools/call`s to a running server. The skill harness supplies the source tree and the
> `source_scan` config; the CLI has neither.

## Running via the CLI

You _can_ select these evaluators from the CLI and the run **will not crash** — but the result is
**not meaningful**. They carry no attack `patterns`, so the CLI produces no attacks and no relevant
verdict. Use the skills for these checks; ignore any CLI output for this family.

(Engine note: because they live under a `source-analysis/` folder, they are validated against a
dedicated strict schema — `SourceAnalysisFrontmatterSchema` — not the dynamic-evaluator schema, so
they load cleanly without the project loosening validation everywhere.)

## Files

command-injection-source, ssrf-source, path-traversal-source, secret-exposure-source,
missing-authentication-source.

**Status:** quarantined pending a team decision on white-box source pentesting scope.
`applies_to: []` — not consumed by the autonomous agent. Fixtures are `kind: artifact`
(deterministic, no LLM).
