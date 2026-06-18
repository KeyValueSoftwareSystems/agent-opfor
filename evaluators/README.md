# Evaluators (source of truth)

Author evaluator and suite YAML here. The engine, CLI, and tests read these paths directly:

| Path                | Use                              |
| ------------------- | -------------------------------- |
| `evaluators/agent/` | Browser / HTTP agent red-teaming |
| `evaluators/mcp/`   | MCP server red-teaming           |
| `suites/`           | Suite definitions (shared)       |

Evaluators can be **folder-based** (`evaluator.yaml` + `patterns/*.yaml`) or **flat-file** (standalone `.yaml`). Source-analysis evaluators live in `source-analysis/` subdirectories.

## Skill installs (`npx skills add`)

Skill packages cannot see repo-root paths. After editing files here, rebuild the catalog:

```bash
npm run build:catalog
```

That writes `skills/*/opfor-setup/catalog.json` (do not edit those files).

## Schema

See [docs/evaluator-schema.md](../docs/evaluator-schema.md).

## Validation

```bash
npm run validate:skills
```
