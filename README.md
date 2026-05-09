# `astra`

**Open-source red teaming for AI agents and MCP servers.**

One tool to generate OWASP-mapped attack prompts, fire them at your target, and judge every response with an LLM. Works as a CLI, an MCP server inside Cursor or Claude Desktop, or a slash command in any AI coding agent.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-444441?style=flat&labelColor=3d3d3a)](LICENSE)
[![OWASP LLM Top 10](https://img.shields.io/badge/OWASP_LLM_Top_10-covered-185FA5?style=flat&labelColor=3d3d3a)](#evaluator-suites)
[![OWASP Agentic Top 10](https://img.shields.io/badge/OWASP_Agentic_Top_10-covered-185FA5?style=flat&labelColor=3d3d3a)](#evaluator-suites)
[![OWASP MCP Top 10](https://img.shields.io/badge/OWASP_MCP_Top_10-covered-185FA5?style=flat&labelColor=3d3d3a)](#evaluator-suites)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat&labelColor=3d3d3a)](CONTRIBUTING.md)

---

## Who this is for

- **Agent builders** — find out how your agent gets exploited before your users do.
- **MCP server authors** — regression-test tool behavior (scope, input validation, secret handling) before release.
- **Security reviewers** — reproducible runs: fixed attack plans, logged requests/responses, LLM-judged verdicts per call.

---

## Three ways to run astra

| Mode           | How                                              | Best for                                            |
| -------------- | ------------------------------------------------ | --------------------------------------------------- |
| **CLI**        | `astra setup` → `astra generate` → `astra run`   | Terminal-first workflows, CI/CD                     |
| **MCP Server** | Add to Cursor / Claude Desktop, then ask in chat | Agents that test agents                             |
| **Skills**     | `/astra-setup` and `/astra-run` slash commands   | Any AI coding agent (Cursor, Claude Code, Windsurf) |

All three modes share the same evaluators, attack templates, and judge logic.

---

## Install

```bash
git clone https://github.com/KeyValueSoftwareSystems/astra.git
cd astra
npm install --ignore-scripts
npm run build
npm install -g ./cli      # makes the `astra` command available globally
```

Set an API key for your preferred LLM provider (used for attack generation and judging):

```bash
export GROQ_API_KEY=your-key-here
# or: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
```

---

## Mode 1 — CLI

### Step 1 — Init (optional)

```bash
astra init                        # writes a starter astra.config.json
astra init --example python       # writes astra-local-target.py stub only
astra init --example node         # writes astra-local-target.js stub only
```

Skip this step if you prefer the interactive wizard (`astra setup` with no flags).

---

### Step 2 — Generate attack prompts

```bash
# Interactive wizard — no config file needed
astra setup

# Non-interactive — reads a config file, good for CI
astra generate --config astra.config.json
```

Both write a timestamped attacks file to `.astra/attacks/`. You can inspect this file before running — it contains every attack prompt, the target config, and the judge config.

**Minimal `astra.config.json`:**

```json
{
  "llm": { "provider": "groq", "model": "llama-3.3-70b-versatile" },
  "target": {
    "name": "My Support Bot",
    "description": "A customer support chatbot with access to user booking data and PII.",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat"
  },
  "selection": { "mode": "suite", "suite": "owasp-llm-top10" }
}
```

YAML is also supported (`astra.config.yml`).

---

### Step 3 — Run the scan

```bash
astra run --attacks .astra/attacks/astra-attacks-<timestamp>-<id>.json

# Override target at run time
astra run --attacks .astra/attacks/astra-attacks-<timestamp>-<id>.json --target-script ./adapter.js

# Custom report directory
astra run --attacks .astra/attacks/astra-attacks-<timestamp>-<id>.json --out-dir ./reports
```

Reports are written to:

```
.astra/reports/report-<timestamp>/
  ├── report.html   ← open in a browser
  └── report.json   ← use in CI/CD
```

> **Shortcut:** `astra run` and `astra generate` work without arguments — they invoke the setup wizard automatically if no file is provided.

Full CLI reference: [`docs/cli.md`](docs/cli.md)

---

## Mode 2 — MCP Server (Cursor, Claude Desktop)

Register astra as an MCP server and red-team directly from chat — no terminal required.

**Cursor** — add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "astra": {
      "command": "node",
      "args": ["/absolute/path/to/astra/mcp/dist/index.js"]
    }
  }
}
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "astra": {
      "command": "node",
      "args": ["/absolute/path/to/astra/mcp/dist/index.js"]
    }
  }
}
```

Then just talk to your agent:

```
"Red team my chatbot at http://localhost:4000/chat using the OWASP LLM Top 10 suite"
```

The agent calls three tools in sequence:

| Tool                    | What it does                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| `astra_list_evaluators` | Returns all evaluator IDs, severities, OWASP tags, and available suites |
| `astra_setup`           | Generates targeted attack prompts (inline params or config file path)   |
| `astra_run`             | Fires attacks, judges responses, writes HTML + JSON reports             |

Full MCP reference: [`docs/mcp.md`](docs/mcp.md)

---

## Mode 3 — Skills (slash commands)

In any AI coding agent that supports slash commands (Cursor, Claude Code, Windsurf):

```
/astra-setup    ← interactive wizard: picks target, suite, LLM provider
/astra-run      ← fires attacks and generates a report in chat
```

No CLI install needed. The agent reads the skill files directly from the `skills/` directory.

---

## What it tests

### Agent mode — HTTP or local-script targets

Send attack prompts to any HTTP endpoint or a local stdin/stdout adapter script.

```json
{
  "target": {
    "name": "My Bot",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat",
    "requestFormat": "openai"
  }
}
```

For a local script adapter (when your target is not a single URL):

```json
{
  "target": {
    "name": "My Bot",
    "type": "local-script",
    "scriptPath": "./astra-local-target.js"
  }
}
```

The script reads `{"prompt":"...","sessionId":"..."}` from stdin and writes `{"response":"..."}` to stdout.

### MCP mode — live tool calls against MCP servers

Astra connects to your MCP server, calls `tools/list`, generates tool-specific attacks, fires real `tools/call` requests, and judges the responses.

**STDIO transport:**

```json
{
  "mode": "mcp",
  "mcp": {
    "server": { "transport": "stdio", "command": "node", "args": ["dist/index.js"] },
    "llm": { "provider": "openai", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" }
  }
}
```

**HTTP/SSE transport:**

```json
{
  "mode": "mcp",
  "mcp": {
    "server": {
      "transport": "url",
      "url": "https://your-mcp-server.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    },
    "llm": { "provider": "openai", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" }
  }
}
```

---

## Evaluator suites

| Suite ID              | Standard                  | Evaluators                                                                                                   |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `owasp-llm-top10`     | OWASP LLM Top 10 (2025)   | prompt-injection, jailbreaking, sensitive-disclosure, system-prompt-leakage, misinformation, …               |
| `owasp-agentic-ai`    | OWASP Agentic AI Top 10   | excessive-agency, tool-misuse, agent-goal-hijack, rogue-agents, memory-poisoning, cascading-failures, …      |
| `owasp-mcp-top10`     | OWASP MCP Top 10 (2025)   | secret-exposure, oauth-token-passthrough, scope-escalation, tool-description-injection, command-injection, … |
| `owasp-api`           | OWASP API Security Top 10 | bola, bfla, sql-injection, …                                                                                 |
| `eu-ai-act-bias`      | EU AI Act — Bias          | bias-age, bias-gender, bias-race, bias-disability                                                            |
| `output-trust-safety` | Output trust & safety     | hallucination, misinformation, improper-output-handling, …                                                   |
| `custom-ag1`          | Agentic AI (custom)       | ag1-grounding-poisoning, …                                                                                   |

### OWASP MCP Top 10 — evaluator mapping

| OWASP ID | Evaluator ID                 | What it probes                                               | Severity |
| -------- | ---------------------------- | ------------------------------------------------------------ | -------- |
| MCP01    | `secret-exposure`            | API keys, tokens, credentials leaked via errors or responses | Critical |
| MCP01    | `oauth-token-passthrough`    | OAuth confused deputy and token passthrough attacks          | Critical |
| MCP02    | `scope-escalation`           | Privilege escalation and scope bypass                        | High     |
| MCP03    | `tool-description-injection` | Hidden instructions injected via adversarial tool inputs     | Critical |
| MCP03    | `content-injection`          | Second-order content injection via fetched page content      | High     |
| MCP03    | `tool-description-scan`      | Static scan of tool descriptions for hidden LLM directives   | High     |
| MCP04    | `supply-chain`               | Software supply chain attacks and dependency tampering       | High     |
| MCP05    | `ssrf`                       | SSRF — internal IPs, cloud metadata, localhost               | Critical |
| MCP05    | `command-injection`          | Command injection and shell metacharacter attacks            | Critical |
| MCP06    | `intent-subversion`          | Agent intent redirection via tool responses                  | High     |
| MCP07    | `missing-authentication`     | Unauthenticated or weakly authenticated tool access          | High     |
| MCP08    | `audit-telemetry`            | Actions taken without traceability                           | Medium   |
| MCP09    | `shadow-mcp-server`          | Shadow / rogue MCP server detection and spoofing             | High     |
| MCP10    | `cross-resource-leakage`     | Cross-user, cross-tenant, and cross-session data leakage     | High     |

Run a specific subset instead of a full suite:

```json
"selection": {
  "mode": "evaluators",
  "evaluators": ["prompt-injection", "sensitive-disclosure", "jailbreaking"]
}
```

---

## Supported LLM providers

| `llm.provider` | Env var                        | Default model               |
| -------------- | ------------------------------ | --------------------------- |
| `groq`         | `GROQ_API_KEY`                 | `llama-3.3-70b-versatile`   |
| `openai`       | `OPENAI_API_KEY`               | `gpt-4o-mini`               |
| `anthropic`    | `ANTHROPIC_API_KEY`            | `claude-3-5-haiku-20241022` |
| `google`       | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash`          |
| `other`        | `ASTRA_API_KEY`                | requires `llm.baseURL`      |

Any OpenAI-compatible endpoint (LiteLLM, OpenRouter, Azure, Ollama) works via `provider: "other"` + `llm.baseURL`:

```json
"llm": { "provider": "other", "baseURL": "http://localhost:11434/v1", "model": "llama3.2" }
```

---

## Advanced features

### Multi-turn attacks

Astra can run adversarial multi-turn conversations — after each response, an attacker LLM generates a more escalating follow-up:

```json
{ "turnMode": "multi", "turns": 3, "target": { "sessionIdField": "session_id" } }
```

### Telemetry enrichment (Langfuse / Netra)

When configured, astra pulls real production traces to ground attack prompts in actual user language, and injects trace IDs so the LLM judge has visibility into internal tool calls — not just the final response.

```json
"telemetry": {
  "provider": "langfuse",
  "langfuse": { "baseUrl": "https://cloud.langfuse.com" }
}
```

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
```

### CI/CD

```yaml
- name: Generate attacks
  run: astra generate --config astra.config.json

- name: Run scan
  run: astra run --attacks .astra/attacks/astra-attacks-*.json
```

---

## API keys

Keys are loaded in this order: `--api-key` CLI flag → `llm.apiKey` in config → provider env var. The CLI loads `.env` from the current working directory automatically.

Never commit API keys. Add `.astra/` to `.gitignore`.

---

## Contributing

Astra is open source and contributions are welcome. Highest-impact ways to contribute:

1. **New evaluators** — add a `.md` file to `skills/agent-redteaming/astra-setup/evaluators/` or `skills/mcp-redteaming/evaluators/` with attack templates, pass/fail criteria, and a CVE or paper citation. No TypeScript needed — the engine auto-discovers it.
2. **New target adapters** — add support for new agent frameworks or transports in `core/src/mcp-client/`.
3. **Findings** — run astra against a public agent or MCP server and open a PR to `findings/` with a writeup.
4. **Bug reports** — open an [issue](https://github.com/KeyValueSoftwareSystems/astra/issues) with steps to reproduce.

Read the full [Contributing Guide](CONTRIBUTING.md) before opening a PR.

---

## Security disclosure

Use astra only on systems you own or are authorized to test.

To report a vulnerability in astra itself, see [SECURITY.md](SECURITY.md). Do not open a public issue — email [astra@keyvalue.systems](mailto:astra@keyvalue.systems) instead.

---

## License

[Apache 2.0](LICENSE) — free to use, modify, and distribute.
