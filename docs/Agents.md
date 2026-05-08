# AGENTS.md — Developer Guide

This repo builds and publishes **astra** — an evaluator-centric, provider-agnostic AI red teaming toolkit. It can be used in three modes: **Skills** (any AI coding agent reads markdown skill files), **CLI** (standalone TypeScript tool), and **MCP Server** (exposes red-team tools to MCP-compatible agents). All three modes share the same evaluator definitions and the same core engine.

Read this file before making any changes to this repo.

**Current packaging:** Workspace packages at the repo root: **`core/`** (shared engine), **`cli/`** (`astra` binary), **`mcp/`** (MCP server package). User-facing install and usage live in the root **`README.md`**.

---

## Architecture Overview

```
                    skills/astra-setup/evaluators/   ← single source of truth
                           ↓                  ↓
            Skills workflow             @astra/core (TypeScript engine)
         (agent reads .md files)          ↓              ↓
                                        cli/          mcp/
                                   (astra command)  (MCP server)
```

**Three usage modes — one set of evaluators:**

| Mode | Entry point | Who runs it |
|---|---|---|
| Skills | `skills/astra-setup/SKILL.md`, `skills/astra-run/SKILL.md` | AI coding agent (Cursor, Claude Code, Windsurf) reads and follows markdown instructions |
| CLI | `cli/dist/index.js` via `astra` command | User runs `astra setup` / `astra run` in terminal |
| MCP | `mcp/dist/index.js` (long-lived stdio process) | MCP-compatible host calls `astra_setup` / `astra_run` tools |

**Key design principles:**
- **Evaluator-centric**: Each evaluator tests one vulnerability class. Self-contained, composable into suites.
- **Single source of truth for evaluators**: The `.md` files in `skills/astra-setup/evaluators/` are read by both the Skills workflow (agent reads them) and the TypeScript engine (`@astra/core` parses their YAML frontmatter). Never duplicate them.
- **Provider-agnostic**: Works with OpenAI, Anthropic, Groq, Google, or any OpenAI-compatible endpoint via `@ai-sdk/*`.
- **No black box**: All logic is either markdown instructions (skills) or readable TypeScript (core/cli/mcp).

---

## Repo Structure

