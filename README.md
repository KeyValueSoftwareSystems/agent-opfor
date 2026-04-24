# 🏹 astra

Red team AI systems — using your coding agent, a standalone CLI, or an MCP server.

`astra` is an open-source toolkit for adversarial security testing of LLMs, chatbots, RAG pipelines, and AI agents. It covers the OWASP LLM Top 10 and OWASP Agentic AI Top 10.

You can use it in three ways:

|              | Skills (agent-based)                                            | CLI (standalone)                                     | MCP Server                                                 |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| **How**      | Agent reads skill files and executes the test                   | `astra init / setup / run` commands                  | Agent calls `astra_setup` / `astra_run` tools              |
| **Requires** | Claude Code, Cursor, Windsurf, or any agent with skills support | Node.js 18+, any LLM API key                         | Any MCP-compatible host (Cursor, Claude Desktop, Windsurf) |
| **Best for** | Interactive setup, white-box attacks, conversational workflow   | CI/CD pipelines, automated scans, scripted workflows | Agent-driven automation without leaving your IDE           |
| **Output**   | Markdown report in chat                                         | HTML + JSON report on disk                           | Summary in chat + HTML/JSON reports on disk                |

---

## Option 1 — Skills (agent-based)

The skills approach encodes red teaming **knowledge** as structured markdown files that any AI coding agent can read and execute. No code, no config — just describe your target.

### Install the skills

```bash
# From npm
npx skills add astra

# Or clone directly
git clone https://github.com/yourusername/astra.git
```

### Step 1 — Configure a target

Run the setup skill in your agent:

```
/astra-setup
```

The agent will guide you through:

- **Target Information** — name, type, endpoint, model
- **Application Context** — what it does, user types, sensitive data, dangerous actions, forbidden topics
- **System Prompt** — the actual instructions the target runs under (optional but improves attack quality)
- **Test Configuration** — which evaluators or suite to run, number of test cases, single or multi-turn

Result: a config folder is created at `.astra/configs/<uuid>/` with the config and pre-generated attack inputs.

### Step 2 — Run the assessment

```
/astra-run
```

The agent will:

1. Load your configuration and pre-generated attack inputs
2. Fire each attack at your target
3. Judge every response (PASS/FAIL) with evidence
4. Generate an HTML + JSON report in `.astra/reports/`

### Manual setup (skip the wizard)

Copy the example config and edit it directly:

```bash
cp astra.config.md.example .astra/configs/my-target.md
```

See [astra.config.md.example](astra.config.md.example) for the full template.

---

## Option 2 — CLI (standalone)

The CLI handles everything from the terminal: interactive setup, attack generation, firing attacks, judging responses, and producing reports — no agent required.

See **[docs/cli.md](docs/cli.md)** for full installation, commands, config reference, local script targets, Langfuse integration, and CI/CD setup.

---

## Option 3 — MCP Server

The MCP server exposes Astra as tools (`astra_list_evaluators`, `astra_setup`, `astra_run`) that any MCP-compatible agent can call directly — no terminal required.

See **[docs/mcp.md](docs/mcp.md)** for full setup, configuration, tool parameters, and Langfuse trace integration.

---

## What it tests

### LLM Vulnerabilities (OWASP LLM Top 10)

| Evaluator                        | Severity | OWASP |
| -------------------------------- | -------- | ----- |
| Prompt Injection                 | Critical | LLM01 |
| Sensitive Information Disclosure | Critical | LLM02 |
| Supply Chain Vulnerabilities     | High     | LLM03 |
| Data and Model Poisoning         | High     | LLM04 |
| Improper Output Handling         | High     | LLM05 |
| Excessive Agency                 | High     | LLM06 |
| System Prompt Leakage            | Critical | LLM07 |
| Vector and Embedding Weaknesses  | High     | LLM08 |
| Misinformation                   | High     | LLM09 |
| Unbounded Consumption            | High     | LLM10 |
| Jailbreaking                     | High     | LLM10 |

### Agentic AI Vulnerabilities (OWASP Agentic AI Top 10)

| Evaluator                          | Severity | OWASP |
| ---------------------------------- | -------- | ----- |
| Agent Goal Hijacking               | Critical | ASI01 |
| Tool Misuse and Exploitation       | Critical | ASI02 |
| Identity and Privilege Abuse       | Critical | ASI03 |
| Unexpected Code Execution          | Critical | ASI05 |
| Memory and Context Poisoning       | High     | ASI06 |
| Insecure Inter-Agent Communication | High     | ASI07 |
| Cascading Failures                 | High     | ASI08 |
| Human-Agent Trust Exploitation     | High     | ASI09 |
| Rogue Agents                       | Critical | ASI10 |

