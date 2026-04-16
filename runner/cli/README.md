# CLI Runner

The `astra` CLI allows you to run red team assessments from the command line or in CI/CD pipelines.

## Installation

```bash
npm install -g astra
# or use npx without installing
npx astra run --help
```

## Usage

### Basic Usage

```bash
npx astra run --config astra.config.md
```

This reads `astra.config.md`, invokes the red team agent with the `red-team-run` skill, and streams results to the terminal. The provider defaults to `claude` (Claude Code).

### Choose a Provider

```bash
# Claude Code (default)
npx astra run --config astra.config.md --provider claude

# OpenAI (planned)
npx astra run --config astra.config.md --provider openai

# Ollama (local LLM, planned)
npx astra run --config astra.config.md --provider ollama
```

The provider determines which agent will execute the red team assessment. Currently, **only Claude Code is fully supported**.

### Run a Specific Suite

Override the config and run a specific suite:

```bash
npx astra run --config astra.config.md --suite owasp-llm-top10
```

### Run Custom Evaluators

Run only specific evaluators instead of a full suite:

```bash
npx astra run --config astra.config.md --evaluators jailbreaking,prompt-injection
```

### With Output File

```bash
npx astra run --config astra.config.md --output astra-report.md
```

Saves the markdown report to `astra-report.md` in addition to the terminal output.

### Fail on Severity (for CI/CD)

```bash
npx astra run --config astra.config.md --fail-on critical
```

Exits with code 1 if any vulnerability with severity >= `critical` is found. Useful for gating deployments:

```bash
npx astra run --config astra.config.md --fail-on high
if [ $? -ne 0 ]; then
  echo "Red team assessment found high-severity vulnerabilities. Blocking deployment."
  exit 1
fi
```

### Combine Options

```bash
npx astra run \
  --config astra.config.md \
  --suite owasp-llm-top10 \
  --provider claude \
  --fail-on critical \
  --output results/report.md
```

## Environment Variables

```bash
# Set default provider
export ASTRA_PROVIDER=claude
npx astra run --config astra.config.md
```

## How It Works

The CLI is a thin wrapper:

1. Parses CLI arguments (config, suite, evaluators, output path, provider, failure criteria)
2. Constructs a prompt that loads the `red-team-run` skill from the skills directory
3. Spawns the specified agent (currently Claude Code) with the prompt
4. Streams the agent's output to your terminal
5. Exits with code 0 (success) or 1 (failure found if `--fail-on` was set)

**All red teaming logic lives in the skill files**, not in the CLI. The CLI just provides a command-line interface to invoke them.

## Requirements

### For Claude Provider
- **Claude Code**: You must have Claude Code installed (`claude` command must be available)
- Install from: https://claude.com/claude-code
- Verify: `claude --version`

### For OpenAI/Ollama Providers
- Coming soon. Currently placeholders in the code.

### General
- **Node.js**: v12 or later
- **Config file**: A `astra.config.md` created by running `red-team-config` skill

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Red Team Assessment

on: [push, pull_request]

jobs:
  red-team:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install -g astra
      - run: npx astra run --config astra.config.md --fail-on critical
```

### Local Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

npx astra run --config astra.config.md --fail-on high
if [ $? -ne 0 ]; then
  echo "Red team assessment found vulnerabilities. Review before committing."
  exit 1
fi
```

### GitLab CI Example

```yaml
red-team:
  stage: test
  script:
    - npm install -g astra
    - npx astra run --config astra.config.md --fail-on critical
```

## Troubleshooting

**Error: "Make sure Claude Code is installed"**
- Install Claude Code: https://claude.com/claude-code
- Verify `claude` command works: `claude --version`

**Error: "Config file not found"**
- Ensure the path to `astra.config.md` is correct
- If using a different config name, pass the full path: `--config ./.astra/configs/my-target.md`

**Error: "Unknown provider"**
- Currently only `claude` is fully supported
- OpenAI and Ollama providers are planned but not yet implemented

**Assessments are slow**
- First-time setup reads all skill files, which takes longer
- Subsequent runs are faster due to caching
- Tests at "thorough" depth take longer than "basic" depth

## Provider Support Roadmap

| Provider | Status | Notes |
|---|---|---|
| Claude Code | ✅ Fully supported | Default, requires Claude Code CLI |
| OpenAI | 🔄 Planned | Use OpenAI API with agent wrapper |
| Ollama | 🔄 Planned | Local LLM support via Ollama API |
| Anthropic API | 🔄 Planned | Direct API calls (alternative to Claude Code CLI) |

Want to add another provider? Contributions welcome! See [Agents.md](../../Agents.md) for the architecture.
