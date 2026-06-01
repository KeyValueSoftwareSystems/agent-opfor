# Contributing to Opfor

Thanks for helping make AI red teaming better. This guide covers the three highest-impact contribution types: new evaluators, new target adapters, and findings from running Opfor against real systems.

## Table of contents

- [Before you start](#before-you-start)
  - [Branch naming](#branch-naming)
  - [PR naming](#pr-naming)
- [Adding an evaluator](#adding-an-evaluator)
- [Adding a suite](#adding-a-suite)
- [Adding a target adapter](#adding-a-target-adapter)
- [Adding a telemetry provider](#adding-a-telemetry-provider)
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

Want the `opfor` command globally available while developing? Use `npm run install:cli` instead of `npm run build` — it builds and `npm install -g`s the CLI in one step.

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

Evaluators live in `evaluators/{agent,mcp}/` at repo root as Markdown with YAML frontmatter. Run `npm run sync:skills-evaluators` to refresh `skills/*/opfor-setup/_generated/` for skill installs. No TypeScript changes are needed — the engine loads root paths automatically.

Pick `agent-redteaming` for chat/HTTP-target evaluators, `mcp-redteaming` for evaluators that fire `tools/call` against an MCP server.

Full frontmatter contract: [docs/evaluator-schema.md](docs/evaluator-schema.md). Run `npm run validate:skills` before opening a PR.

### File format

Create `evaluators/agent/<your-id>.md` or `evaluators/mcp/<your-id>.md`, then run `npm run sync:skills-evaluators`:

```markdown
---
schema_version: 1
id: your-evaluator-id # kebab-case, unique across all evaluators
name: Human Readable Name
severity: critical # critical | high | medium | low
standards:
  owasp-mcp: MCP01
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
- **Agent-redteaming patterns** use prose templates with `{{placeholders}}` (no JSON wrapper — the MCP example above is for MCP evaluators only). The attacker LLM fills in placeholders and adapts the pattern across turns.

### Test your evaluator

```bash
# 1. Start any local MCP server you want to test against
#    (or use tests/e2e/mcp/vulnerable-server for a known-buggy fixture)

# 2. Write a config selecting your new evaluator
opfor setup --mcp --empty   # or --agent --empty
#    Then edit the generated .opfor/configs/opfor-config-*.json:
#    set `selection.evaluators: ["<your-evaluator-id>"]`

# 3. Run it and inspect the report
opfor execute --config .opfor/configs/opfor-config-*.json
```

---

## Adding a suite

Suites are also Markdown files with YAML frontmatter, in `skills/*/opfor-setup/suites/`.

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

Reference only evaluator IDs that exist in the matching `evaluators/{agent|mcp}/` tree. The engine validates this at load time.

---

## Adding a target adapter

Target adapters connect Opfor to new transport types or agent frameworks. They live in `core/src/mcp-client/` (MCP transports) and related `core/` modules.

When adding a new transport:

- Implement the same interface as `createClient.ts` — expose a `connectMcpClient()` function that returns `{ client, close }`.
- Add a new discriminated union branch to `McpServerConfigSchema` in `core/src/config/schema.ts`.
- Update the CLI setup wizard (`runners/cli/src/commands/`) to offer the new transport as an option.
- Add a fixture config so others can test it.

---

## Adding a telemetry provider

Opfor can fetch recorded traces from an observability platform and give them to the judge LLM for richer evaluation. Connectors live in `core/src/telemetry/providers/`. Use `providers/langfuse/` as the reference implementation.

### Checklist

1. **Create the API client** — `core/src/telemetry/providers/<name>/traces.ts`
   - Functions to list traces, hydrate a single trace, and poll for a trace after an attack.
   - Credentials must come from environment variables; resolve them via `resolveTelemetryEnv()` (see `core/src/config/resolveTelemetryEnv.ts`).

2. **Create the adapter** — `core/src/telemetry/providers/<name>/adapter.ts`
   - Implement the `TelemetryAdapter` interface from `core/src/telemetry/adapter.ts` (three methods):

   ```typescript
   import type { TelemetryAdapter } from "../../adapter.js";
   import { pollUntilResult } from "../../pollingUtils.js";
   import { stringifyForJudge } from "../../judgePayload.js";

   export const myAdapter: TelemetryAdapter = {
     async fetchTraceList(telemetry) {
       /* return { traces, providerLabel } or null */
     },
     async hydrateTrace(telemetry, traceId) {
       /* return full trace object or null */
     },
     async fetchTraceForJudge(telemetry, traceId, opts) {
       const result = await pollUntilResult(async () => {
         const data = await myFetchTrace(telemetry, traceId);
         return data ? stringifyForJudge(data, opts.maxChars) : null;
       }, opts);
       return result ?? `[<Name> trace not available after ${opts.maxAttempts} attempt(s).]`;
     },
   };
   ```

   Return `null` from `fetchTraceList` / `hydrateTrace` when credentials are missing or the provider is not configured. Return a bracketed error string (not `null`) from `fetchTraceForJudge` — the judge receives this as context.

3. **Register the adapter** — add one line to `getAdapter()` in `core/src/telemetry/adapter.ts`:

   ```typescript
   if (provider === "my-provider") return myAdapter;
   ```

4. **Extend the config types** — in `core/src/config/types.ts`:
   - Add `"my-provider"` to the `TelemetryProviderId` union.
   - Add a `myProvider?: MyProviderTelemetryConfig` block to `TelemetryConfig`.

5. **Polling defaults** — `POLL_DEFAULTS` in `core/src/telemetry/pollingUtils.ts` gives you sensible starting values (`500 ms` initial delay, `5` attempts, `400 ms` between). Pass them through `fetchTraceForJudge`'s `opts` argument — callers can override per `TelemetryConfig`.

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
  "target": {
    "kind": "agent",
    "name": "Your Agent Name",
    "description": "What the agent does and what sensitive data it holds.",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat",
    "requestFormat": "json"
  },
  "selection": {
    "mode": "suite",
    "suite": "owasp-llm-top10"
  },
  "attackLlm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "apiKeyEnv": "GROQ_API_KEY"
  },
  "effort": "adaptive",
  "turnMode": "multi",
  "turns": 3
}
```

- Include an `opfor.config.json` that points at `http://localhost:<port>/chat` and selects a relevant evaluator suite. It must use the current **flat schema** — `target.kind: "agent"` at top level, with `attackLlm`, `selection`, `effort`, `turnMode`, `turns` as siblings (not the legacy nested `{ mode, agent: {} }` shape used pre-refactor). `apiKeyEnv` takes the env var **name** (e.g. `"GROQ_API_KEY"`), never the key value itself.
- For agents with session memory (multi-turn capable), add `"sessionIdField": "sessionId"` to the `target` block. With `turnMode: "multi"` opfor generates a UUID per attack, injects it into every request body, and escalates across turns.

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
core/                       ← @opfor/core — shared engine (npm workspace)
  src/
    config/                 ← Zod schemas + LLM/telemetry config types
    evaluators/             ← evaluator markdown parsing
    execute/                ← runAll, runAgentLoop, run orchestration
    generate/               ← attack prompt generation (attacker LLM)
    providers/              ← LLM provider factory (Vercel AI SDK)
    targets/                ← agent + MCP target adapters
    telemetry/              ← Langfuse + Netra adapters
    report/                 ← HTML + JSON report renderer
    mcp-client/             ← MCP client (stdio + HTTP/SSE transports)
runners/
  cli/                      ← @opfor/cli — `opfor setup` + `opfor execute`
  mcp/                      ← @opfor/mcp — opfor as an MCP server
  extension/                ← Chrome MV3 browser extension
skills/
  agent-redteaming/
    opfor-setup/{evaluators,suites,targets}/
    opfor-execute/
  mcp-redteaming/
    opfor-setup/{evaluators,suites}/
    opfor-execute/
tests/e2e/
  agents/
    vanilla-chat/           ← plain chatbot — LLM-level vulnerabilities
    customer-support/       ← tool-calling agent + Postgres — BOLA, BFLA, PII
  mcp/
    vulnerable-server/      ← intentionally vulnerable MCP server
```

### Build and type-check

```bash
npm run build         # compiles TypeScript + bundles the extension
npm run typecheck     # type-check across the monorepo without emitting
npm run install:cli   # build + install `opfor` globally (handy during dev)
```

### Coding style

- TypeScript with strict mode. No `any` without a comment explaining why.
- Zod for all external input validation (config files, LLM responses, MCP responses).
- Errors surfaced to the user should be actionable — tell the user what to fix, not just what went wrong.
- No external dependencies unless genuinely necessary. Check existing utilities in `core/src/lib/` first.

---

## Pull request checklist

- [ ] `npm run build` passes with no errors
- [ ] `npm run typecheck` passes
- [ ] For new evaluators: tested against a local MCP server (or `tests/e2e/mcp/vulnerable-server`)
- [ ] No secrets, `.env` files, or `.opfor/` artifacts committed (`gitleaks protect --staged` must pass)
- [ ] PR description explains _what_ changed and _why_
