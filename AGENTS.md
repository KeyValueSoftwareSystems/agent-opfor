# AGENTS.md — Opfor

This file is for AI coding agents (Claude Code, Copilot, Cursor, etc.) working in this repository. It describes the project structure, build system, key conventions, and how the core subsystems fit together.

For user-facing CLI docs see [`docs/cli.md`](docs/cli.md); for MCP-server-mode docs see [`docs/mcp.md`](docs/mcp.md).

---

## What this project is

Opfor is an open-source red-teaming toolkit for AI agents and MCP servers. It generates OWASP-mapped attack prompts, fires them at a target, and judges each response with an LLM. Output is an HTML + JSON report.

**Five usage modes — one set of evaluators:**

| Mode              | Entry point                                                                                    | Who runs it                                  |
| ----------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| CLI               | `opfor setup` → `opfor run --config <path>` / `opfor hunt --endpoint <url> --objective <text>` | User in terminal or CI                       |
| Browser extension | Click the toolbar icon on any chat UI                                                          | Non-developers — QA, PMs, security analysts  |
| MCP server        | `opfor_setup`, `opfor_run` tools                                                               | MCP-compatible host (Cursor, Claude Desktop) |
| Skills            | `/opfor-setup`, `/opfor-run` slash commands                                                    | AI coding agent reads markdown skill files   |
| SDK               | `import { run, hunt } from "@agent-opfor/sdk"`                                                 | Developers embedding opfor in their own code |

---

## Monorepo structure