```
astra/
├── Agents.md                          ← YOU ARE HERE
├── README.md                          ← Public-facing: install, usage, examples
├── package.json                       ← Root npm workspace (workspaces: core, cli, mcp)
├── LICENSE                            ← Apache 2.0
├── astra.config.md.example            ← Config template for skills workflow
│
├── skills/                            ← Skill files for the agent-based workflow
│   ├── astra-setup/
│   │   ├── SKILL.md                   ← /astra-setup slash command (interactive wizard)
│   │   ├── evaluators/                ← 20 evaluator .md files (YAML frontmatter + narrative)
│   │   ├── suites/                    ← Suite definitions (YAML frontmatter + narrative)
│   │   └── targets/                   ← Target adapter instructions (http-endpoint, custom-function)
│   └── astra-run/
│       ├── SKILL.md                   ← /astra-run slash command (orchestrator)
│       └── report-schema.md           ← Report HTML/JSON specification
│
├── core/                              ← @astra/core — shared TypeScript engine (npm workspace)
│   ├── src/
│   │   ├── config/
│   │   │   ├── types.ts               ← All shared TypeScript types
│   │   │   ├── skillsLayout.ts        ← Resolves path to skills/astra-setup/ from any context
│   │   │   └── loadSkillCatalog.ts    ← Reads evaluator metadata and suite lists from .md frontmatter
│   │   ├── evaluators/
│   │   │   ├── parseEvaluator.ts      ← Parses a single evaluator .md (YAML frontmatter → EvaluatorSpec)
│   │   │   ├── generatePrompts.ts     ← LLM call to fill in attack pattern templates
│   │   │   └── judge.ts               ← LLM-as-judge: scores each attack/response pair
│   │   ├── providers/
│   │   │   └── factory.ts             ← createModel(): returns LanguageModel for any provider
│   │   ├── lib/
│   │   │   └── agent.ts               ← runAttackAgent(): fires one attack at HTTP endpoint, captures response
│   │   ├── report/
│   │   │   └── generateReport.ts      ← Writes HTML + JSON report files
│   │   └── util/
│   │       └── yamlFrontmatter.ts     ← splitYamlFrontmatter(): splits --- blocks from markdown body
│   ├── dist/                          ← Compiled output (generated — do not edit)
│   ├── package.json
│   └── tsconfig.json
│
├── cli/                               ← astra-cli — standalone CLI (npm workspace)
│   ├── src/
│   │   ├── index.ts                   ← CLI entrypoint (commander program)
│   │   └── commands/
│   │       ├── init.ts                ← `astra init` — writes a sample astra.config.json
│   │       ├── setup.ts               ← `astra setup` — interactive wizard + attack prompt generation
│   │       └── run.ts                 ← `astra run` — fires attacks, judges, writes reports
│   ├── dist/                          ← Compiled output (generated — do not edit)
│   ├── package.json
│   └── tsconfig.json
│
├── mcp/                               ← astra-mcp — MCP server (npm workspace)
│   ├── src/
│   │   ├── index.ts                   ← MCP server entrypoint: registers tools, connects stdio transport
│   │   └── core/
│   │       ├── setup.ts               ← runSetup(): thin wrapper over @astra/core for astra_setup tool
│   │       └── run.ts                 ← runScan(): thin wrapper over @astra/core for astra_run tool
│   ├── dist/                          ← Compiled output (generated — do not edit)
│   ├── package.json
│   └── tsconfig.json
│
├── extension/                         ← VS Code/Cursor extension (planned, stub only)
│
└── .astra/                            ← Generated files (gitignored)
    └── reports/                       ← HTML + JSON assessment reports
```

---

## Setting Up the Repo

```bash
git clone https://github.com/yourusername/astra.git
cd astra

# Install all workspace packages (--ignore-scripts skips build during install,
# which matters because cli and mcp depend on core being compiled first)
npm install --ignore-scripts

# Build in dependency order: core first, then cli and mcp
npm run build
```

Available build scripts (all run from repo root):

```bash
npm run build          # core → cli → mcp (always use this)
npm run build:core     # build only @astra/core
npm run build:cli      # build only astra-cli
npm run build:mcp      # build only astra-mcp
```

> **Important**: Always build `core` before `cli` or `mcp`. The TypeScript compiler needs `core/dist/` to exist before it can resolve `@astra/core` imports.

---

## File Schemas

### Evaluator File (`skills/astra-setup/evaluators/<id>.md`)

Each evaluator is a markdown file with **YAML frontmatter** that the TypeScript engine parses, plus a **narrative body** that the Skills workflow agent reads.

**The YAML frontmatter is the contract between the markdown files and the TypeScript engine. Both must stay in sync.**

```markdown
---
schema_version: 1
id: jailbreaking                         # must match filename (without .md)
name: Jailbreaking
severity: critical | high | medium | low
owasp: LLM10                             # OWASP category code
mitre: AML.T0054                         # optional MITRE ATLAS code
description: One-line description of what this evaluator tests
pass_criteria: |                         # multi-line string
  - Criteria for PASS verdict (target defended)
  - Binary — must be deterministic
fail_criteria: |
  - Criteria for FAIL verdict (vulnerability found)
  - Binary — if any sign of vulnerability, mark FAIL
patterns:                                # list of attack pattern templates
  - name: Pattern Name
    template: |
      Attack prompt text with {{placeholders}} for the LLM to fill in.
      Use {{target_original_purpose}}, {{malicious_request}}, etc.
  - name: Another Pattern
    template: Another prompt template...
---

# Evaluator Name

## What It Tests
[Plain-language explanation of the vulnerability]

## Why It Matters
[Real-world impact]

## Evaluation Criteria
[Mirror of pass_criteria/fail_criteria — for agent readers]

## Attack Patterns
_Templates are defined in YAML frontmatter (`patterns`) for tooling. Narrative sections below are for readers._

## Execute
[Instructions for the Skills workflow agent on how to run this evaluator]

## Remediation
[Actionable fixes, ordered quick → long-term]

## References
[OWASP, MITRE, research papers]
```

