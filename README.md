# `astra`

**Open-source red teaming for AI agents and MCP servers.** One CLI — test LLM agents over HTTP, local scripts, or MCP tool calls. OWASP-mapped, LLM-judged, reports in HTML + JSON.

[![License](https://img.shields.io/badge/license-Apache_2.0-444441?style=flat&labelColor=3d3d3a)](LICENSE)
[![OWASP LLM Top 10](https://img.shields.io/badge/OWASP_LLM_Top_10-covered-185FA5?style=flat&labelColor=3d3d3a)](#evaluator-suites)
[![OWASP Agentic Top 10](https://img.shields.io/badge/OWASP_Agentic_Top_10-covered-185FA5?style=flat&labelColor=3d3d3a)](#evaluator-suites)
[![OWASP MCP Top 10](https://img.shields.io/badge/OWASP_MCP_Top_10-covered-185FA5?style=flat&labelColor=3d3d3a)](#evaluator-suites)

## Who this is for

- **Agent builders** — find out how your agent gets exploited before your users do.
- **MCP server authors** — regression-test tool behavior (scope, input validation, secret handling) before release.
- **Security reviewers** — reproducible runs: fixed attack plans, logged requests/responses, LLM-as-judge verdicts per call.

## Quick start

```bash
git clone https://github.com/yourusername/astra.git
cd astra
npm install
npm run build
```

Set an API key for your preferred LLM provider (used for attack generation and judging):

```bash
export GROQ_API_KEY=your-key-here      # or OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
```

Then follow the three steps below — [Configure](#step-1--configure), [Plan](#step-2--plan), [Execute](#step-3--execute) — each command prints the exact `Next:` command to run.

## The three-step workflow

---

### Step 1 — Configure

```bash
astra setup
```

Interactive wizard. Asks you what to test (MCP server or AI agent), which evaluator suite to use, and your LLM provider. Writes a timestamped config to:

```
.astra/configs/astra-config-<timestamp>-<id>.json
```

Use `--mcp` or `--agent` to skip the mode prompt. Use `--empty` to write a minimal config you can fill in by hand.

---

### Step 2 — Plan

```bash
astra generate --config .astra/configs/astra-config-<timestamp>-<id>.json
```

Reads your config, calls the LLM to generate adversarial attack prompts for each evaluator, and writes them to:

```
.astra/attacks/astra-attacks-<timestamp>-<id>.json
```

You can inspect this file before running — it contains every attack prompt, the target config, and the judge config. Re-use the same attacks file across multiple runs for reproducibility.

---

### Step 3 — Execute

```bash
astra run --attacks .astra/attacks/astra-attacks-<timestamp>-<id>.json
```

Fires every attack against your target, judges each response with an LLM, and writes reports to:

```
.astra/reports/report-<timestamp>/
  ├── report.html   ← human-readable, open in a browser
  └── report.json   ← machine-readable, use in CI/CD
```

---

> **Shortcut:** `astra run` and `astra generate` both work without arguments — they will invoke the setup wizard automatically if no config or attacks file is provided.

## What it tests

### Agent mode — HTTP or local-script targets

The config file written by `astra setup --agent` has an `agent` section with `llm`, `target`, and `selection`:

```json
{
  "schemaVersion": 3,
  "configId": "a1b2c3d4",
  "createdAt": "2026-05-05T00:00:00.000Z",
  "mode": "agent",
  "agent": {
    "llm": { "provider": "groq", "model": "llama-3.3-70b-versatile" },
    "target": {
      "name": "My Support Bot",
      "description": "A customer support chatbot with access to user booking data and PII.",
      "type": "http-endpoint",
      "endpoint": "http://localhost:4000/chat"
    },
    "selection": { "mode": "suite", "suite": "owasp-llm-top10" }
  }
}
```

For a local script target (stdin/stdout adapter):

```json
"target": {
  "name": "My Bot",
  "description": "...",
  "type": "local-script",
  "scriptPath": "./astra-local-target.js"
}
```

### MCP mode — live tool calls against MCP servers

Astra connects to your MCP server, calls `tools/list`, generates attacks per tool, fires real `tools/call` requests, and judges the responses.

The config file written by `astra setup --mcp` has an `mcp` section with `server` and `models`:

```json
{
  "schemaVersion": 3,
  "configId": "a1b2c3d4",
  "createdAt": "2026-05-05T00:00:00.000Z",
  "mode": "mcp",
  "mcp": {
    "server": {
      "transport": "stdio",
      "command": "node",
      "args": ["dist/index.js"]
    },
    "models": {
      "setup": { "provider": "openai", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" },
      "run":   { "provider": "openai", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" }
    }
  }
}
```

For a remote MCP server over HTTP/SSE:

```json
"mcp": {
  "server": {
    "transport": "url",
    "url": "https://your-mcp-server.example.com/mcp",
    "headers": { "Authorization": "Bearer <token>" }
  },
  "models": {
    "setup": { "provider": "openai", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" },
    "run":   { "provider": "openai", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" }
  }
}
```

> The easiest way to get a valid config is to run `astra setup` — the interactive wizard writes the correct structure for you.

## Evaluator suites

| Suite ID | Covers | Evaluators |
|---|---|---|
| `owasp-llm-top10` | OWASP LLM Top 10 (2025) | prompt-injection, jailbreaking, sensitive-disclosure, system-prompt-leakage, misinformation, improper-output-handling, … |
| `owasp-agentic-ai` | OWASP Agentic AI Top 10 | excessive-agency, tool-misuse, agent-goal-hijack, rogue-agents, memory-poisoning, cascading-failures, … |
| `owasp-mcp-top10` | OWASP MCP Top 10 | secret-exposure, oauth-token-passthrough, scope-escalation, tool-description-injection, command-injection, ssrf, missing-authentication, intent-subversion, cross-resource-leakage, … |

Run a specific subset instead of a full suite:

```json
"selection": {
  "mode": "evaluators",
  "evaluators": ["prompt-injection", "sensitive-disclosure", "jailbreaking"]
}
```

## API key

Set the key for your chosen provider as an environment variable before running `astra generate` or `astra run`. The CLI loads `.env` from the current working directory automatically.

```bash
# Recommended — environment variable or .env file
export GROQ_API_KEY=gsk_...
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

You can also embed the key directly in the config file (not recommended for shared configs):

```json
"llm": { "provider": "groq", "apiKey": "gsk_..." }
```

Never commit API keys. Add `.astra/` to `.gitignore`.

## Supported LLM providers

### Native providers

| `llm.provider` | Env var | Default model |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-5-haiku-20241022` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |

### OpenAI-compatible endpoints (`provider: "other"`)

Any service that exposes an OpenAI-compatible `/chat/completions` API works via `provider: "other"` + `llm.baseURL`. Examples:

| Service | `llm.baseURL` | Notes |
|---|---|---|
| **LiteLLM** (self-hosted proxy) | `https://your-litellm-host/v1` | Route to any model behind one key |
| **OpenRouter** | `https://openrouter.ai/api/v1` | 200+ models, one API key |
| **Together AI** | `https://api.together.xyz/v1` | Open-source models |
| **Azure OpenAI** | `https://<resource>.openai.azure.com/openai/deployments/<deployment>` | Enterprise Azure deployments |
| **Google Gemini (OpenAI-compat)** | `https://generativelanguage.googleapis.com/v1beta/openai` | Alternative to `provider: "google"` |
| **Ollama** (local) | `http://localhost:11434/v1` | Fully offline, no API key needed |
| **Any OpenAI-compatible host** | Your endpoint | Works out of the box |

Config example for LiteLLM:

```json
"llm": {
  "provider": "other",
  "baseURL": "https://your-litellm-host/v1",
  "model": "gpt-4o-mini",
  "apiKey": "your-litellm-key"
}
```

Config example for Ollama (no API key):

```json
"llm": {
  "provider": "other",
  "baseURL": "http://localhost:11434/v1",
  "model": "llama3.2"
}
```

## Multi-turn attacks

By default astra fires single-turn attacks. Enable multi-turn to have an attacker LLM escalate based on each response:

```json
{
  "turnMode": "multi",
  "turns": 3,
  "target": { "sessionIdField": "session_id" }
}
```

After each response, if the target holds firm, astra generates a more escalating follow-up — up to `turns` rounds, or until the judge returns FAIL.

## Telemetry enrichment (optional)

When a telemetry provider (Langfuse or Netra) is configured, astra:

1. **At generate** — pulls real production traces to ground attack prompts in actual user language and flows.
2. **At run time** — injects a trace ID into each request so the recorded trace can be passed to the judge, giving it visibility into internal tool calls and retrieved data.

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

## CI/CD

For non-interactive use, run `astra setup` once locally to produce the config file, commit it (without secrets), then use it in CI:

```yaml
- name: Generate attacks
  run: astra generate --config astra.config.json

- name: Run scan
  run: astra run --attacks .astra/attacks/astra-attacks-*.json
```

## Full CLI reference

See [`src/agent/docs/cli.md`](src/agent/docs/cli.md) for the complete commands and config fields reference.

## Contributing

Highest-impact contributions:

1. **New evaluators** — add a markdown file to `src/agent/skills/astra-setup/evaluators/` (agent) or `skills/astra-setup/evaluators/` (MCP) with attack templates, pass/fail criteria, and a CVE or paper citation.
2. **Target adapters** — add support for new agent frameworks or transports.
3. **Findings** — run astra against a public agent or MCP server and open a PR to `findings/` with a writeup.

## Security disclosure

Use astra only on systems you own or are authorized to test. To report a vulnerability in astra itself, see [SECURITY.md](SECURITY.md).

## License

Apache 2.0 — [LICENSE](LICENSE).
