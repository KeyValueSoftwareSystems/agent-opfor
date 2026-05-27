# Evaluator schema

Evaluators are Markdown files with YAML frontmatter. The engine auto-discovers them under `skills/*/opfor-setup/evaluators/`.

## Required frontmatter

```yaml
---
schema_version: 1
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
---
```

| Field           | Required         | Notes                                                                                                   |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `id`            | yes              | Kebab-case, unique across both skill trees                                                              |
| `name`          | yes              | Display name                                                                                            |
| `severity`      | yes              | `critical`, `high`, `medium`, `low`                                                                     |
| `standards`     | recommended      | Map of taxonomy key → ID (e.g. `owasp-llm: LLM07`, `atlas: AML.T0056`); omit or leave empty if unmapped |
| `pass_criteria` | yes              | Injected into the judge prompt                                                                          |
| `fail_criteria` | yes              | Injected into the judge prompt                                                                          |
| `patterns`      | yes (agent tree) | Non-empty array of `{ name, template }`; optional for some MCP evaluators                               |
| `description`   | recommended      | Short summary for docs and skills                                                                       |

### Common `standards` keys

| Key             | Example values                                              |
| --------------- | ----------------------------------------------------------- |
| `owasp-llm`     | `LLM01` … `LLM10`                                           |
| `owasp-mcp`     | `MCP01` … `MCP10`                                           |
| `owasp-agentic` | `ASI01` …                                                   |
| `owasp-api`     | `API1`, `API4`, …                                           |
| `atlas`         | `AML.T0056`, …                                              |
| `trust-safety`  | `general` (bias / off-topic evaluators without an OWASP ID) |

Do not use `ref:` or `mitre:` in frontmatter — use `standards` instead. Pre-commit rejects those keys on **staged** evaluator files.

## Optional fields

| Field            | Purpose                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `schema_version` | `1` when set (optional)                                                                                       |
| `surfaces`       | `agent`, `browser`, `mcp` — where this evaluator applies (metadata; runner uses scan config today)            |
| `turn_mode`      | `single` or `multi` (metadata; runner uses `opfor` config `turnMode` / `turns` today)                         |
| `strategy`       | Reserved: `declarative-patterns`, `adaptive-multi-turn`, `mcp-scanner` (validated, not wired in `runAll` yet) |
| `judge_hint`     | Extra guidance for the judge LLM                                                                              |

## Markdown body

Human-readable sections (`## Attack`, `## Probes`, and so on). Tooling reads **frontmatter** for execution; the body is for contributors and skills.

## Example

`skills/agent-redteaming/opfor-setup/evaluators/system-prompt-leakage.md`

## Validation

```bash
npm run validate:skills
```

Runs on pre-commit (husky) when hooks are installed. Validates frontmatter shape with the same Zod schema as `core/src/evaluators/parseEvaluator.ts`.

## Related files

| Path                                    | Role                 |
| --------------------------------------- | -------------------- |
| `core/src/evaluators/schema.ts`         | Zod contract         |
| `core/src/evaluators/standards.ts`      | Formatting helpers   |
| `core/src/evaluators/parseEvaluator.ts` | Runtime loader       |
| `scripts/validate-skills.ts`            | Batch validation     |
| `docs/evaluators.md`                    | Suites and selection |