**Required frontmatter fields**: `id`, `name`, `severity`, `description`, `pass_criteria`, `fail_criteria`, `patterns` (non-empty array with `name` + `template` for each).

**Optional**: `schema_version`, `owasp`, `mitre`.

**How the TypeScript engine uses this**: `core/src/evaluators/parseEvaluator.ts` reads only the YAML frontmatter using `splitYamlFrontmatter()`. It extracts `id`, `name`, `severity`, `owasp`, `description`, `pass_criteria`/`passCriteria`, `fail_criteria`/`failCriteria`, and `patterns[]`. The markdown body is not parsed by the engine — it is only for agents reading the file directly.

### Suite File (`skills/astra-setup/suites/<id>.md`)

```markdown
---
name: OWASP LLM Top 10
version: "2025"
id: owasp-llm-top10                      # must match filename (without .md)
description: Brief description for display in the CLI wizard
evaluators:                              # ordered list of evaluator IDs to run
  - prompt-injection
  - sensitive-disclosure
  - jailbreaking
  # ...
---

# Suite Name

Narrative description of the suite — for agents reading directly.

## Category: LLM01: Prompt Injection
- **Evaluator**: prompt-injection
- **Severity**: critical
- **Status**: ✅ Available

# ...
```

**Required frontmatter fields**: `id`, `name`, `evaluators` (array of evaluator ID strings).

**Optional**: `version`, `description`.

**How the TypeScript engine uses this**: `core/src/config/loadSkillCatalog.ts` reads the YAML frontmatter only. It extracts `id`, `name`, `description`, and `evaluators[]` to populate the suite list in the CLI wizard.

### Target Adapter File (`skills/astra-setup/targets/<id>.md`)

Free-form markdown — no frontmatter required. Read by agents in the Skills workflow. Not parsed by the TypeScript engine. Sections:

- `## What This Is` — description of target type
- `## Request Construction` — how to build requests
- `## Response Parsing` — how to extract response text
- `## Error Handling` — timeout, auth, rate limit handling
- `## Sending the Attack` — automated (curl) and manual fallback

### CLI Config File (`astra.config.json` / `astra.config.yml`)

JSON or YAML file used by `astra setup --config` and the MCP `astra_setup` tool.

```json
{
  "llm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "apiKey": "",
    "baseURL": ""
  },
  "target": {
    "name": "My AI Agent",
    "description": "What the target does, what data it handles, what it should never do.",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat",
    "requestFormat": "openai",
    "targetModel": "gpt-4o-mini",
    "targetApiKey": ""
  },
  "selection": {
    "mode": "suite",
    "suite": "owasp-llm-top10"
  }
}
```

**Fields:**

| Field | Required | Values / Notes |
|---|---|---|
| `llm.provider` | No | `groq`, `openai`, `anthropic`, `google`, `other`. Defaults to `groq`. |
| `llm.model` | No | Model name. Defaults to provider default. |
| `llm.apiKey` | No | Falls back to env var if omitted. |
| `llm.baseURL` | Only for `other` | Base URL for custom OpenAI-compatible endpoint. |
| `target.name` | Yes | Display name. |
| `target.description` | Yes | Describe what it does, sensitive data, forbidden topics. More detail = better attacks. |
| `target.type` | Yes | `http-endpoint` or `python-function`. |
| `target.endpoint` | For HTTP | Full URL to POST attack prompts to. |
| `target.requestFormat` | For HTTP | `openai` (messages array) or `json` ({prompt: "..."} body). |
| `target.targetModel` | For HTTP | Model name to send in the request body. |
| `target.targetApiKey` | For HTTP | Bearer token for the target endpoint, if needed. |
| `target.functionSignature` | For python-function | Describes the function signature; included in prompt generation context. |
| `selection.mode` | Yes | `suite` or `evaluators`. |
| `selection.suite` | For suite | Suite ID (e.g. `owasp-llm-top10`, `owasp-agentic-ai`). |
| `selection.evaluators` | For evaluators | Array of evaluator IDs (must match filenames in `evaluators/`). |

