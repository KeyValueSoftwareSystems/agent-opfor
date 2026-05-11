# AGENT.md — Astra

This file is for AI coding agents (Claude Code, Copilot, Cursor, etc.) working in this repository. It describes the project structure, build system, key conventions, and how the core subsystems fit together.

For the full developer guide see [`docs/Agents.md`](docs/Agents.md).

---

## What this project is

Astra is an open-source red-teaming toolkit for AI agents and MCP servers. It generates OWASP-mapped attack prompts, fires them at a target, and judges each response with an LLM. Output is an HTML + JSON report.

**Three usage modes — one set of evaluators:**

| Mode       | Entry point                                    | Who runs it                                  |
| ---------- | ---------------------------------------------- | -------------------------------------------- |
| Skills     | `/astra-setup`, `/astra-run` slash commands    | AI coding agent reads markdown skill files   |
| CLI        | `astra setup` / `astra generate` / `astra run` | User in terminal or CI                       |
| MCP Server | `astra_setup`, `astra_run` tools               | MCP-compatible host (Cursor, Claude Desktop) |

---

## Monorepo structure

```
astra/
├── core/                        # Shared engine — npm workspace; compiled to core/dist/
│   └── src/
│       ├── config/              # types.ts (all TS types), schema.ts (Zod), loadSkillCatalog.ts, skillsLayout.ts
│       ├── lib/                 # agent.ts (HTTP dispatch), localScriptTarget.ts, tracePropagation.ts
│       ├── mcp-client/          # createClient.ts — MCP transport factory (stdio, SSE/HTTP)
│       ├── evaluators/          # judge.ts, parseEvaluator.ts, generatePrompts.ts
│       ├── attacks/             # generatePlan.ts, planSchema.ts, replayArtifacts.ts
│       ├── providers/           # factory.ts — createModel() for openai/anthropic/google/groq/other
│       ├── report/              # generateReport.ts, renderHtml.ts
│       ├── run/                 # executeAttack.ts, judge.ts, generateNextMcpAttackTurn.ts
│       └── telemetry/           # Langfuse and Netra adapters
├── cli/                         # npm workspace — `astra` CLI binary
│   └── src/
│       ├── index.ts             # CLI entrypoint (commander)
│       ├── commands/
│       │   ├── init.ts          # `astra init`
│       │   ├── setup.ts         # `astra setup` (interactive wizard)
│       │   ├── generate.ts      # `astra generate --config` (non-interactive)
│       │   ├── run.ts           # `astra run --attacks`
│       │   ├── agent/           # agent-mode subcommands
│       │   └── mcp/             # mcp-mode subcommands
│       └── lib/                 # artifacts.ts, env.ts, unifiedConfig.ts
├── mcp/                         # npm workspace — MCP server (`astra_setup`, `astra_run` tools)
│   └── src/
│       ├── index.ts             # MCP server entrypoint — registers tools, stdio transport
│       └── core/
│           ├── setup.ts         # runSetup() — thin wrapper over @astra/core
│           └── run.ts           # runScan() — thin wrapper over @astra/core
├── extension/                   # npm workspace — browser extension
├── skills/
│   ├── agent-redteaming/
│   │   └── astra-setup/
│   │       ├── SKILL.md         # /astra-setup slash command
│   │       ├── evaluators/      # 55+ evaluator .md files (agent-prompt style)
│   │       ├── suites/          # Suite .md files grouping evaluator IDs
│   │       └── targets/         # Target adapter docs (http-endpoint, custom-function)
│   └── mcp-redteaming/
│       ├── evaluators/          # MCP-native evaluator .md files (JSON-RPC payload style)
│       └── suites/              # owasp-mcp-top10.md
├── tests/
│   └── e2e/
│       └── agents/              # Test agents for local developer testing (never published)
│           └── vanilla-chat/    # Plain LLM chat agent — covers LLM Top 10 + Trust & Safety evaluators
│               ├── package.json          # private workspace; all deps are devDependencies
│               ├── src/index.ts          # Express + LangChain multi-provider server
│               ├── Dockerfile
│               ├── docker-compose.yml    # `docker compose up` → agent on :4000
│               ├── astra.config.json     # ready-to-use config pointing at localhost:4000
│               └── .env.example
├── docs/
│   ├── Agents.md                # Full developer guide (read this before editing)
│   ├── cli.md                   # Complete CLI reference
│   └── mcp.md                   # MCP server setup and tools reference
└── findings/                    # Community-submitted vulnerability writeups
```

