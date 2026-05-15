<p align="center">
  <img src="assets/opfor-logo.png" alt="OPFOR" width="120" />
</p>

<p align="center">
  <strong>Open-source adversary emulation for AI agents, LLM apps, and MCP servers.</strong><br/>
  Test your AI like a real attacker would — from your CLI, your IDE, or a browser extension that anyone on your team can use.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-444441?style=flat&labelColor=3d3d3a" alt="License: Apache 2.0"></a>
  <a href="#evaluator-coverage"><img src="https://img.shields.io/badge/OWASP-LLM%20%2B%20Agentic%20%2B%20MCP%20%2B%20API-185FA5?style=flat&labelColor=3d3d3a" alt="OWASP coverage"></a>
</p>

<p align="center">
  <a href="https://keyvalue.systems">Website</a> ·
  <a href="https://github.com/KeyValueSoftwareSystems/opfor">GitHub</a> ·
  <a href="docs/browser-extension.md">Browser Extension</a>
</p>

<p align="center">
  <img src="assets/opfor-high-level.svg" alt="How OPFOR works" width="860" />
</p>

---

## Why we built this

We've shipped 130 products for 90 startups over the last ten years. In the last 18 months, almost every one of them had an AI agent in it — and every one of those teams hit the same wall when it came to testing.

So we built OPFOR. For ourselves first. Now open source.

Apache 2.0. Built from India.

---

## Quick Start

```bash
npm install -g opfor
opfor setup
opfor execute
```

Opfor walks you through picking a target, generating attacks, running them, and producing an HTML report. Set an API key for your LLM provider first:

```bash
export GROQ_API_KEY=your-key    # or OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
```

→ [Examples](examples/) · [Browser extension](docs/browser-extension.md)

---

## What opfor does

- 🎯 **Red-teams the whole AI agent surface** — prompts, tools, MCP servers, memory, multi-turn reasoning
- 🧪 **Generates targeted attacks** for OWASP LLM Top 10, OWASP Agentic AI Top 10, OWASP MCP Top 10, OWASP API Security, and EU AI Act bias suites
- 🔌 **Connects to MCP servers directly** — enumerates tools, fires real `tools/call` requests with adversarial inputs, judges responses
- 👁️ **Trace-aware** — integrates with Langfuse and Netra so the LLM judge sees what your agent did internally, not just what it said
- 📄 **Produces reports you can ship** — timestamped HTML for browsing, JSON for CI/CD, every prompt + response + judge verdict logged

---

## Why opfor

Most red-team tooling in this space is excellent at one thing — a probe library, a developer evaluator, a programmatic framework. None of them ship a browser extension. None of them run as an MCP server themselves. None of them cover all four OWASP standards in one tool.

We built opfor because we needed all three.

- 🌐 **Browser extension for non-developers** — anyone on your team can red-team a deployed chatbot, no code, no env vars, no YAML
- 🤖 **Run opfor as an MCP server** — let your AI coding agent in Cursor or Claude Desktop red-team your other agents through natural language
- 🛡️ **Full OWASP coverage in one tool** — LLM Top 10, Agentic AI Top 10, MCP Top 10, API Security Top 10
- 🔓 **No black box** — every attack prompt, request, response, and judge verdict is logged. Reproducible, auditable, forkable.
- 🎯 **Built for agents, not just models** — designed for tool calls, MCP, memory, and multi-turn state from day one

---

## Four ways to run opfor

Different people on your team need different entry points. Opfor ships four.

| Mode                     | How                                                              | Best for                                                                                  |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **🖥️ CLI**               | `opfor setup` → `opfor execute`                                  | Engineers, CI/CD, terminal-first workflows                                                |
| **🌐 Browser extension** | Install the extension, click the icon on any chat interface      | Product managers, designers, QA, security analysts — anyone who can't or won't write code |
| **🤖 MCP server**        | Register opfor in Cursor or Claude Desktop, then ask in chat     | AI coding agents that test your other agents                                              |
| **⚡ Skills**            | `/opfor-setup` and `/opfor-run` in Cursor, Claude Code, Windsurf | Developers who want one-command testing inside their IDE                                  |

All four share the same evaluators, attack templates, and judge logic.

→ [CLI reference](docs/cli.md) · [Browser extension setup](docs/browser-extension.md) · [MCP setup](docs/mcp.md) · [Skills setup](docs/skills.md)

---

## How it works

<p align="center">
  <img src="assets/opfor-execution-flow.svg" alt="What happens during opfor execute" width="860" />
</p>

When you run a scan, opfor:

1. **Fetches target info** — connects to your agent, detects available tools, MCP endpoints, capabilities
2. **Plans attacks per category** — generates targeted prompts for each evaluator in your selected suite
3. **Emulates the attack** — runs multi-turn adversarial conversations (real requests, real responses)
4. **Evaluates with a judge** — an LLM judge classifies each response with pass/fail + reasoning
5. **Generates a report** — HTML for browsing, JSON for CI/CD, all artifacts logged for reproducibility

Reports land in `.opfor/reports/report-<timestamp>/`.

---

## Browser extension — red-team a chatbot