```
opfor/
├── core/                          # @agent-opfor/core — shared engine (npm workspace, compiled to core/dist/)
│   └── src/
│       ├── autonomous/            # Autonomous red-teaming orchestration (orchestrator, prompts, tools, state, report, knowledge)
│       ├── catalog/               # discoverEvaluators.ts, loadCatalog.ts — YAML evaluator/suite discovery
│       ├── config/                # types.ts, schema.ts (Zod), evaluatorsLayout.ts, skillsLayout.ts, resolveTelemetryEnv.ts, loadPrompt.ts
│       ├── execute/               # runAll.ts, runAgentLoop.ts, runAllBrowser.ts, types.ts, effortCompat.ts — top-level run orchestration
│       ├── generate/              # generateAttacks.ts, generateNextTurn.ts — attacker LLM prompt generation
│       ├── evaluators/            # judge.ts, parseEvaluator.ts — judge prompt + evaluator YAML loader
│       ├── targets/               # agentTarget.ts (HTTP/local-script), mcpTarget.ts — implement the AgentTarget / McpTarget interfaces
│       ├── mcp-client/            # createClient.ts — MCP transport factory (stdio, SSE, HTTP)
│       ├── providers/             # factory.ts — createModel() over Vercel AI SDK for all LLM providers
│       ├── report/                # buildReport.ts, render.ts, types.ts — HTML + JSON report renderer
│       ├── run/                   # judge.ts (per-attack judge), scanResources.ts, types.ts — MCP-specific helpers
│       ├── telemetry/             # Langfuse + Netra adapters (curation.ts, judgePayload.ts, providers/{langfuse,netra}/)
│       ├── lib/                   # agent.ts (legacy dispatch helpers), env.ts, logger.ts, opforConfig.ts, generateJsonObject.ts, tracePropagation.ts
│       ├── llm/                   # openaiCompatible.ts — OpenAI-compatible LLM helpers
│       ├── standards/             # atlas.ts — ATLAS standards mapping
│       ├── prompts/               # Inlined system prompts (attacker, judge) used by core
│       └── util/                  # yamlFrontmatter.ts and other utility helpers
├── runners/
│   ├── cli/                       # @agent-opfor/cli — `opfor` CLI binary (npm workspace)
│   │   └── src/
│   │       ├── index.ts           # CLI entrypoint (commander) — registers setup, run, and hunt
│   │       ├── commands/
│   │       │   ├── setup.ts       # `opfor setup` (interactive wizard) + --agent / --mcp / --empty flags
│   │       │   ├── run.ts     # `opfor run --config <path>` — runs end-to-end
│   │       │   └── hunt.ts        # `opfor hunt` — autonomous red-teaming with agentic orchestration
│   │       └── lib/
│   │           └── artifacts.ts   # .opfor/configs/ + .opfor/reports/ path helpers
│   ├── mcp/                       # @agent-opfor/mcp — MCP server runner (npm workspace)
│   │   └── src/
│   │       └── index.ts           # MCP server entrypoint — registers tools, stdio transport
│   ├── sdk/                       # @agent-opfor/sdk — programmatic SDK (npm workspace)
│   │   └── src/
│   │       └── index.ts           # SDK entrypoint
│   └── extension/                 # @agent-opfor/extension — Chrome MV3 browser extension (npm workspace)
│       ├── service_worker.js      # Entry point — message routing only; imports modules below
│       ├── orchestrator.js        # Main run loop: locate → attack → extract → reset → judge (calls runAllBrowser from bundled core)
│       ├── llmUiActions.js        # DOM-specific LLM helpers (input picker, UI planner, message shortener)
│       ├── domTarget.js           # Adapter exposing the DOM send/extract path as a core AgentTarget
│       ├── dist/core.bundle.js    # esbuild bundle of @agent-opfor/core/browser (attack + judge engine)
│       ├── frameDiscovery.js      # Frame collection, scoring, chat-frame selection
│       ├── domActions.js          # chrome.scripting wrappers (send, click, verify, vendor APIs)
│       ├── responseExtractor.js   # Three-phase polling extractor for bot responses
│       ├── storage.js             # chrome.storage.local helpers (run status, results, paused run)
│       ├── catalog.json           # Generated by `npm run build:catalog`
│       ├── catalog.js             # catalog.json loading + evaluator/suite lookups
│       ├── popup.js / popup.html  # Toolbar popup + progress UI
│       ├── options.js / options.html  # LLM key + provider settings
│       ├── config.js              # getLlmProfile / assertLlmCfg — reads Options storage
│       ├── state.js               # Shared mutable run state (OPFOR_STOP, AbortController)
│       ├── utils.js               # sleep, formatTranscript, safeJsonParse
│       └── frame_*.js             # Frame scripts injected into page contexts (standalone, no imports)
├── evaluators/
│   ├── agent/                     # Agent evaluator YAML files (directory-form or flat-file)
│   │   ├── access-control/        # e.g. bfla/, bola/, rbac/ sub-dirs each with evaluator.yaml
│   │   ├── accuracy/
│   │   ├── bias/
│   │   ├── brand-conduct/
│   │   ├── code-execution/
│   │   ├── disclosure/
│   │   ├── excessive-agency/
│   │   ├── harmful/
│   │   ├── injection/
│   │   ├── mcp-usage/
│   │   ├── memory-rag/
│   │   ├── multi-agent/
│   │   ├── resource/
│   │   ├── source-analysis/
│   │   └── supply-chain/
│   └── mcp/                       # MCP evaluator YAML files
│       ├── auth/
│       ├── disclosure/
│       ├── injection/
│       ├── protocol/
│       ├── source-analysis/
│       ├── supply-chain/
│       └── tool-poisoning/
├── suites/
│   ├── agent/                     # Curated agent suite YAML files
│   │   ├── quick-smoke.yaml
│   │   ├── pre-deploy-critical.yaml
│   │   ├── harmful-content.yaml
│   │   └── output-trust-and-safety.yaml
│   └── mcp/
│       └── mcp-smoke.yaml
├── skills/
│   ├── agent-redteaming/
│   │   └── opfor-setup/
│   │       ├── SKILL.md           # /opfor-setup slash command
│   │       ├── catalog.json       # Generated evaluator catalog (npm run build:catalog)
│   │       └── targets/           # Target adapter docs (http-endpoint, custom-function)
│   └── mcp-redteaming/
│       └── opfor-setup/
│           ├── SKILL.md           # MCP target configuration skill entry point
│           └── catalog.json       # Generated MCP evaluator catalog
├── tests/
│   └── e2e/
│       ├── agents/
│       │   ├── vanilla-chat/      # Plain Express + LangChain chat agent — LLM Top 10 + Trust & Safety
│       │   └── customer-support/  # Tool-calling agent + Postgres — BOLA, BFLA, RBAC, PII, SQL injection
│       └── mcp/
│           └── vulnerable-server/ # Intentionally vulnerable MCP server
├── docs/
│   ├── cli.md                     # Complete CLI reference
│   ├── hunt.md                    # Autonomous mode (`opfor hunt`) guide
│   ├── mcp.md                     # MCP server (runner) setup + tools reference
│   ├── browser-extension.md       # Browser extension guide
│   ├── skills.md                  # Skill bundle usage
│   ├── sdk.md                     # SDK (@agent-opfor/sdk) reference
│   ├── evaluators.md              # Evaluator + suite reference
│   ├── evaluator-schema.md        # Evaluator YAML schema
│   └── telemetry.md               # Trace-aware testing (Langfuse / Netra)
└── findings/                      # Community-submitted vulnerability writeups (aspirational; may not exist yet)
```