---

## Build

```bash
npm install --ignore-scripts     # --ignore-scripts skips build during install (core must compile first)
npm run build                    # tsc -b core cli mcp + extension catalog (always run from root)
npm run typecheck                # type-check without emit
npm run lint                     # eslint
npm run lint:fix                 # eslint --fix
npm run format                   # prettier --write
npm run format:check             # prettier --check
```

`core` must compile before `cli` or `mcp` — both import from `core/dist/`. Always run `npm run build` from the repo root, never per-package.

---

## Key files

| File                                    | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `core/src/config/types.ts`              | All TypeScript types for configs, attacks, results                                      |
| `core/src/config/schema.ts`             | Zod schemas — single source of truth for validation                                     |
| `core/src/config/skillsLayout.ts`       | `getAstraSetupRoot()` — resolves `skills/astra-setup/` path at runtime from any context |
| `core/src/config/loadSkillCatalog.ts`   | Reads evaluator metadata and suite lists from `.md` frontmatter                         |
| `core/src/lib/agent.ts`                 | HTTP attack dispatch, `callTargetHttp()`                                                |
| `core/src/lib/localScriptTarget.ts`     | Local script target (stdin/stdout) dispatch                                             |
| `core/src/mcp-client/createClient.ts`   | MCP client factory — `{ client, close }` for stdio or SSE                               |
| `core/src/evaluators/judge.ts`          | LLM-as-judge: response + criteria → PASS/FAIL + rationale                               |
| `core/src/evaluators/parseEvaluator.ts` | Loads evaluator `.md`, parses YAML frontmatter → `EvaluatorSpec`                        |
| `core/src/attacks/generatePlan.ts`      | Calls LLM to fill `{{placeholder}}` variables in attack templates                       |
| `core/src/run/executeAttack.ts`         | Single attack execution — dispatch + judge                                              |
| `core/src/report/generateReport.ts`     | Produces `report.html` and `report.json`                                                |
| `cli/src/commands/setup.ts`             | Interactive setup wizard                                                                |
| `cli/src/commands/generate.ts`          | Non-interactive attack generation (`astra generate`)                                    |
| `cli/src/commands/run.ts`               | Run entrypoint (`astra run`)                                                            |
| `mcp/src/index.ts`                      | MCP server: registers `astra_list_evaluators`, `astra_setup`, `astra_run` tools         |

---

## How evaluators work

Evaluators are `.md` files with YAML frontmatter. The engine loads them dynamically — no TypeScript changes needed to add one.

```yaml
---
schema_version: 1
id: command-injection # must match filename without .md
name: Command Injection
severity: critical # critical | high | medium | low
owasp: MCP05
description: >-
  One or two sentences on what this evaluator tests.
pass_criteria: |-
  - Observable conditions that mean the target responded safely
fail_criteria: |-
  - Observable conditions that mean the target is vulnerable
patterns:
  - name: Shell Metacharacters
    template: |-
      Attack prompt text. Use {{placeholder}} for LLM-filled variables.
---
```

**`skillsLayout.ts` is critical** — it uses `import.meta.url` to resolve `skills/astra-setup/` relative to the compiled file location. Any code that needs the skills path must call `getAstraSetupRoot()` from here, never hardcode paths.

**Agent-redteaming evaluators** (`skills/agent-redteaming/`) send the rendered template as a plain prompt to the target.

**MCP-redteaming evaluators** (`skills/mcp-redteaming/`) produce JSON-RPC payloads fired directly at the MCP server. Templates include `{{tool_list_json}}` replaced with the live `tools/list` response.

---

## How the run loop works

1. Read the attacks JSON file (`PromptsFile` type from `core/src/config/types.ts`)
2. For each `AttackEntry`:
   - `http-endpoint` → `callTargetHttp()`
   - `local-script` / `python-function` → `invokeLocalTargetScript()`
   - MCP targets → MCP client dispatch via `core/src/mcp-client/`
3. Raw response string → `judgeResponse()` with evaluator `pass_criteria` / `fail_criteria`
4. Results → `generateReport()`

