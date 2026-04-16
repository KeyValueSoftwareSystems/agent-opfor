# astra

Red team AI systems using your coding agent. No SDK. No code. Just skills.

`astra` is an open-source skill package that teaches your AI coding agent how to security test LLMs, chatbots, RAG pipelines, and AI agents. Install the skills, describe your target, and let the agent handle the rest.

```
npx skills add astra
```

## How it works

Traditional red teaming tools make you write Python scripts, configure YAML/JSON files, and learn a framework. `astra` takes a different approach — it encodes red teaming **knowledge** as structured markdown skill files that any AI coding agent can read and execute.

```
You:    "Red team my customer support chatbot at api.example.com/chat"
Agent:  reads skills → asks clarifying questions → selects framework
        → generates attacks → tests your system → reports vulnerabilities
```

Works with Claude Code, Cursor, Windsurf, and any agent that supports skills.

## Quick start

**1. Install the skills**

### From GitHub (works now, no npm required)
```bash
npx skills add https://github.com/yourusername/astra
```

### From npm (stable releases, when published)
```bash
npx skills add astra
```

### Manual (clone and use locally)
```bash
git clone https://github.com/yourusername/astra.git
cd astra
# Then tell your agent: "Configure a red team target"
```

**2. Configure a target**

Two slash commands are now available in your agent:

```
/red-team-config
```

The agent will guide you through:
- **Target Information** — name, type, endpoint, model
- **Application Context** — what it does, user types, sensitive data, dangerous actions, forbidden topics
- **System Prompt** — the actual instructions the agent runs under (if available)
- **Test Configuration** — which evaluators/suites to run and depth level
- **Notes** — additional context and concerns

Result: `.astra/configs/my-target.md` (auto-created with all your answers)

### Manual Setup (Advanced)

Alternatively, copy the template and edit manually:

```bash
cp astra.config.md.example .astra/configs/my-target.md
# Edit with your text editor
```

See [astra.config.md.example](astra.config.md.example) for the full template.

**3. Run the assessment**

```
/red-team-run
```

Or use the CLI:

```bash
npx astra run --config .astra/configs/my-target.md
```

The agent will:
1. Load your configuration
2. Select evaluators (from suite or custom list)
3. Generate targeted attacks using Application Context
4. Test your system and capture responses
5. Evaluate each test (PASS/FAIL) with evidence
6. Generate a report with findings and recommendations

## What it tests

The skill includes **evaluators** for major AI/LLM vulnerability categories and agentic AI systems. Each evaluator is a standalone skill with built-in attack patterns.

### LLM Vulnerabilities (OWASP LLM Top 10)

| Evaluator | Severity | OWASP | Status |
| --- | --- | --- | --- |
| Prompt Injection | Critical | LLM01 | ✅ Available |
| Sensitive Information Disclosure | Critical | LLM02 | ✅ Available |
| Supply Chain Vulnerabilities | High | LLM03 | ✅ Available |
| Data and Model Poisoning | High | LLM04 | ✅ Available |
| Improper Output Handling | High | LLM05 | ✅ Available |
| Excessive Agency | High | LLM06 | ✅ Available |
| System Prompt Leakage | Critical | LLM07 | ✅ Available |
| Vector and Embedding Weaknesses | High | LLM08 | ✅ Available |
| Misinformation | High | LLM09 | ✅ Available |
| Unbounded Consumption | High | LLM10 | ✅ Available |

### Agentic AI Vulnerabilities (OWASP Agentic AI)

| Evaluator | Severity | OWASP | Status |
| --- | --- | --- | --- |
| Agent Goal Hijacking | Critical | ASI01 | ✅ Available |
| Tool Misuse and Exploitation | Critical | ASI02 | ✅ Available |
| Identity and Privilege Abuse | Critical | ASI03 | ✅ Available |
| Agentic Supply Chain Vulnerabilities | High | ASI04 | ✅ Available |
| Unexpected Code Execution | Critical | ASI05 | ✅ Available |
| Memory and Context Poisoning | High | ASI06 | ✅ Available |
| Insecure Inter-Agent Communication | High | ASI07 | ✅ Available |
| Cascading Failures | High | ASI08 | ✅ Available |
| Human-Agent Trust Exploitation | High | ASI09 | ✅ Available |
| Rogue Agents | Critical | ASI10 | ✅ Available |

Each evaluator includes multiple attack patterns at different difficulty levels (basic, intermediate, advanced).

## Suites

Compose evaluators into standard suites:

### For LLM Applications
- **OWASP LLM Top 10** (2025) — the industry standard for LLM application security

### For Agentic AI Systems
- **OWASP Agentic AI Top 10** (2024) — security framework for agents, tool-using models, and autonomous workflows

### Future Suites
- **MITRE ATLAS** — adversarial threat landscape for AI systems
- **EU AI Act** — compliance testing for high-risk AI systems (Article 9)

Or run a custom selection of specific evaluators.

## Target types

Works against any AI system you can send text to:

- **Chatbots** — customer support, internal tools, consumer products
- **RAG pipelines** — retrieval-augmented generation systems
- **AI Agents** — tool-using agents with MCP, function calling, or plugin access
- **API endpoints** — any LLM-powered API
- **Raw LLMs** — test the model itself via provider APIs

## Application Context

The more context you provide, the more effective the attacks. When configuring a target, you describe:

- **What it does** — Purpose and scope
- **Who uses it** — User types and access levels
- **Sensitive data it handles** — PII, financial, medical, etc.
- **Dangerous actions it can perform** — High-risk operations
- **Topics it should never discuss** — Forbidden subjects