---

## Build

```bash
npm install                       # workspaces resolved + Husky pre-commit hooks installed
npm run build                     # tsc -b core runners/cli runners/mcp + extension catalog + bundle (always from root)
npm run typecheck                 # tsc -b without emit
npm run install:cli               # build + npm install -g ./runners/cli — `opfor` available globally
npm run lint                      # eslint
npm run lint:fix                  # eslint --fix
npm run format                    # prettier --write
npm run format:check              # prettier --check
npm test                          # vitest in core/
```

`core` must compile before any runner — `runners/{cli,mcp}` import from `core/dist/`, and `runners/extension` esbuild-bundles `@agent-opfor/core/browser` at build time. Always run `npm run build` from the repo root, never per-package.

---

## Key files

| File                                     | Purpose                                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/config/types.ts`               | LLM + telemetry config TS types (LlmConfig, TelemetryConfig, PROVIDERS const)                                                                                               |
| `core/src/execute/types.ts`              | RunConfig, AgentTargetConfig, McpTargetConfig, AttackSpec, UnifiedRunReport, EvaluatorResult                                                                                |
| `core/src/config/schema.ts`              | Zod schemas for `McpServerConfigSchema` discriminated union (stdio/url) + LLM model config                                                                                  |
| `core/src/config/evaluatorsLayout.ts`    | `getEvaluatorsDir(category)` / `getSuitesDir(category)` — resolves `evaluators/{agent\|mcp}/` and `suites/{agent\|mcp}/` at runtime. Use these instead of hardcoding paths. |
| `core/src/config/skillsLayout.ts`        | `getSkillOpforSetupRoot(category)` — resolves `skills/{agent\|mcp}-redteaming/opfor-setup/` for SKILL.md and catalog.json                                                   |
| `core/src/catalog/discoverEvaluators.ts` | Discovers evaluators from YAML files (directory-form and flat-file); ignores `*.test.yaml` fixtures                                                                         |
| `core/src/config/loadSkillCatalog.ts`    | Reads evaluator metadata + suite lists from skill catalog.json (used by skills/MCP mode)                                                                                    |
| `core/src/execute/runAll.ts`             | Top-level node entry: resolves evaluators, calls `generateAttacks`, drives `runAgentAttack`/`runMcpAttack`, writes report                                                   |
| `core/src/execute/runAgentLoop.ts`       | Per-attack agent run: turn loop, multi-turn escalation, judge-after-loop                                                                                                    |
| `core/src/execute/runAllBrowser.ts`      | Browser-safe variant: takes preloaded evaluators + a pre-built `AgentTarget`, no Node-only imports                                                                          |
| `core/src/generate/generateAttacks.ts`   | Generates `AttackSpec[]` for one evaluator — agent-prompt or MCP tool-call shape                                                                                            |
| `core/src/generate/generateNextTurn.ts`  | Adaptive follow-up: feeds prior turns + judge signal back to the attacker LLM                                                                                               |
| `core/src/targets/agentTarget.ts`        | `createAgentTarget(config)` — HTTP (`http-endpoint`) and local-script targets implement `AgentTarget`                                                                       |
| `core/src/targets/mcpTarget.ts`          | `createMcpTarget(config)` — wraps `createClient()`, exposes callTool / listTools / listResources                                                                            |
| `core/src/mcp-client/createClient.ts`    | MCP transport factory; runs `expandEnv()` over stdio `env` + url `headers` for `${VAR}` substitution                                                                        |
| `core/src/evaluators/judge.ts`           | LLM-as-judge: response + pass/fail criteria → PASS/FAIL + score + evidence                                                                                                  |
| `core/src/evaluators/parseEvaluator.ts`  | Loads evaluator `.md`, parses YAML frontmatter → `EvaluatorSpec`                                                                                                            |
| `core/src/run/judge.ts`                  | Per-attack judge wrapper used by both agent and MCP loops                                                                                                                   |
| `core/src/run/scanResources.ts`          | MCP-only: enumerates `resources/list` + reads each one, judges for PII / secrets                                                                                            |
| `core/src/report/buildReport.ts`         | Writes per-run subfolder + invokes `render.ts`; maps `UnifiedRunReport` → `ReportViewModel`                                                                                 |
| `core/src/report/render.ts`              | Renders the final HTML (cover, exec summary, findings, per-turn details)                                                                                                    |
| `core/src/providers/factory.ts`          | `createModel(LlmConfig)` over Vercel AI SDK; `PROVIDER_DEFAULTS`, `PROVIDER_ENV_VARS`, `PROVIDER_CAPABILITIES`                                                              |
| `runners/cli/src/index.ts`               | CLI entrypoint — registers `setup`, `run`, and `hunt`                                                                                                                       |
| `runners/cli/src/commands/setup.ts`      | Interactive wizard; emits `.opfor/configs/opfor-config-<ts>-<id>.json`; supports `--agent/--mcp/--empty`                                                                    |
| `runners/cli/src/commands/run.ts`        | `opfor run --config <file>` — reads config, calls `runAll`, calls `writeReport`                                                                                             |
| `runners/cli/src/commands/hunt.ts`       | `opfor hunt` — autonomous red-teaming; agentic commander/operator/scout architecture; `--ui` flag for browser setup UI                                                      |
| `runners/cli/src/lib/artifacts.ts`       | `.opfor/configs/` + `.opfor/reports/` path helpers (`newConfigPath()`, `ensureOpforDirs()`)                                                                                 |
| `runners/mcp/src/index.ts`               | MCP server: registers `opfor_list_evaluators`, `opfor_setup`, `opfor_run` tools                                                                                             |
| `runners/extension/service_worker.js`    | Extension entry point — message routing; imports from focused ES modules                                                                                                    |
| `runners/extension/orchestrator.js`      | Full adaptive run loop — drives `runAllBrowser` against `DomTarget`                                                                                                         |
| `runners/extension/domTarget.js`         | Implements the core `AgentTarget` interface against the live chat DOM                                                                                                       |
| `runners/extension/dist/core.bundle.js`  | esbuild bundle of `@agent-opfor/core/browser`; supplies `runAllBrowser` + `generateNextTurn` + judge                                                                        |

---

## How evaluators work

Evaluators are `.yaml` files living under `evaluators/agent/` or `evaluators/mcp/`. The engine discovers them dynamically — no TypeScript changes needed to add one.

Two on-disk forms are supported:

- **Directory form** — `evaluators/{category}/{group}/{evaluator}/evaluator.yaml` (patterns may be split into `patterns/*.yaml`)
- **Flat-file form** — `evaluators/{category}/{group}/{evaluator}.yaml` (patterns inline)

`*.test.yaml` files are fixture inputs for unit tests and are ignored by the discovery logic.

```yaml
id: command-injection
name: Command Injection
severity: critical # critical | high | medium | low
standards:
  owasp-mcp: MCP05
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
```

**`evaluatorsLayout.ts` is critical** — it exposes `getEvaluatorsDir(category)` and `getSuitesDir(category)` to resolve `evaluators/{agent|mcp}/` and `suites/{agent|mcp}/` at runtime. Any code that needs these paths must call these functions, never hardcode paths.

**Agent-redteaming evaluators** (`evaluators/agent/`) send the rendered template as a plain prompt to the target.

**MCP-redteaming evaluators** (`evaluators/mcp/`) produce JSON-RPC payloads fired directly at the MCP server. Templates include `{{tool_list_json}}` replaced with the live `tools/list` response.

**Suites** are `.yaml` files under `suites/agent/` or `suites/mcp/`. Only curated, opinionated subsets are stored there. Standard suites (OWASP LLM Top 10, OWASP MCP Top 10, OWASP Agentic, ATLAS, etc.) are derived at load time from evaluator `standards:` frontmatter — not stored as suite files — to prevent suite drift.

---

## How the run loop works

There is no longer a separate `generate` step. `opfor run --config <file>` does everything end-to-end.

1. **Load config.** `runAll(config)` reads a `RunConfig` (flat schema: `target.kind`, `selection`, `attackerLlm`, `effort`, `turnMode`, `turns`, `telemetry`).
2. **Normalize turnMode.** `effectiveTurns = config.turnMode === "single" ? 1 : config.turns`. Both fields are written through to each `AttackSpec`.
3. **Build the target.** `createAgentTarget(config.target)` or `createMcpTarget(config.target)` — both implement the same lifecycle (`send` / `callTool`, `close`).
4. **Optional setup-time telemetry.** If `config.telemetry.provider !== "none"`, `curateTracesIfConfigured()` fetches recent traces and produces a markdown summary the attacker LLM uses as grounding context.
5. **Per evaluator:** `generateAttacks({ evaluator, target, effort, model, turns, turnMode })` produces `AttackSpec[]`. `adaptive` yields one open-ended spec; `comprehensive` yields one spec per named pattern.
6. **Per attack:** `runAgentAttack` (or `runMcpAttack` in `runAll.ts`) drives the turn loop. Each turn: build the prompt (turn 1 uses the seed; later turns use `generateNextTurn` with full history + last judge signal), send via the target, record the response. Stops early if the judge returns FAIL on a partial-judge check.
7. **Judge once after the loop.** A single judge call sees the whole transcript + optional fetched trace data (`enrichJudgeFromTrace`) and returns `{ verdict, score, confidence, evidence, reasoning }`.
8. **Aggregate + write report.** `writeReport(report, outputDir)` creates `.opfor/reports/opfor-report-<compactTs>-<slug>-<shortId>/` containing `<slug>-report.html` and `<slug>-report.json`.

`runAllBrowser` is the same loop in browser-safe form: takes preloaded `EvaluatorSpec[]` + a pre-built `AgentTarget` (e.g. `DomTarget`), skips disk reads.

---

## Developer testing with test agents

`tests/e2e/agents/` contains pre-built target agents developers can spin up locally to test evaluator changes without needing a real external service.

Each agent has a `scripts/` directory for consistent DX — always use these instead of `docker compose` directly.

### vanilla-chat

A plain Express + LangChain chat agent (no tools). Supports `openai`, `anthropic`, `groq`, `google`, and any OpenAI-compatible endpoint via `BASE_URL`.

```bash
cd tests/e2e/agents/vanilla-chat
cp .env.example .env          # set PROVIDER + the agent's API key
./scripts/start.sh            # builds image, starts agent, waits for /health

export GROQ_API_KEY=your-key-here   # attack LLM key (separate from Docker .env)

# from repo root:
opfor run --config tests/e2e/agents/vanilla-chat/opfor.config.json
```

**Covered evaluators:** OWASP LLM Top 10, Trust & Safety (bias, misinformation), system-prompt-leakage, jailbreaking.

### customer-support

An Express + LangChain tool-calling agent backed by PostgreSQL. Has five tools (`lookup_order`, `lookup_user_profile`, `list_my_orders`, `create_ticket`, `process_refund`) with intentional authorization gaps. Runs multi-turn attacks (`turnMode: "multi"`, 3 turns) by default. Session memory is keyed by `sessionId` in the request body.

```bash
cd tests/e2e/agents/customer-support
cp .env.example .env          # set PROVIDER + the agent's API key
./scripts/start.sh            # starts postgres:16 + agent on :4001, seeds DB, waits for /health

export GROQ_API_KEY=your-key-here

# from repo root:
opfor run --config tests/e2e/agents/customer-support/opfor.config.json

# reset DB to clean seed state between runs:
./scripts/reset.sh
```

**Covered evaluators:** BOLA, BFLA, RBAC, PII (direct/session/API), SQL injection, prompt injection, jailbreaking, system-prompt-leakage, contracts, competitors, hallucination.

The `opfor.config.json` uses the current **flat schema** (`target.kind: "agent"` at top level, `attackerLlm`/`selection`/`effort`/`turnMode`/`turns` as siblings — not the legacy nested `{ mode, agent: {} }` shape used pre-refactor). The `apiKeyEnv` field takes the env var **name** (e.g. `"GROQ_API_KEY"`), not the key value itself.

### Adding a new test agent

See [CONTRIBUTING.md](CONTRIBUTING.md) — "Adding a test agent" section.

---

## Adding an evaluator (no TypeScript needed)

1. Create `evaluators/agent/<group>/<id>.yaml` (or `evaluators/mcp/<group>/<id>.yaml`). For complex evaluators with many patterns, use the directory form: `evaluators/agent/<group>/<id>/evaluator.yaml`.
2. Fill YAML fields: `id`, `name`, `severity`, `standards`, `description`, `pass_criteria`, `fail_criteria`, `patterns` (see `docs/evaluator-schema.md`)
3. Optionally add the ID to a curated suite's `evaluators:` list in `suites/agent/` (or `suites/mcp/`). Standard-mapped suites (OWASP, ATLAS, etc.) pick it up automatically via the `standards:` field — no suite edit needed.
4. Test: `opfor setup --agent --empty` (or `--mcp --empty`) → edit `selection.evaluators` in the generated config → `opfor run --config <path>`
5. PR to `master` — see [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Adding a target adapter

For a new agent-target _type_ (e.g. websocket, gRPC):

1. Extend `AgentTargetConfig` in `core/src/execute/types.ts` with a new `type` value and any fields it needs.
2. Add a branch to the `createAgentTarget()` factory in `core/src/targets/agentTarget.ts` that returns the same `AgentTarget` interface (`send`, `close`).
3. Update the wizard in `runners/cli/src/commands/setup.ts` (`collectAgentTarget`) to prompt for the new type.

For a new MCP _transport_ (beyond stdio/url):

1. Add the new branch to `McpServerConfigSchema` in `core/src/config/schema.ts`.
2. Implement `connect<Name>Transport()` in `core/src/mcp-client/createClient.ts` and route to it from `connectMcpClient()`.
3. Update `core/src/targets/mcpTarget.ts`' `buildServerConfig()` to pass through new fields from `McpTargetConfig`.
4. Update the wizard in `runners/cli/src/commands/setup.ts` (`collectMcpTarget`) and the MCP runner's tool input schema in `runners/mcp/src/index.ts`.

---

## Coding conventions

- **TypeScript strict mode** — no `any` without a comment explaining why
- **Zod for all external input** — config files, LLM responses, MCP responses; never `JSON.parse` directly into a typed variable
- **No barrel re-exports** — import directly from the file that owns the symbol
- **Error messages are actionable** — tell the user what to fix, not just what went wrong
- **Evaluator files are data** — no business logic in `.md` files; logic lives in `core/src/evaluators/`
- **Never invoke the CLI as a subprocess from the MCP server** — call `@agent-opfor/core` directly

---

## Environment variables

| Variable                                      | Purpose                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| `OPENAI_API_KEY`                              | `openai` provider                                            |
| `ANTHROPIC_API_KEY`                           | `anthropic` provider                                         |
| `GOOGLE_GENERATIVE_AI_API_KEY`                | `google` provider                                            |
| `GROQ_API_KEY`                                | `groq` provider                                              |
| `DEEPSEEK_API_KEY`                            | `deepseek` provider                                          |
| `AZURE_OPENAI_API_KEY`                        | `azure` provider (also requires `attackerLlm.baseURL`)       |
| `OPFOR_API_KEY`                               | `openai-compatible` provider (LiteLLM, OpenRouter, Ollama …) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Langfuse telemetry                                           |
| `NETRA_API_KEY`                               | Netra telemetry                                              |

Copy `.env.example` to `.env` and fill in at least one provider key before running locally.

---

## PR and branch conventions

Branch names: `<type>/<short-description>` — e.g. `feat/add-ssrf-evaluator`, `fix/judge-false-positive`

PR titles: `<type>: <what changed>` — e.g. `feat: add SSRF evaluator for MCP05`

Types: `feat`, `fix`, `docs`, `refactor`, `chore`

Pre-commit hooks (husky + lint-staged) run `eslint` and `prettier` on staged files. Do not skip with `--no-verify`.

Full checklist: [CONTRIBUTING.md](CONTRIBUTING.md)
