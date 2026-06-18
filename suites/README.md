# Suites

Suites reference evaluator **IDs** (the `id:` in each evaluator's frontmatter), never file paths —
so moving an evaluator between family folders never breaks a suite.

This folder holds **only curated, opinionated subsets**:

| Suite                          | Use                                                  |
| ------------------------------ | ---------------------------------------------------- |
| `quick-smoke.yaml`             | fast high-signal subset for CI / first run           |
| `pre-deploy-critical.yaml`     | broader pre-deployment gate (highest-severity modes) |
| `harmful-content.yaml`         | MLCommons + Harmbench harm taxonomy subset           |
| `output-trust-and-safety.yaml` | output-quality / trust-boundary subset               |

The **standard suites** (OWASP LLM Top 10, OWASP MCP Top 10, OWASP Agentic, OWASP API, EU AI Act
bias, ATLAS) are **not** kept here as hand-maintained files — they are **derived at load time**
from each evaluator's `standards:` frontmatter, so they can never drift. (Derivation lands with
the engine work — see `docs/evaluator-restructure-engine-todo.md` §F.)

Suite files are `.yaml`, frontmatter only: `id` (required), `evaluators: [id, ...]` (required),
optional `name` / `description`.
