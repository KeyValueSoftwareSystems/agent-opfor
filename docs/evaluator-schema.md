# Evaluator schema

Evaluators are YAML files authored under `evaluators/{agent|mcp}/` at repo root. The engine reads those paths; `npm run build:catalog` generates `skills/*/opfor-setup/catalog.json` for skill installs.

## Two evaluator shapes

### Folder-based (evaluator with separate attack patterns)

```
evaluators/mcp/injection/ssrf/
├── evaluator.yaml        # vulnerability definition
└── patterns/
    ├── aws-imdsv1-metadata-ssrf.yaml
    └── internal-network-probe.yaml
```

`evaluator.yaml` has all required fields (see below). Pattern files each have `name` and `template`.

### Flat-file (standalone)

A single `.yaml` file with all fields inline, including a `patterns` array.

## Required fields

```yaml
id: system-prompt-leakage
name: System Prompt Leakage
severity: critical # critical | high | medium | low
standards:
  owasp-llm: LLM07
  atlas: AML.T0056
description: One-line summary for judges and contributors
pass_criteria: |-
  - Bullet list of safe behaviors
fail_criteria: |-
  - Bullet list of vulnerable behaviors
patterns:
  - name: Pattern label
    template: Attack prompt text
```

| Field           | Required    | Notes                                                                                                   |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `id`            | yes         | Kebab-case, unique across both skill trees                                                              |
| `name`          | yes         | Display name                                                                                            |
| `severity`      | yes         | `critical`, `high`, `medium`, `low`                                                                     |
| `standards`     | recommended | Map of taxonomy key → ID (e.g. `owasp-llm: LLM07`, `atlas: AML.T0056`); omit or leave empty if unmapped |
| `pass_criteria` | yes         | Injected into the judge prompt                                                                          |
| `fail_criteria` | yes         | Injected into the judge prompt                                                                          |
| `patterns`      | yes         | Non-empty array of `{ name, template }` for dynamic evaluators; empty for source-scan evaluators        |
| `description`   | recommended | Short summary for docs and skills                                                                       |

### Common `standards` keys

| Key             | Example values                                              |
| --------------- | ----------------------------------------------------------- |
| `owasp-llm`     | `LLM01` … `LLM10`                                           |
| `owasp-mcp`     | `MCP01` … `MCP10`                                           |
| `owasp-agentic` | `ASI01` …                                                   |
| `owasp-api`     | `API1`, `API4`, …                                           |
| `atlas`         | `AML.T0056`, …                                              |
| `trust-safety`  | `general` (bias / off-topic evaluators without an OWASP ID) |

## Optional fields

| Field                | Purpose                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `scan_mode`          | `source_code` or `tool_description` — non-runtime evaluators          |
| `correlates_with`    | ID of the dynamic evaluator this source evaluator is paired with      |
| `source_scan`        | Language-specific sink/source patterns for static analysis evaluators |
| `surfaces`           | `agent`, `browser`, `mcp` — where this evaluator applies              |
| `turn_mode`          | `single` or `multi`                                                   |
| `judge_needs_llm`    | `true` if judging requires LLM (vs regex/deterministic)               |
| `judge_instructions` | Extra guidance for the judge LLM                                      |
| `mcp_top_10`         | OWASP MCP Top 10 reference                                            |

## Source-analysis evaluators

Source evaluators live in `source-analysis/` subdirectories and have `scan_mode: source_code`, `patterns: []`, and a `source_scan` block with language-specific sink/source patterns. They are linked to their dynamic counterpart via `correlates_with`.

## Pattern files

Each pattern file in `patterns/` has:

```yaml
name: AWS IMDSv1 Metadata SSRF
template: >-
  For any tool parameter accepting a URL, supply http://169.254.169.254/latest/meta-data/...
```

## Validation

```bash
npm run validate:skills
```

Runs on pre-commit (husky) when hooks are installed.

## Related files

| Path                                    | Role               |
| --------------------------------------- | ------------------ |
| `core/src/evaluators/schema.ts`         | Zod contract       |
| `core/src/evaluators/standards.ts`      | Formatting helpers |
| `core/src/evaluators/parseEvaluator.ts` | Runtime loader     |
| `scripts/validate-skills.ts`            | Batch validation   |
| `scripts/build-catalog.ts`              | Catalog generator  |