Evaluators use this context to craft **white-box attacks** that specifically target:
- The guardrails defined in the system prompt
- The scope boundaries you define
- The sensitive data and operations you identify
- The topics it should refuse

This makes attacks much more realistic and targeted than generic black-box tests.

## CLI & CI/CD

Use the CLI runner with support for multiple LLM providers:

```bash
# Claude Code (default)
npx astra run --config astra.config.md --provider claude

# Custom suite
npx astra run --config astra.config.md --suite owasp-llm-top10 --provider claude

# Specific evaluators
npx astra run --config astra.config.md --evaluators jailbreaking,prompt-injection

# Fail on severity
npx astra run --config astra.config.md --fail-on critical
```

Use in GitHub Actions:

```yaml
# .github/workflows/redteam.yml
- name: Red Team Scan
  run: npx astra run --config astra.config.md --fail-on critical
```

See [runner/cli/README.md](runner/cli/README.md) for all options, examples, and provider support roadmap.

## What makes this different

| | astra | Code-based tools (DeepTeam, PyRIT, Garak) |
| --- | --- | --- |
| **Setup** | Install skills, talk to your agent | Write Python, configure callbacks, set API keys |
| **Runtime** | Your existing AI coding agent | Python/Node.js process |
| **Learning curve** | Describe your target in plain English | Learn the framework's API and config format |
| **Extensibility** | Write a markdown file | Write Python classes |
| **CI/CD** | Config file + headless agent | Config file + CLI runner |

## Project structure

```
astra/
├── astra.config.md.example            ← Config template for users
├── package.json                       ← NPM metadata, bin entry
├── README.md                          ← This file
├── Agents.md                          ← Developer guide
├── LICENSE                            ← Apache 2.0
│
├── .astra/configs/                           ← User-created configs (not packaged)
│   ├── chatbot-prod.md                ← Example: Production support bot
│   ├── rag-pipeline.md                ← Example: RAG system
│   └── README.md                      ← How to create and manage configs
│
├── skills/
│   ├── red-team-config/               ← /red-team-config slash command
│   │   └── SKILL.md                   ← Interactive config wizard
│   │
│   └── red-team-run/                  ← /red-team-run slash command
│       ├── SKILL.md                   ← Assessment orchestrator + executor
│       ├── evaluators/                ← 20 evaluators (OWASP LLM + Agentic AI)
│       ├── suites/                    ← Suite definitions (referenced by red-team-config via ../)
│       └── targets/                   ← Target adapters (referenced by red-team-config via ../)
│
├── runner/                            ← CLI + extension runners
│   ├── cli/
│   │   ├── index.js                   ← Provider-agnostic CLI (Node.js)
│   │   └── README.md                  ← CLI usage & examples
│   └── extension/
│       └── README.md                  ← VS Code extension (planned)
│
└── scripts/                           ← Development helpers (future)
    └── (validate.js, package.sh, etc.)
```

## Architecture Overview

**Evaluator-centric model**:
- Each **evaluator** is a self-contained skill that tests for a specific vulnerability (e.g., jailbreaking, prompt injection)
- Each evaluator has **built-in attack patterns** (basic, intermediate, advanced) and evaluation criteria
- **Suites** compose evaluators into standard test collections (OWASP LLM Top 10, MITRE ATLAS, etc.)
- **Target adapters** handle different target types (HTTP endpoints, custom functions, etc.) — extensible by dropping a file

**Provider-agnostic CLI**:
- Works with any LLM provider (Claude, OpenAI, Ollama, etc.)
- Currently Claude Code is fully supported; others are planned
- Supports `--suite` to run a standard suite or `--evaluators` for custom selection

**Skill design**:
- Top-level skills orchestrate the workflow (config, run)
- Evaluator skills are standalone — can be run individually or composed into suites
- No separate vulnerability/attack/evaluator files — attack patterns are inline in evaluator skills
- No code SDK — everything is markdown that agents read and execute

See [Agents.md](Agents.md) for detailed contributor documentation.

## Testing & Development

### Local Testing with Colleagues

Before publishing to npm, test the skills in development:

```bash
# Colleagues clone your repo
git clone https://github.com/yourusername/astra.git
cd astra

# Option 1: Use skills directly from repo
npx claude -p "Read the skill at ./skills/red-team-config.md"

# Option 2: Symlink skills to Claude Code
mkdir -p ~/.claude/skills
ln -s $(pwd)/skills ~/.claude/skills/astra

# Then in Claude Code, reference the skill:
# "Red team my AI system using the astra skills"
```

### Publishing to npm

When ready for public release:

```bash
# 1. Verify version in package.json
grep '"version"' package.json

# 2. Tag the release
git tag -a v0.2.0 -m "Release v0.2.0"

# 3. Publish to npm
npm publish

# 4. Verify
npm view astra

# Then everyone can install:
# npx skills add astra
```

---

## Contributing

Contributions are welcome. The most impactful ways to help:

**Add a new evaluator skill** — create a markdown file in `skills/evaluators/` with inline attack patterns and execution instructions. See [Agents.md](Agents.md) for the evaluator schema and examples.

**Add attack patterns** — more attack variations improve coverage. Each attack pattern describes a strategy the agent adapts to the target — not copy-paste prompts.

**Improve evaluation criteria** — sharper criteria reduce false positives and false negatives in vulnerability detection.

**Add target adapters** — support new target types by creating adapters in `skills/targets/`. See [Agents.md](Agents.md) for the adapter schema.

**Test with different agents** — report how the skills perform across Claude Code, Cursor, Windsurf, and other agent runtimes.

## License

Apache 2.0