---

## How Each Mode Works

### Skills Workflow

1. User types `/astra-setup` in their agent (Cursor, Claude Code, Windsurf)
2. Agent reads `skills/astra-setup/SKILL.md` — follows the interactive wizard
3. Agent reads suite files from `skills/astra-setup/suites/` and evaluator files from `skills/astra-setup/evaluators/`
4. Agent writes `astra.config.md` (markdown config for the skills workflow — different from the JSON/YAML CLI config)
5. User types `/astra-run`
6. Agent reads `skills/astra-run/SKILL.md`, loads the config and target adapter, runs evaluators, generates a report in chat

### CLI

```
astra init                                    # writes astra.config.json template
astra setup [--agent] [--mcp] [--empty]       # writes .astra/configs/astra-config-*.json
astra generate --config .astra/configs/astra-config-*.json
astra run --attacks .astra/attacks/astra-attacks-*.json
```

**setup internals** (`cli/src/commands/setup.ts`):
1. Load `loadSkillCatalog()` → reads all evaluator metadata and suite lists from `skills/astra-setup/`
2. Interactive wizard (or load config file) → collect LLM config, target config, evaluator IDs
3. For each evaluator ID: `loadBuiltinEvaluator(id)` → `generateAttackPrompts(evaluator, target, model)` (LLM fills in pattern templates)
4. Write `.astra/attacks/astra-attacks-<timestamp>-<configId>.json` with all generated attacks

**run internals** (`cli/src/commands/run.ts`):
1. Read `.astra/attacks/astra-attacks-*.json`
2. For each attack: `runAttackAgent(cfg)` → POSTs to target endpoint, captures response
3. For each response: `judgeResponse(evaluator, prompt, response, model)` → LLM judge returns PASS/FAIL + score
4. `generateReport(reports, ...)` → writes `.astra/reports/astra-<uuid>.html` and `.json`

### MCP Server

The MCP server is a **long-lived process** spawned by the MCP host (Cursor, Claude Desktop). It never exits unless the host closes the stdio pipe.

**Lifecycle:**
1. Host spawns `node mcp/dist/index.js`
2. `mcp/src/index.ts` loads `.env`, registers tools (`astra_setup`, `astra_run`), calls `server.connect(stdio)` — blocks forever
3. Host sends `tools/list` → SDK responds with tool schemas
4. Host sends `tools/call` with arguments → SDK validates, calls handler → handler calls `runSetup()` or `runScan()` from `mcp/src/core/`
5. Handler returns result → SDK writes JSON-RPC response to stdout → host gives text to agent
6. Server returns to waiting state (does **not** exit)

**mcp/src/core/ wrappers** are thin: they call `@astra/core` functions directly. No subprocess, no CLI invocation.

---

## Core Package (`@astra/core`)

All scanning logic lives here. Both `cli/` and `mcp/` import from it. Never duplicate code between CLI and MCP — put shared logic in core.

**Key exports:**

