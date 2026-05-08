# Contributing to Astra

Thanks for helping make AI red teaming better. This guide covers the three highest-impact contribution types: new evaluators, new target adapters, and findings from running Astra against real systems.

## Table of contents

- [Before you start](#before-you-start)
  - [Branch naming](#branch-naming)
  - [PR naming](#pr-naming)
- [Adding an evaluator](#adding-an-evaluator)
- [Adding a suite](#adding-a-suite)
- [Adding a target adapter](#adding-a-target-adapter)
- [Submitting findings](#submitting-findings)
- [Code contributions](#code-contributions)
- [Pull request checklist](#pull-request-checklist)

---

## Before you start

1. Check [open issues](https://github.com/KeyValueSoftwareSystems/astra/issues) to avoid duplicating work.
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
git clone https://github.com/KeyValueSoftwareSystems/astra.git
cd astra
npm install
npm run build
```

Set an API key so you can test locally:

```bash
cp .env.example .env
# fill in at least one provider key
```

---

## Adding an evaluator

Evaluators live in `skills/astra-setup/evaluators/` as Markdown files with YAML frontmatter. No TypeScript changes are needed — the engine loads them automatically.

### File format

Create `skills/astra-setup/evaluators/<your-id>.md`:

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
astra run --attacks .astra/attacks/astra-attacks-*.json
```

---

## Adding a suite

Suites are also Markdown files with YAML frontmatter, in `skills/astra-setup/suites/`.

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

Reference only evaluator IDs that exist in `skills/astra-setup/evaluators/`. The engine validates this at load time.

---

## Adding a target adapter

Target adapters connect Astra to new transport types or agent frameworks. They live in `core/src/mcp-client/` (MCP transports) and related `core/` modules.

When adding a new transport:

- Implement the same interface as `createClient.ts` — expose a `connectMcpClient()` function that returns `{ client, close }`.
- Add a new discriminated union branch to `McpServerConfigSchema` in `core/src/config/schema.ts`.
- Update the CLI setup wizard (`cli/src/commands/`) to offer the new transport as an option.
- Add a fixture config so others can test it.

---

## Submitting findings

If you run Astra against a public agent or MCP server and find a genuine vulnerability, consider a responsible disclosure writeup. The `findings/` directory (create it if it doesn't exist) is the right place:

```
findings/
└── <target-name>-<year>/
    ├── README.md       ← writeup: what you found, how, severity
    ├── config.json     ← sanitized config (no secrets)
    └── report.json     ← the Astra report JSON
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
    core/         ← @astra/core shared engine (npm workspace)
    cli/          ← astra-cli (npm workspace)
    mcp/          ← @astra/agent-mcp-server (npm workspace)
skills/
  astra-setup/
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
- [ ] No secrets, `.env` files, or `.astra/` artifacts committed
- [ ] PR description explains _what_ changed and _why_
