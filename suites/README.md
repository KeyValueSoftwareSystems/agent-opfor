# Suites

Suites reference evaluator **IDs** (the `id:` in each evaluator's frontmatter), never file paths —
so moving an evaluator between family folders never breaks a suite.

## Surface split (mirrors `evaluators/`)

A suite runs against a single target, and a target is **either** an agent (chat/HTTP) **or** an
MCP server (`tools/call`/stdio) — never both. So a suite is inherently surface-specific, and the
folder reflects that:

| Path            | Use                                   |
| --------------- | ------------------------------------- |
| `suites/agent/` | curated agent red-teaming suites      |
| `suites/mcp/`   | curated MCP-server red-teaming suites |

## Curated only

These folders hold **only curated, opinionated subsets**:

- `agent/quick-smoke.yaml` — fast high-signal agent subset for CI / first run
- `agent/pre-deploy-critical.yaml` — broader pre-deployment gate (highest-severity modes)
- `agent/harmful-content.yaml` — MLCommons + Harmbench harm taxonomy subset
- `agent/output-trust-and-safety.yaml` — output-quality / trust-boundary subset
- `mcp/mcp-smoke.yaml` — fast high-signal MCP-server subset

## Standard suites are derived, not stored

The **standard suites** (OWASP LLM Top 10, OWASP MCP Top 10, OWASP Agentic, OWASP API, EU AI Act
bias, ATLAS) are **not** kept here — they are **derived at load time** from each evaluator's
`standards:` frontmatter, so they can never drift. A grouping that has **no accepted standard id**
(e.g. `harmful-content`, `output-trust-and-safety`) can't be derived, so it's written by hand here.
(Derivation lands with the engine work — see `docs/evaluator-restructure-engine-todo.md` §F.)

Suite files are `.yaml`, frontmatter only: `id` (required), `evaluators: [id, ...]` (required),
optional `name` / `description`.