| Export path | What it provides |
|---|---|
| `@astra/core/config/types` | All TypeScript interfaces: `LlmConfig`, `TargetConfig`, `AttackEntry`, `PromptsFile`, `SetupConfigFile`, etc. |
| `@astra/core/config/skillsLayout` | `getAstraSetupRoot()` — resolves `skills/astra-setup/` path from any compiled location |
| `@astra/core/config/loadSkillCatalog` | `loadSkillCatalog()`, `resolveSuiteEvaluatorIds()`, `getEvaluatorIdSet()` |
| `@astra/core/evaluators/parseEvaluator` | `parseEvaluator(mdPath)`, `loadBuiltinEvaluator(id)` |
| `@astra/core/evaluators/generatePrompts` | `generateAttackPrompts(evaluator, targetDescription, model)` |
| `@astra/core/evaluators/judge` | `judgeResponse(evaluator, prompt, response, model)` → `JudgeResult` |
| `@astra/core/providers/factory` | `createModel(llm)`, `PROVIDER_DEFAULTS`, `PROVIDER_ENV_VARS` |
| `@astra/core/lib/agent` | `runAttackAgent(cfg)` → fires HTTP attack + judges response |
| `@astra/core/report/generateReport` | `generateReport(reports, target, endpoint, outputDir)` → writes HTML + JSON |
| `@astra/core/util/yamlFrontmatter` | `splitYamlFrontmatter(raw)` → `{ yaml, body }` |

**`skillsLayout.ts` is critical**: it uses `import.meta.url` to find its own location at runtime and resolves `skills/astra-setup/` relative to that. This works whether code runs from `core/src/config/` (dev) or `core/dist/config/` (production). Any code in `cli/` or `mcp/` that needs the skills path must import `getAstraSetupRoot()` from here — never hardcode paths.

---

## LLM Providers

Configured via `@astra/core/providers/factory.ts`. Supports:

| Provider | `llm.provider` value | Env var | Default model |
|---|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-5-haiku-20241022` |
| Groq | `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| Google | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| Any OpenAI-compatible | `other` | `ASTRA_API_KEY` | requires `llm.baseURL` |

**API key resolution order** (both CLI and MCP):
1. `--api-key` CLI flag / `api_key` MCP tool argument
2. `llm.apiKey` in the config file
3. Provider's environment variable (e.g. `GROQ_API_KEY`)

**MCP API key**: The MCP server calls `loadDotenv()` at startup, so placing a `.env` file in the working directory (usually the project root) is sufficient. No need to hardcode keys in `mcp.json`.

---

## Extensibility

### Adding a new evaluator

1. Create `skills/astra-setup/evaluators/<evaluator-id>.md` with the full frontmatter schema (see above). The `id` must match the filename.
2. Add the evaluator ID to one or more suite files under `evaluators:` in the YAML frontmatter.
3. Done — the CLI, MCP, and Skills workflow all auto-discover it. No TypeScript changes needed.

**Checklist for a new evaluator:**
- [ ] `id` matches filename exactly
- [ ] `severity` is one of `critical`, `high`, `medium`, `low`
- [ ] `pass_criteria` and `fail_criteria` are unambiguous — binary, no "maybe"
- [ ] `patterns` has at least one entry with both `name` and `template`
- [ ] Templates use `{{placeholder}}` syntax for content the LLM fills in
- [ ] Added to at least one suite's `evaluators:` list

### Adding a new suite

1. Create `skills/astra-setup/suites/<suite-id>.md` with the frontmatter schema (see above).
2. List the evaluator IDs you want in the suite under `evaluators:`.
3. Done — CLI wizard and MCP auto-discover it.

### Adding a new target type (Skills workflow)

1. Create `skills/astra-setup/targets/<type>.md` — free-form markdown, no frontmatter needed.
2. Include sections: `## What This Is`, `## Request Construction`, `## Response Parsing`, `## Error Handling`.
3. The Skills workflow agent discovers it by scanning the `targets/` directory.

### Adding a new LLM provider (TypeScript engine)

1. Add the new provider to the `ProviderName` union type in `core/src/config/types.ts`.
2. Add its default model and env var to `PROVIDER_DEFAULTS` and `PROVIDER_ENV_VARS` in `core/src/providers/factory.ts`.
3. Add a new `case` in `createModel()` using the appropriate `@ai-sdk/*` package.
4. Install the `@ai-sdk/<provider>` package in `core/package.json` and rebuild.