Multi-turn loops steps 2–3 up to `turns` times, feeding each response back as context for the next attacker LLM call.

---

## Developer testing with test agents

`tests/e2e/agents/` contains pre-built target agents developers can spin up locally to test evaluator changes without needing a real external service.

### vanilla-chat

A plain Express + LangChain chat agent (no tools). Supports `openai`, `anthropic`, `groq`, `google`, and any OpenAI-compatible endpoint via `BASE_URL`.

```bash
# 1. Start the agent (Docker)
cd tests/e2e/agents/vanilla-chat
cp .env.example .env          # set PROVIDER + the agent's API key
docker compose up -d          # agent on http://localhost:4000/chat

# 2. Set the attack LLM key in your shell (separate from the Docker .env)
export GROQ_API_KEY=your-key-here

# 3. Generate + run from repo root
cd ../../../..
astra generate --config tests/e2e/agents/vanilla-chat/astra.config.json
astra run --attacks .astra/attacks/astra-attacks-*-vanilla-chat.json
```

The `astra.config.json` uses the **unified config format** (`configId` + `createdAt` + `agent` block). The `apiKeyEnv` field takes the env var **name** (e.g. `"GROQ_API_KEY"`), not the key value itself.

**Covered evaluators:** OWASP LLM Top 10, Trust & Safety (bias, misinformation), system-prompt-leakage, jailbreaking.

### Adding a new test agent

See [CONTRIBUTING.md](CONTRIBUTING.md) — "Adding a test agent" section.

---

## Adding an evaluator (no TypeScript needed)

1. Create `skills/agent-redteaming/astra-setup/evaluators/<id>.md` (or `mcp-redteaming` equivalent)
2. Fill YAML frontmatter: `id`, `name`, `severity`, `owasp`, `description`, `pass_criteria`, `fail_criteria`, `patterns`
3. Add the ID to at least one suite's `evaluators:` list in `skills/*/suites/`
4. Test: `astra setup` → select your evaluator → `astra generate` → `astra run`
5. PR to `master` — see [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Adding a target adapter

1. Implement a function in `core/src/lib/` or `core/src/mcp-client/` — takes a prompt string, returns a response string
2. Add a new `type` value to `TargetConfig` in `core/src/config/types.ts` and the Zod union in `core/src/config/schema.ts`
3. Add a routing branch in `core/src/run/executeAttack.ts`
4. Add CLI options in `cli/src/commands/run.ts` and `setup.ts`
5. Add Zod schema fields in `mcp/src/index.ts` for the `astra_setup` tool

---

## Coding conventions

- **TypeScript strict mode** — no `any` without a comment explaining why
- **Zod for all external input** — config files, LLM responses, MCP responses; never `JSON.parse` directly into a typed variable
- **No barrel re-exports** — import directly from the file that owns the symbol
- **Error messages are actionable** — tell the user what to fix, not just what went wrong
- **Evaluator files are data** — no business logic in `.md` files; logic lives in `core/src/evaluators/`
- **Never invoke the CLI as a subprocess from the MCP server** — call `@astra/core` directly

---

## Environment variables

| Variable                                      | Purpose                             |
| --------------------------------------------- | ----------------------------------- |
| `OPENAI_API_KEY`                              | OpenAI provider                     |
| `ANTHROPIC_API_KEY`                           | Anthropic provider                  |
| `GOOGLE_GENERATIVE_AI_API_KEY`                | Google provider                     |
| `GROQ_API_KEY`                                | Groq provider                       |
| `ASTRA_API_KEY`                               | Generic key for `provider: "other"` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Langfuse telemetry                  |
| `NETRA_API_KEY`                               | Netra telemetry                     |

Copy `.env.example` to `.env` and fill in at least one provider key before running locally.

---

## PR and branch conventions

Branch names: `<type>/<short-description>` — e.g. `feat/add-ssrf-evaluator`, `fix/judge-false-positive`

PR titles: `<type>: <what changed>` — e.g. `feat: add SSRF evaluator for MCP05`

Types: `feat`, `fix`, `docs`, `refactor`, `chore`

Pre-commit hooks (husky + lint-staged) run `eslint` and `prettier` on staged files. Do not skip with `--no-verify`.

Full checklist: [CONTRIBUTING.md](CONTRIBUTING.md)
