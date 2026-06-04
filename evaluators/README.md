# Evaluators (source of truth)

Author evaluator and suite markdown here. The engine, CLI, and tests read these paths directly:

| Path                | Use                              |
| ------------------- | -------------------------------- |
| `evaluators/agent/` | Browser / HTTP agent red-teaming |
| `evaluators/mcp/`   | MCP server red-teaming           |
| `suites/agent/`     | Agent suite definitions          |
| `suites/mcp/`       | MCP suite definitions            |

## Skill installs (`npx skills add`)

Skill packages cannot see repo-root paths. After editing files here, sync mirrors into each skill tree:

```bash
npm run sync:skills-evaluators
```

That writes to `skills/*/opfor-setup/_generated/` (do not edit those copies).

## Schema

See [docs/evaluator-schema.md](../docs/evaluator-schema.md).

## Validation

```bash
npm run validate:skills
```
