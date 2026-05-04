# `astra-mcp`

**Open-source red team for MCP servers:** connects to a real server, drives **`tools/call`** with evaluator-defined attacks, and judges each tool response. Outputs **HTML + JSON** reports.

[![License](https://img.shields.io/badge/license-Apache_2.0-444441?style=flat&labelColor=3d3d3a)](LICENSE)
[![MCP](https://img.shields.io/badge/focus-MCP_servers-185FA5?style=flat&labelColor=3d3d3a)](#what-astra-mcp-tests)

## Who this is for

- **MCP server authors** — regression-test tool behavior (scope, validation, errors) before release.
- **Security reviewers** — reproducible runs: fixed attack JSON, logged requests/responses, LLM-as-judge verdicts per call.
- **Contributors** — evaluators are markdown under `skills/astra-setup/evaluators/`; suites under `skills/astra-setup/suites/`.

## Quick start

```bash
cd astra-mcp
npm install
npm run build

# Create astra-mcp.config.json (stdio/command or other transport + model keys)
npx astra-mcp init

# Discover tools, generate attack plan JSON (setup model + tools/list)
export OPENAI_API_KEY=...
npx astra-mcp setup

# Run attacks against the configured MCP server; reports under .astra/reports/report-<timestamp>/
npx astra-mcp run
```

Each run writes **HTML + JSON** (and prints absolute paths when the run completes). For a local vulnerable server example (path-handling lab), see `fixtures/cve-2025-66689-pal-vulnerable/`.

## Commands

| Step | Command | Role |
|---|---|---|
| Configure | `astra-mcp init` | Writes `astra-mcp.config.json` (how to spawn/connect to your MCP + which models to use). |
| Plan | `astra-mcp setup` | Calls **`tools/list`**, uses the setup LLM + evaluator catalog to emit **`astra-mcp-attacks.json`**. |
| Execute | `astra-mcp run` | For each planned attack, calls **`tools/call`**, logs I/O, runs the **judge** model on the tool result (single- or multi-turn, per plan). |


## What `astra-mcp` tests

Coverage is whatever your **suite** includes. The default **`owasp-mcp-top10`** suite wires evaluator ids (scope escalation, SSRF, tool-description issues, etc.) to generated tool attacks — see:

- `skills/astra-setup/suites/owasp-mcp-top10.md` — suite → evaluator list  
- `skills/astra-setup/evaluators/*.md` — patterns, pass/fail criteria, citations  

The HTML/JSON report summarizes results **per evaluator** and **per attack** (tool name, arguments, raw response, judge verdict).

## Contributing

1. **Evaluators** — new or tighter `skills/astra-setup/evaluators/<id>.md`.  
2. **Suites** — compose evaluators in `skills/astra-setup/suites/<id>.md`.  

## Security disclosure

Use **`astra-mcp` only on servers you own or are authorized to test.** Publish a root **`SECURITY.md`** if you need a coordinated disclosure policy for this package.

## License

Apache 2.0 — [LICENSE](LICENSE).

## Package

Published npm name: **`@astra/mcp`**. CLI binary: **`astra-mcp`**.