### Suites

| ID                 | Name                    | Covers                      |
| ------------------ | ----------------------- | --------------------------- |
| `owasp-llm-top10`  | OWASP LLM Top 10        | LLM01–LLM10 (10 evaluators) |
| `owasp-agentic-ai` | OWASP Agentic AI Top 10 | ASI01–ASI10 (10 evaluators) |

---

## Understanding the report

The HTML report (`.astra/reports/astra-*.html`) contains:

- **Safety score** — percentage of tests where the target defended successfully
- **Evaluator results table** — pass/fail counts and average score per evaluator
- **Findings** — critical and high severity failures ranked by score
- **Full test cases** — every prompt sent, response received, and judge verdict (expandable)

The JSON report (`.astra/reports/astra-*.json`) contains the same data in machine-readable form for CI integration.

---

## Project structure

```
astra/
├── package.json                       ← Root package (npm workspaces: core, cli, mcp)
├── README.md                          ← This file
├── Agents.md                          ← Developer guide
├── astra.config.md.example            ← Config template for skills workflow
├── LICENSE                            ← Apache 2.0
│
├── docs/                              ← Detailed documentation
│   ├── cli.md                         ← CLI usage, config reference, local scripts
│   └── mcp.md                         ← MCP server setup and tool reference
│
├── skills/                            ← Agent skill files (skills workflow)
│   ├── astra-setup/
│   │   ├── SKILL.md                   ← /astra-setup slash command
│   │   ├── evaluators/                ← 20 evaluator definition files (.md)
│   │   ├── suites/                    ← Suite definitions (owasp-llm-top10, owasp-agentic-ai)
│   │   └── targets/                   ← Target adapter instructions
│   └── astra-run/
│       ├── SKILL.md                   ← /astra-run slash command
│       └── report-schema.md           ← Report format specification
│
├── core/                              ← @astra/core — shared engine (npm workspace)
│   ├── src/
│   │   ├── config/                    ← Types, skill catalog loader, path resolver
│   │   ├── evaluators/                ← Evaluator parser, prompt generator, LLM judge
│   │   ├── providers/                 ← LLM provider factory (OpenAI, Anthropic, Groq, Google)
│   │   ├── lib/                       ← HTTP attack agent, local script subprocess helper
│   │   ├── report/                    ← HTML + JSON report generator
│   │   └── util/                      ← YAML frontmatter parser
│   ├── dist/                          ← Compiled output (generated by npm run build)
│   ├── package.json
│   └── tsconfig.json
│
├── cli/                               ← astra-cli — standalone CLI (npm workspace)
│   ├── src/
│   │   ├── index.ts                   ← CLI entrypoint (commander)
│   │   └── commands/                  ← init, setup, run commands
│   ├── dist/                          ← Compiled output (generated by npm run build)
│   ├── package.json
│   └── tsconfig.json
│
├── mcp/                               ← astra-mcp — MCP server (npm workspace)
│   ├── src/
│   │   ├── index.ts                   ← MCP server entrypoint (tools registered here)
│   │   └── core/                      ← setup.ts and run.ts — thin wrappers over @astra/core
│   ├── dist/                          ← Compiled output (generated by npm run build)
│   ├── package.json
│   └── tsconfig.json
│
├── extension/                         ← VS Code/Cursor extension (planned)
│
└── .astra/                            ← Generated files (gitignored)
    └── reports/                       ← Assessment reports (HTML + JSON)
```

---

## Contributing

Contributions are welcome. The most impactful ways to help:

**Add or improve evaluators** — edit the markdown files in `skills/astra-setup/evaluators/`. Each file contains attack patterns and evaluation criteria that both the skills workflow and the CLI use.

**Add attack patterns** — more attack variations improve coverage. Each pattern is a template the LLM adapts to the specific target.

**Improve evaluation criteria** — sharper PASS/FAIL criteria reduce false positives and false negatives.

**Add target adapters** — support new target types by creating adapters in `skills/astra-setup/targets/`.

**Test with different agents** — report how the skills perform across Claude Code, Cursor, Windsurf, and other runtimes.

See [Agents.md](Agents.md) for detailed contributor documentation.

## License

Apache 2.0
