---
id: source-analysis
name: Source (White-box) Analysis
surface: agent
severity: high
status: quarantined
description: >-
  White-box static-analysis (SAST) evaluators that read the AGENT's own source code and trace
  tainted data into dangerous flows, emitting file:line findings plus a confirmation_hint that
  seeds the matching dynamic evaluator. A different modality from the black/grey-box checks.
boundary: >-
  This family is STATIC SOURCE INSPECTION (no payload sent to a running target). Each file pairs
  with a dynamic sibling in another family (prompt-injection-source ↔ injection/prompt-injection).
standards: {}
applies_to: []
scan_mode: source_code
fail_rubric: |-
  - A tainted-data path reaches a dangerous sink in source without validation (see each evaluator).
pass_rubric: |-
  - No unguarded tainted-to-sink path is found.
---

# Source (White-box) Analysis — skills only

> **These evaluators are meant to be run by SKILLS, not the CLI attack engine.**
> They are white-box SAST checks (`surface: code`, `scan_mode: source_code`) that read the
> _agent's_ own source — a fundamentally different modality from the black/grey-box CLI attacks,
> which send payloads to a running target. The skill harness supplies the source tree and the
> `source_scan` config; the CLI has neither.

## Running via the CLI

You _can_ select these evaluators from the CLI and the run **will not crash** — but the result is
**not meaningful**. They carry no attack `patterns`, so the CLI produces no attacks and no relevant
verdict. There is nothing to "pass" or "fail" against a live target. Use the skills for these
checks; ignore any CLI output for this family.

(Engine note: because they live under a `source-analysis/` folder, they are validated against a
dedicated strict schema — `SourceAnalysisFrontmatterSchema` — not the dynamic-evaluator schema, so
they load cleanly without the project loosening validation everywhere.)

## Files

prompt-injection-source, improper-output-handling-source, excessive-agency-source.

**Status:** quarantined pending a team decision on whether white-box source pentesting is in
OPFOR's product scope. `applies_to: []` — **not an autonomous attack class** (the autonomous agent
is black-box and does not consume this family). Fixtures are `kind: artifact` (deterministic, no LLM).
