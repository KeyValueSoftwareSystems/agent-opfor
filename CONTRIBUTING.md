# Contributing to Opfor

Thanks for helping make AI red teaming better.

## The easiest way to contribute: add an evaluator

**Evaluators are the heart of Opfor** — they define what vulnerabilities to test for. Adding a new evaluator requires **zero TypeScript knowledge** — just a YAML file with attack patterns and pass/fail criteria.

```bash
npm run new:evaluator   # interactive wizard creates the file for you
```

See [Adding an evaluator](#adding-an-evaluator) for the full guide.

---

## Table of contents

- [Before you start](#before-you-start)
  - [Commit messages](#commit-messages)
  - [PR naming](#pr-naming)
- [**Adding an evaluator**](#adding-an-evaluator) ← most common contribution
- [Adding a suite](#adding-a-suite)
- [Adding a telemetry provider](#adding-a-telemetry-provider)
- [Adding a test agent](#adding-a-test-agent)
- [Submitting findings](#submitting-findings)
- [Code contributions](#code-contributions)
- [Pull request checklist](#pull-request-checklist)
- [For reviewers](#for-reviewers)

---

## Before you start

1. Check [open issues](https://github.com/KeyValueSoftwareSystems/agent-opfor/issues) to avoid duplicating work.
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
| `refactor/` | Code change with no behavior change         |
| `chore/`    | Dependency updates, tooling, CI             |
| `test/`     | Adding or updating tests                    |

Examples: `feat/add-prompt-leak-evaluator`, `fix/ssrf-judge-false-positive`, `docs/contributing-guide`

Keep descriptions short (3–5 words, hyphen-separated, lowercase). No ticket numbers in branch names.

### Commit messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

**Examples:**

```
feat(evaluators): add BOLA evaluator for access control
fix(judge): correct false positive on localhost responses
docs: add commit message guidelines
chore(deps): update @modelcontextprotocol/sdk to 1.x
```

**Breaking changes:** Add `!` after the type:

```
feat(config)!: rename attackLlm to attackerLlm
```

See the [full spec](https://www.conventionalcommits.org/en/v1.0.0/) for details on scopes, footers, and multi-line messages.

### PR naming

Same format as commit messages: `<type>: <what changed>`

PRs with multiple commits should have a title that summarizes the overall change.

### Setup

```bash
git clone https://github.com/KeyValueSoftwareSystems/agent-opfor.git
cd opfor
npm install   # also installs Husky pre-commit hooks
npm run build
```

Want the `opfor` command globally available while developing? Use `npm run install:cli` instead of `npm run build` — it builds and `npm install -g`s the CLI in one step.

The pre-commit hook runs typechecking, linting, formatting, and **secret scanning via [gitleaks](https://github.com/gitleaks/gitleaks)**. Install gitleaks or the secret scanning step will fail:

```bash
# macOS
brew install gitleaks

# Linux (Debian/Ubuntu)
sudo apt install gitleaks

# Or download from GitHub releases
# https://github.com/gitleaks/gitleaks/releases
```

See the [official install guide](https://github.com/gitleaks/gitleaks#installing) for other options.

If gitleaks reports a false positive (e.g. a fake key in a test fixture), add an allowlist entry to `.gitleaks.toml`.

Set an API key so you can test locally:

```bash
cp .env.example .env
# fill in at least one provider key
```

---

## Adding an evaluator

> **TL;DR** — Run `npm run new:evaluator`, fill in the TODO placeholders, run `npm run build:catalog`, test it, open a PR. No TypeScript needed.

Evaluators are YAML files that define:

- **What to attack** — prompt templates or MCP payloads
- **How to judge** — pass/fail criteria the LLM judge uses

They live in `evaluators/agent/` (for chatbots/HTTP targets) or `evaluators/mcp/` (for MCP servers). The engine discovers them automatically — just run `npm run build:catalog` after adding one.

Full schema reference: [docs/evaluator-schema.md](docs/evaluator-schema.md).

### Quick start with the wizard

The fastest way to create a new evaluator is with the interactive wizard:

```bash
npm run new:evaluator
```

The wizard asks 4 questions:

1. **Surface** — Agent (HTTP/script targets) or MCP (tools/call targets)
2. **Category** — Pick an existing category or create a new one
3. **Evaluator ID** — Unique kebab-case identifier (e.g. `sql-injection`)
4. **File layout** — Flat (single YAML) or Directory (evaluator.yaml + patterns/)

It creates the file(s) with TODO placeholders you fill in:

```yaml
# Example output for: npm run new:evaluator → agent → injection → my-new-eval → flat
schema_version: 1
id: my-new-eval
name: My New Eval
severity: medium
standards:
  # owasp-llm: LLM01  # uncomment to auto-include in owasp-llm-top10
description: >-
  TODO: Describe what this evaluator tests.
pass_criteria: |-
  - Target refuses the malicious request
  - TODO: Add specific safe behaviors
fail_criteria: |-
  - Target executes the malicious request
  - TODO: Add specific vulnerable behaviors
patterns:
  - name: Example Pattern
    template: |-
      Your attack prompt here. Use {{placeholder}} for LLM-filled variables.
```

After editing, run `npm run build:catalog` to register the evaluator.

### File layout

Evaluators support two layouts — flat (simple) and directory (multiple patterns). Both are valid for agent and MCP evaluators.

**Flat** — one file, patterns inline. Use when the evaluator has one or two patterns:

```
evaluators/agent/<category>/<id>.yaml
evaluators/mcp/<category>/<id>.yaml
```

**Directory** — evaluator metadata separate from patterns. Use when patterns are long or there are several:

```
evaluators/agent/<category>/<id>/
  evaluator.yaml          ← metadata only (no patterns field)
  patterns/
    <slug>.yaml           ← one file per pattern
  <id>.test.yaml          ← pass/fail smoke test
```

Place your evaluator in the most relevant existing category (e.g. `injection`, `disclosure`, `access-control`). Create a new category folder only if none fit.

### File format

**`evaluator.yaml`** (both flat and directory layouts):

```yaml
schema_version: 1
id: your-evaluator-id # kebab-case, unique across all evaluators
name: Human Readable Name
severity: critical # critical | high | medium | low
standards:
  owasp-mcp: MCP01 # omit or leave empty if no standard applies
description: >-
  One or two sentences describing what this evaluator tests and why it matters.
pass_criteria: |-
  - Bullet list of observable conditions that indicate a SAFE response
  - Be specific — the LLM judge uses these to decide PASS
fail_criteria: |-
  - Bullet list of observable conditions that indicate a VULNERABLE response
  - Include concrete patterns (e.g. "response contains sk-, AKIA, ghp_")
# Flat layout only — omit this field when using the directory layout:
patterns:
  - name: Attack Pattern Name
    template: |-
      Attack prompt here. {{tool_list_json}} is replaced with the target's
      tools/list response at generation time.
```

**`patterns/<slug>.yaml`** (directory layout only):

```yaml
name: Attack Pattern Name
template: |-
  Attack prompt here.
```

**`<id>.test.yaml`** (optional but encouraged):

```yaml
kind: response
pass_case: { response: "Access denied — insufficient permissions.", expect: PASS }
fail_case: { response: "Done — I ran the admin endpoint for you.", expect: FAIL }
```

### Guidelines

- **`id`** must be unique. Check existing files before picking one.
- **`pass_criteria` / `fail_criteria`** are injected verbatim into the judge prompt. Be precise — vague criteria produce noisy results.
- **MCP patterns** must output a JSON array: `[{ "tool_name", "jsonrpc_payload", "judge_hint" }]`. The `judge_hint` is the attacker's tip to the judge — always include it.
- **Agent patterns** use prose templates with `{{placeholders}}` — no JSON wrapper. The attacker LLM fills placeholders and adapts across turns.
- **`{{tool_list_json}}`** (MCP only) is replaced at generation time with the JSON-serialized `tools/list` response from the target server.
- Include a citation (CVE, OWASP reference, or paper) in the description when one exists.
- One pattern is enough to start. Add more only if they probe a meaningfully different attack surface.
- Optional fields `judge_needs_llm` and `applies_to_all_tools` are supported — see [docs/evaluator-schema.md](docs/evaluator-schema.md) for the full list.

After adding files, rebuild the catalog:

```bash
npm run build:catalog
```

### Test your evaluator

```bash
# 1. Build the catalog with your new evaluator
npm run build:catalog

# 2. Create a config that selects only your evaluator
opfor setup --agent --empty   # or --mcp --empty
# Edit .opfor/configs/opfor-config-*.json:
#   "selection": { "mode": "evaluators", "evaluators": ["your-evaluator-id"] }

# 3. Run against a test target
opfor run --config .opfor/configs/opfor-config-*.json
```

**Test targets:**

- `tests/e2e/agents/vanilla-chat/` — simple chatbot for agent evaluators
- `tests/e2e/mcp/vulnerable-server/` — intentionally buggy MCP server

---

## Adding a suite

**Standard suites** (`owasp-llm-top10`, `owasp-agentic-ai`, `owasp-mcp-top10`, `mitre-atlas`, `eu-ai-act-bias`) are **auto-derived** — the engine groups evaluators by their `standards:` tags at load time. To add an evaluator to one of these suites, set the matching key in the evaluator's `standards:` field. No suite file needed.

**Curated suites** are manually authored YAML files in `suites/{agent,mcp}/` at repo root. Use these for thematic groupings that don't map to a single standard (e.g. `harmful-content`, `pre-deploy-critical`).

```yaml
id: your-suite-id
name: Suite Display Name
description: One sentence describing what this suite covers.
evaluators:
  - secret-exposure
  - command-injection
  - ssrf
  - your-new-evaluator-id
```

Reference only evaluator IDs that exist in the matching `evaluators/{agent|mcp}/` tree. The engine validates this at load time. After adding a suite file, rebuild the catalog:

```bash
npm run build:catalog
```

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
       // Shared helper owns the hard part: poll until the trace is COMPLETE
       // (the final turn has ingested), bounded by the budget, best-effort on
       // timeout. You supply only how to fetch the current snapshot.
       return pollTraceForJudge({
         traceId,
         providerLabel: "my-provider",
         expectedResponse: opts.expectedResponse, // completeness signal
         budget: opts, // initialDelayMs / maxAttempts / retryDelayMs
         maxChars: opts.maxChars,
         fetchSnapshot: async () => {
           const data = await myFetchTrace(telemetry, traceId);
           return data ?? null; // null until anything is ingested
         },
       });
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

5. **Polling defaults** — `POLL_DEFAULTS` in `core/src/telemetry/pollingUtils.ts` gives you sensible starting values (`1000 ms` initial delay, `8` attempts, `1500 ms` between). Pass them through `fetchTraceForJudge`'s `opts` argument — callers can override per `TelemetryConfig`.

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
  "attackerLlm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "apiKeyEnv": "GROQ_API_KEY"
  },
  "effort": "adaptive",
  "turnMode": "multi",
  "turns": 3
}
```

- Include an `opfor.config.json` that points at `http://localhost:<port>/chat` and selects a relevant evaluator suite. It must use the current **flat schema** — `target.kind: "agent"` at top level, with `attackerLlm`, `selection`, `effort`, `turnMode`, `turns` as siblings. `apiKeyEnv` takes the env var **name** (e.g. `"GROQ_API_KEY"`), never the key value itself.
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
core/                       ← @agent-opfor/core — shared engine (npm workspace)
  src/
    autonomous/             ← autonomous red-teaming orchestration (opfor hunt)
    catalog/                ← evaluator/suite discovery + loading
    config/                 ← Zod schemas + LLM/telemetry config types
    evaluators/             ← judge prompt + evaluator YAML parsing
    execute/                ← runAll, runAgentLoop, run orchestration
    generate/               ← attack prompt generation (attacker LLM)
    lib/                    ← shared utilities (env, logger, etc.)
    mcp-client/             ← MCP client (stdio + HTTP/SSE transports)
    providers/              ← LLM provider factory (Vercel AI SDK)
    report/                 ← HTML + JSON report renderer
    run/                    ← per-attack judge wrapper, MCP helpers
    standards/              ← ATLAS standards mapping
    targets/                ← agent + MCP target adapters
    telemetry/              ← Langfuse + Netra adapters
runners/
  cli/                      ← @agent-opfor/cli — `opfor setup`, `opfor run`, `opfor hunt`
  mcp/                      ← @agent-opfor/mcp — opfor as an MCP server
  sdk/                      ← @agent-opfor/sdk — programmatic SDK for embedding
  extension/                ← Chrome MV3 browser extension
evaluators/
  agent/                      ← agent evaluators by category
  mcp/                        ← MCP evaluators by category
suites/
  agent/                      ← agent suites
  mcp/                        ← MCP suites
skills/
  agent-redteaming/
    opfor-setup/              ← config wizard skill + catalog.json
    opfor-run/                ← run skill + report-schema.md
  mcp-redteaming/
    opfor-setup/              ← config wizard skill + catalog.json
    opfor-run/                ← run skill + report-schema.md
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
- [ ] For new evaluators/suites: `npm run build:catalog:check` passes (verifies the committed catalog matches what `build:catalog` would generate — run `npm run build:catalog` to fix if it fails)
- [ ] For new evaluators: tested against a local target (e.g. `tests/e2e/agents/vanilla-chat/` or `tests/e2e/mcp/vulnerable-server/`)
- [ ] No secrets, `.env` files, or `.opfor/` artifacts committed (`gitleaks protect --staged` must pass)
- [ ] PR description explains _what_ changed and _why_

---

## For reviewers

Guidelines for maintainers reviewing PRs. For general code review best practices, see [Google's Code Review Guidelines](https://google.github.io/eng-practices/review/).

### Evaluator PRs

Evaluators are the most common contribution. Focus on:

| Check                                              | Why it matters                                                |
| -------------------------------------------------- | ------------------------------------------------------------- |
| **`id` is unique**                                 | Duplicate IDs break catalog loading                           |
| **`pass_criteria` / `fail_criteria` are specific** | Vague criteria → noisy judge results                          |
| **`severity` is appropriate**                      | `critical` = RCE, data breach; `low` = information disclosure |
| **`standards` mapping is correct**                 | Wrong mapping → evaluator appears in wrong suite              |
| **Pattern templates are realistic**                | Should reflect actual attack techniques                       |

**Quick approve if:**

- YAML is valid and follows the schema
- Criteria are clear and specific
- No obvious false positive/negative risks

**Request changes if:**

- `pass_criteria` or `fail_criteria` are too vague (e.g. "target behaves correctly")
- Pattern template is generic placeholder text
- Severity doesn't match the actual risk

### Code PRs

- Does the change follow existing patterns in the codebase?
- Are error messages actionable?
- Is Zod used for external input validation?
- Are there any `any` types without justification?

### General

- Be constructive — suggest improvements, don't just reject
- For new contributors, offer guidance on conventions
- Approve partial progress; follow-up PRs are fine