---

## Design Principles

### Writing Evaluator Content

1. **Binary evaluation only**: PASS or FAIL. No "risky", no "maybe". Criteria must be precise enough for an LLM judge to decide unambiguously. When in doubt, FAIL.

2. **Generalized templates**: Attack pattern `template` fields use `{{placeholder}}` syntax. The LLM fills these in for the specific target at setup time. Never hardcode target-specific prompts in the evaluator file.

3. **Self-contained**: Each evaluator can run standalone or as part of a suite. Don't assume context from other evaluators.

4. **Evidence-based**: Evaluation criteria must reference specific response characteristics (exact phrases, behaviors, what was disclosed) — not vague judgments like "seems unsafe".

5. **Progressive depth via multiple patterns**: Include basic patterns (obvious attacks) and advanced patterns (bypass attempts). The LLM generates multiple concrete prompts per pattern.

### Severity Ratings

| Rating | Meaning |
|---|---|
| `critical` | Immediate data breach or compliance violation. Low effort to exploit. |
| `high` | Significant security risk. Moderate effort or specific conditions. |
| `medium` | Quality/safety concern. Requires chained attacks or specific setup. |
| `low` | Edge case. Informational. Minimal direct impact. |

### Naming Conventions

- All file and directory names: lowercase, kebab-case
- Evaluator `id` in frontmatter must exactly match the filename without `.md`
- Suite `id` in frontmatter must exactly match the filename without `.md`
- TypeScript files: camelCase functions, PascalCase types/interfaces

---

## Contributing

**Before starting:**
1. Read this file entirely
2. Read an existing evaluator (e.g. `skills/astra-setup/evaluators/prompt-injection.md`) to see the exact format
3. Run `npm install --ignore-scripts && npm run build` and verify it compiles cleanly

**When adding an evaluator:**
1. Follow the schema — especially the frontmatter fields
2. Use `{{placeholder}}` in templates, never hardcoded prompts
3. Keep pass/fail criteria binary and unambiguous
4. Test: run `astra setup --config astra.config.json` and confirm your evaluator appears in the list
5. Add to at least one suite

**When modifying `@astra/core`:**
1. Run `npm run build` after changes — cli and mcp both depend on the compiled output
2. Check that both `cli/` and `mcp/` still compile: `npm run build:cli && npm run build:mcp`
3. If you add a new export, add it to the `exports` map in `core/package.json`

**When updating CLI commands:**
1. Changes to `cli/src/commands/setup.ts` or `run.ts` affect only the CLI — MCP uses `mcp/src/core/setup.ts` and `run.ts`
2. If the change is to shared logic (providers, report generation, judging), put it in `core/` not in `cli/`

**When updating MCP tools:**
1. Tool schemas are in `mcp/src/index.ts` — change parameters here
2. Logic is in `mcp/src/core/setup.ts` and `run.ts` — these call `@astra/core` directly
3. Never invoke the CLI as a subprocess from the MCP server

**Code quality:**
- Markdown frontmatter must be valid YAML
- Evaluator `id` must match filename
- TypeScript: run `npm run build` and fix all errors before committing
- No `any` types in core — use the types from `core/src/config/types.ts`

---

## Changelog

**v0.2.0** (current):
- Evaluator-centric architecture (from vulnerability-centric)
- Monorepo: `core/`, `cli/`, `mcp/` as npm workspaces
- `@astra/core` shared engine — single source of logic for CLI and MCP
- MCP server (`astra_setup` + `astra_run` tools)
- CLI rewritten in TypeScript with interactive wizard, suite selection, `@ai-sdk/*` provider support
- Attack prompts generated by LLM from YAML frontmatter templates
- LLM-as-judge for PASS/FAIL verdicts
- HTML + JSON report generation
- Evaluator YAML frontmatter is the contract between markdown files and the TypeScript engine
