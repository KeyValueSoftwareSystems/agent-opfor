# Evaluator schema

Evaluators are YAML files under `evaluators/{agent|mcp}/` at repo root. After adding or editing, run `npm run build:catalog` to rebuild the skill catalogs.

## Required fields

```yaml
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
# Flat layout only — omit when patterns live in a patterns/ directory:
patterns:
  - name: Pattern label
    template: Attack prompt text
```

| Field           | Required         | Notes                                                                                                   |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `id`            | yes              | Kebab-case, unique across both surfaces                                                                 |
| `name`          | yes              | Display name                                                                                            |
| `severity`      | yes              | `critical`, `high`, `medium`, `low`                                                                     |
| `standards`     | recommended      | Map of taxonomy key → ID (e.g. `owasp-llm: LLM07`, `atlas: AML.T0056`); omit or leave empty if unmapped |
| `pass_criteria` | yes              | Injected verbatim into the judge prompt                                                                 |
| `fail_criteria` | yes              | Injected verbatim into the judge prompt                                                                 |
| `patterns`      | flat layout only | Non-empty array of `{ name, template }`; omit when using the directory layout                           |
| `description`   | recommended      | Short summary for docs and skills                                                                       |

### `standards` keys

| Key             | Example values                  | Auto-derived suite |
| --------------- | ------------------------------- | ------------------ |
| `owasp-llm`     | `LLM01` … `LLM10`               | `owasp-llm-top10`  |
| `owasp-mcp`     | `MCP01` … `MCP10`               | `owasp-mcp-top10`  |
| `owasp-agentic` | `ASI01` …                       | `owasp-agentic-ai` |
| `owasp-api`     | `API1`, `API4`, …               | `owasp-api-top10`  |
| `atlas`         | `AML.T0056`, …                  | `mitre-atlas`      |
| `eu-ai-act`     | `Art.5`, `Art.10`, …            | `eu-ai-act`        |
| `nist`          | `Safe`, `Secure & Resilient`, … | `nist-ai-rmf`      |

Setting a `standards` key automatically includes the evaluator in the corresponding auto-derived suite — see `deriveStandardSuites()` in `core/src/catalog/loadEvaluatorCatalog.ts` (and its duplicate in `runners/extension/scripts/build-catalog.mjs`, which must be kept in sync by hand).

## Optional fields

| Field                  | Purpose                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `schema_version`       | `1` when set                                                                         |
| `judge_needs_llm`      | `true` for semantic judgment; `false` for regex/static checks                        |
| `applies_to_all_tools` | MCP only — `true` generates attacks for every tool in `tools/list`                   |
| `judge_hint`           | Extra guidance appended to the judge prompt                                          |
| `surfaces`             | `agent`, `browser`, `mcp` — informational; runner uses scan config                   |
| `turn_mode`            | `single` or `multi` — informational; runner uses `opfor` config `turnMode` / `turns` |

## Directory layout (multiple patterns)

When patterns are long or numerous, split them out:

```
evaluators/agent/<category>/<id>/
  evaluator.yaml      ← all fields above except patterns
  patterns/
    <slug>.yaml       ← { name, template }
  <id>.test.yaml      ← { kind: response, pass_case, fail_case }
```

## Validation

```bash
npm run validate:skills
npm run build:catalog:check   # verify catalog is up to date
```

Both run on pre-commit via Husky. `validate:skills` checks frontmatter shape against its own Zod schema (`EvaluatorYamlSchema` in `scripts/validate-skills.ts`) — a separate, hand-maintained schema from the runtime loader's `EvaluatorFrontmatterSchema` in `core/src/evaluators/schema.ts` (whose `standards` field is a fully open string-to-string record, so it never rejects a taxonomy key). Keep the two in sync manually when adding a new `standards` key.

## Related files

| Path                                       | Role                           |
| ------------------------------------------ | ------------------------------ |
| `core/src/evaluators/schema.ts`            | Zod contract                   |
| `core/src/evaluators/standards.ts`         | Standards key → suite ID map   |
| `core/src/evaluators/parseEvaluator.ts`    | Runtime loader                 |
| `core/src/catalog/loadEvaluatorCatalog.ts` | Auto-derived suite logic       |
| `scripts/validate-skills.ts`               | Batch validation               |
| `scripts/build-catalog.ts`                 | Catalog builder                |
| `docs/evaluators.md`                       | Suites and evaluator reference |