The browser extension is opfor's no-code path. Install from the Chrome Web Store, open any chat interface, click the opfor icon, pick a suite, and watch it run.

It auto-detects the chat interface, sends attack prompts as if you were typing them, watches the responses, and downloads an HTML report when done. No CLI, no target setup, no YAML.

This is the path for the half of every product team that doesn't open a terminal.

→ [Install from the Chrome Web Store](https://chromewebstore.google.com/) · [Setup guide](docs/browser-extension.md)

---

## Evaluator coverage

Opfor ships with curated suites that map to industry standards. Pick a suite or run individual evaluators.

| Suite ID              | Standard                  | Focus                                                                     |
| --------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `owasp-llm-top10`     | OWASP LLM Top 10 (2025)   | Prompt injection, jailbreaks, sensitive disclosure, system prompt leakage |
| `owasp-agentic-ai`    | OWASP Agentic AI Top 10   | Excessive agency, tool misuse, agent goal hijack, memory poisoning        |
| `owasp-mcp-top10`     | OWASP MCP Top 10 (2025)   | Secret exposure, scope escalation, tool description injection, SSRF       |
| `owasp-api`           | OWASP API Security Top 10 | BOLA, BFLA, SQL injection                                                 |
| `eu-ai-act-bias`      | EU AI Act — Bias          | Age, gender, race, disability                                             |
| `output-trust-safety` | Output trust & safety     | Hallucination, misinformation, improper output handling                   |

→ [Full evaluator reference and OWASP mapping](docs/evaluators.md)

---

## Trace-aware testing

Plug opfor into your observability stack and the LLM judge sees not just the final response — but every tool call, retrieval, and intermediate reasoning step. Out of the box, opfor integrates with **[Langfuse](https://langfuse.com)** and **[Netra](https://netra.io)** (Netra is our paid hosted product — same team).

```json
"telemetry": {
  "provider": "langfuse",
  "langfuse": { "baseUrl": "https://cloud.langfuse.com" }
}
```

This catches what input/output testing misses — PII that leaks into a tool call but never reaches the user, scope escalations in MCP that don't change the response text, agents that retrieve unauthorized data but render a clean reply.

→ [Trace-aware testing guide](docs/cli.md#trace-aware-testing-agent-mode-only)

---

## Examples

| Example                                               | Description                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| [vanilla-chat](tests/e2e/agents/vanilla-chat)         | Plain customer support chatbot — test LLM-level vulnerabilities |
| [customer-support](tests/e2e/agents/customer-support) | Tool-calling agent with PostgreSQL — test BOLA, BFLA, RBAC, PII |
| [mcp-server-demo](examples/mcp-server-demo)           | Sample MCP server with intentional vulnerabilities              |
| [github-actions](examples/ci-cd/github-actions.yml)   | Run opfor in CI on every PR                                     |

→ [All examples](examples/)

---

## Supported LLM providers

| Provider          | Env var                        | Default model                      |
| ----------------- | ------------------------------ | ---------------------------------- |
| Groq              | `GROQ_API_KEY`                 | `llama-3.3-70b-versatile`          |
| OpenAI            | `OPENAI_API_KEY`               | `gpt-4o-mini`                      |
| Anthropic         | `ANTHROPIC_API_KEY`            | `claude-3-5-haiku-20241022`        |
| Google            | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash`                 |
| OpenAI-compatible | `OPFOR_API_KEY` + `baseURL`    | LiteLLM, OpenRouter, Azure, Ollama |

---

## Contributing

Highest-impact ways to contribute:

1. **New evaluators** — add a `.md` file under `skills/*/evaluators/` with attack templates and pass/fail criteria. The engine auto-discovers it. No TypeScript needed.
2. **New target adapters** — extend `core/src/mcp-client/` to support new agent frameworks.
3. **Findings** — run opfor against a public agent or MCP server and PR your writeup to `findings/`.
4. **Bug reports** — open an [issue](https://github.com/KeyValueSoftwareSystems/opfor/issues).

Read the [Contributing Guide](CONTRIBUTING.md).

---

## Security

Use opfor only on systems you own or are authorized to test.

To report a vulnerability in opfor itself, see [SECURITY.md](SECURITY.md). Email [opfor@keyvalue.systems](mailto:opfor@keyvalue.systems) — do not open a public issue.

---

## License

[Apache 2.0](LICENSE) — free to use, modify, and distribute.

---

_OPFOR is short for Opposition Force — a military term for the dedicated unit that plays the enemy in training, so the rest of the army learns what real attacks feel like before they come. We named the tool after that idea: to defend AI agents better, you have to attack them first._

---

<p align="center">
  <strong>Built by <a href="https://keyvalue.systems">KeyValue</a></strong><br/>
  130 products · 10 years · From India
</p>

<br/>

<p align="center">
  Also from our team: <a href="https://getnetra.ai/"><strong>Netra</strong></a> — AI observability, tracing, and simulation.<br/>
  <a href="docs/cli.md#trace-aware-testing-agent-mode-only">Integrates with opfor for trace-aware testing.</a>
</p>

<br/>

<p align="center">
  Apache 2.0 · <a href="https://github.com/KeyValueSoftwareSystems/opfor">GitHub</a>
</p>
