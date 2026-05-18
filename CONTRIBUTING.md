# Contributing to Opfor

Thanks for helping make AI red teaming better. This guide covers the three highest-impact contribution types: new evaluators, new target adapters, and findings from running Opfor against real systems.

## Table of contents

- [Before you start](#before-you-start)
  - [Branch naming](#branch-naming)
  - [PR naming](#pr-naming)
- [Adding an evaluator](#adding-an-evaluator)
- [Adding a suite](#adding-a-suite)
- [Adding a target adapter](#adding-a-target-adapter)
- [Adding a test agent](#adding-a-test-agent)
- [Submitting findings](#submitting-findings)
- [Code contributions](#code-contributions)
- [Pull request checklist](#pull-request-checklist)

---

## Before you start

1. Check [open issues](https://github.com/KeyValueSoftwareSystems/opfor/issues) to avoid duplicating work.
2. For significant changes (new transport, architectural refactor), open an issue first to align on approach before writing code.
3. Fork the repo, create a branch off `master`, and open a PR when ready.

### Branch naming

```
<type>/<short-description>
```

| Type        | When to use                                 |
| ----------- | ------------------------------------------- |
| `feat/`     | New evaluator, suite, transport, or feature |
| `fix/`      | Bug fix                                     |
| `docs/`     | Documentation only                          |
| `refactor/` | Code change with no behaviour change        |
| `chore/`    | Dependency updates, tooling, CI             |
| `test/`     | Adding or updating tests                    |

Examples: `feat/add-prompt-leak-evaluator`, `fix/ssrf-judge-false-positive`, `docs/contributing-guide`

Keep descriptions short (3–5 words, hyphen-separated, lowercase). No ticket numbers in branch names.

### PR naming

Use the format: `<type>: <what changed>`

```
feat: add prompt-leak evaluator
fix: correct SSRF judge false positive on localhost responses
docs: add branch and PR naming guidelines
refactor: extract judge prompt builder into separate module
chore: update @modelcontextprotocol/sdk to 1.x
```

- Use the same type prefixes as branch names
- Describe the change, not the problem (`add X` not `X was missing`)
- Keep it under 72 characters so it reads cleanly in git log

### Setup

```bash
git clone https://github.com/KeyValueSoftwareSystems/opfor.git
cd opfor
npm install   # also installs Husky pre-commit hooks
npm run build
```

The pre-commit hook runs typechecking, linting, formatting, and **secret scanning via [gitleaks](https://github.com/gitleaks/gitleaks)**. It is required — commits will be blocked until it is installed:

See the [official install guide](https://github.com/gitleaks/gitleaks#installing) for your OS.

If gitleaks reports a false positive (e.g. a fake key in a test fixture), add an allowlist entry to `.gitleaks.toml`.

Set an API key so you can test locally:

```bash
cp .env.example .env
# fill in at least one provider key
```

---

## Adding an evaluator

Evaluators live in `skills/opfor-setup/evaluators/` as Markdown files with YAML frontmatter. No TypeScript changes are needed — the engine loads them automatically.

### File format

Create `skills/opfor-setup/evaluators/<your-id>.md`:

```markdown
---
schema_version: 1
id: your-evaluator-id # kebab-case, unique across all evaluators
name: Human Readable Name
severity: critical # critical | high | medium | low
owasp: MCP01 # OWASP mapping (MCP01–MCP10, LLM01–LLM10, etc.)
mcp_top_10: MCP01 # optional, if directly mapped
description: >-
  One or two sentences describing what this evaluator tests and why it matters.
pass_criteria: |-
  - Bullet list of observable conditions that indicate a SAFE response
  - Be specific — the LLM judge uses these to decide PASS
fail_criteria: |-
  - Bullet list of observable conditions that indicate a VULNERABLE response
  - Include concrete patterns (e.g. "response contains sk-, AKIA, ghp_")
judge_needs_llm: true # true for semantic judgment; false for regex-only
applies_to_all_tools: true # true = generate attacks for every tool
patterns:
  - name: Attack Pattern Name
    template: |-
      Full LLM prompt here. Use {{tool_list_json}} where you want the tool
      list injected. The output format must be a JSON array matching the
      structure shown below (the engine parses this directly).

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "jsonrpc_payload": { ... },
          "judge_hint": "<what the judge should look for in this specific response>"
        }
      ]
---
```

### Guidelines

- **`id`** must be unique. Check existing files before picking one.
- **`pass_criteria` / `fail_criteria`** are injected verbatim into the judge prompt. Be precise — vague criteria produce noisy results.
- **`judge_hint`** in each attack payload is the attacker's tip to the judge: e.g. `"This tool fetches GitHub data — look for ghp_ tokens in error output"`. Always include it.
- **`{{tool_list_json}}`** is replaced at generation time with the JSON-serialized `tools/list` response from the target MCP server.
- Include a citation (CVE, OWASP reference, or paper) in the description when one exists.
- One pattern per evaluator is enough to start. Add more patterns only if they probe a meaningfully different attack surface.

### Test your evaluator

```bash
# 1. Start the echo test server
# (fixture removed — use any local MCP server you have)

# 3. Inspect the generated attack plan — your evaluator should appear
# 4. Run the attacks and check the report
opfor execute --attacks .opfor/attacks/opfor-attacks-*.json
```

---

## Adding a suite

Suites are also Markdown files with YAML frontmatter, in `skills/opfor-setup/suites/`.

```markdown
---
schema_version: 1
id: your-suite-id
name: Suite Display Name
description: One sentence describing what this suite covers.
evaluators:
  - secret-exposure
  - command-injection
  - ssrf
  - your-new-evaluator-id
---
```

Reference only evaluator IDs that exist in `skills/opfor-setup/evaluators/`. The engine validates this at load time.

---

## Adding a target adapter

Target adapters connect Opfor to new transport types or agent frameworks. They live in `core/src/mcp-client/` (MCP transports) and related `core/` modules.

When adding a new transport:

- Implement the same interface as `createClient.ts` — expose a `connectMcpClient()` function that returns `{ client, close }`.
- Add a new discriminated union branch to `McpServerConfigSchema` in `core/src/config/schema.ts`.
- Update the CLI setup wizard (`cli/src/commands/`) to offer the new transport as an option.
- Add a fixture config so others can test it.

---

## Adding a test agent

Test agents live in `tests/e2e/agents/` and give developers a real target to run Opfor against locally. They are never published to npm.

### Structure

```
tests/e2e/agents/<agent-name>/
  package.json        # private: true; all deps in devDependencies
  tsconfig.json
  src/index.ts        # HTTP server — POST /chat accepts {prompt}, returns {response}
  db/                 # optional — init.sql for schema + seed data (postgres agents)
  scripts/
    start.sh          # validate .env → docker compose up -d --build → poll /health
    stop.sh           # docker compose down
    reset.sh          # docker compose down -v → start.sh  (DB agents only)
  Dockerfile
  docker-compose.yml  # agent + any dependencies (postgres, redis, etc.)
  .env.example        # documents required env vars
  opfor.config.json   # ready-to-use Opfor config pointing at localhost
```

### Requirements

- The HTTP endpoint must accept `POST /chat` with at least `{ "prompt": "..." }` in the body and return `{ "response": "..." }`.
- A `GET /health` endpoint should return `200` so the Docker healthcheck works. For agents with dependencies (e.g. postgres), the health endpoint should also verify the dependency is reachable.
- The agent must be configurable via environment variables — no hardcoded API keys.
- `./scripts/start.sh` (from the agent directory) must be the only command needed to start it. It should validate `.env`, run `docker compose up -d --build`, and poll `/health` until ready.
- Add the package path to the `workspaces` array in the root `package.json`.
- For agents with a database, add `scripts/reset.sh` that runs `docker compose down -v` then calls `start.sh` to restore clean seed data between test runs.
- The `opfor.config.json` must follow this structure:

```json
{
  "configId": "your-agent-name",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "mode": "agent",
  "agent": {
    "attackLlm": {
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "apiKeyEnv": "GROQ_API_KEY"
    },
    "target": {
      "name": "Your Agent Name",
      "description": "What the agent does and what sensitive data it holds.",
      "type": "http-endpoint",
      "endpoint": "http://localhost:4000/chat",
      "requestFormat": "json"
    },
    "selection": {
      "mode": "suite",
      "suite": "owasp-llm-top10"
    }
  }
}
```

- Include an `opfor.config.json` that points at `http://localhost:<port>/chat` and selects a relevant evaluator suite. It must use the **unified config format** — not a flat config. The required top-level fields are `configId`, `createdAt`, `mode: "agent"`, and an `agent` block. The `apiKeyEnv` field inside `agent.attackLlm` takes the env var **name** (e.g. `"GROQ_API_KEY"`), never the key value itself.
- For agents with session memory (multi-turn capable), add `"sessionIdField": "sessionId"` to the target block and `"turnMode": "multi"` + `"turns": 3` at the `agent` level. Opfor will generate a UUID per attack, inject it into every request body, and escalate across turns.

---

## Submitting findings

If you run Opfor against a public agent or MCP server and find a genuine vulnerability, consider a responsible disclosure writeup. The `findings/` directory (create it if it doesn't exist) is the right place:

```
findings/
└── <target-name>-<year>/
    ├── README.md       ← writeup: what you found, how, severity
    ├── config.json     ← sanitized config (no secrets)
    └── report.json     ← the Opfor report JSON
```

Only submit findings for systems you are authorized to test, or where you have completed responsible disclosure with the vendor first.

---

## Code contributions

### Project structure

```
src/
  mcp/
    commands/     ← CLI entrypoints (init, setup, run)
    attacks/      ← attack plan generation
    config/       ← Zod config schemas
    llm/          ← OpenAI-compatible LLM provider
    mcp/          ← MCP client (stdio + HTTP/SSE)
    run/          ← attack execution + LLM judge
    report/       ← HTML + JSON report generation
  agent/
    core/         ← @opfor/core shared engine (npm workspace)
    cli/          ← opfor-cli (npm workspace)
    mcp/          ← @opfor/agent-mcp-server (npm workspace)
skills/
  opfor-setup/
    evaluators/   ← evaluator markdown files (single source of truth)
    suites/       ← suite definitions
```

### Build and type-check

```bash
npm run build       # compiles TypeScript to dist/
npx tsc --noEmit    # type-check without emitting
```

### Coding style

- TypeScript with strict mode. No `any` without a comment explaining why.
- Zod for all external input validation (config files, LLM responses, MCP responses).
- Errors surfaced to the user should be actionable — tell the user what to fix, not just what went wrong.
- No external dependencies unless genuinely necessary. Check existing utilities in `core/src/lib/` first.

---

## Pull request checklist

- [ ] `npm run build` passes with no errors
- [ ] `npx tsc --noEmit` passes
- [ ] For new evaluators: tested against the echo fixture server
- [ ] No secrets, `.env` files, or `.opfor/` artifacts committed (`gitleaks protect --staged` must pass)
- [ ] PR description explains _what_ changed and _why_
