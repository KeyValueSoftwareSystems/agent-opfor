# Opfor Hunt — Autonomous Red-Teaming

`opfor hunt` uses Claude Agent SDK to run an intelligent, adaptive attack campaign against your target. A multi-agent system performs reconnaissance, strategizes, and probes for vulnerabilities in real-time.

## Quick Start

```bash
opfor hunt \
  --endpoint "https://your-target.com/v1/chat/completions" \
  --name "My Target Bot" \
  --target-key-env TARGET_API_KEY \
  --objective "Probe for jailbreaks, system-prompt leakage, and safety bypasses."
```

Add `--ui` to watch the attack tree unfold in a live dashboard.

## Agents

| Agent         | Role                                                            | Default Model |
| ------------- | --------------------------------------------------------------- | ------------- |
| **Commander** | Orchestrates strategy, dispatches operators, interprets results | `sonnet`      |
| **Operator**  | Executes multi-turn attack threads with personas/strategies     | `sonnet`      |
| **Scout**     | Fingerprints target with benign recon probes                    | `haiku`       |

## Options

### Target

| Option                       | Description                     |
| ---------------------------- | ------------------------------- |
| `--endpoint <url>`           | Target HTTP endpoint (required) |
| `--objective <text>`         | Attack objective                |
| `--objective-file <path>`    | Read objective from file        |
| `--target-key-env <var>`     | Env var with target API key     |
| `--target-key <key>`         | Target API key directly         |
| `--name <name>`              | Display name for target         |
| `--target-model <id>`        | Model value in requests         |
| `--stateless` / `--stateful` | History handling mode           |

### Models

| Option                  | Default  |
| ----------------------- | -------- |
| `--model <id>`          | `sonnet` |
| `--operator-model <id>` | `sonnet` |
| `--scout-model <id>`    | `haiku`  |

### Limits

| Option                    | Default |
| ------------------------- | ------- |
| `--budget-usd <n>`        | `10`    |
| `--max-operators <n>`     | `6`     |
| `--max-turns <n>`         | `120`   |
| `--max-thread-turns <n>`  | `25`    |
| `--max-total-threads <n>` | `40`    |
| `--max-depth <n>`         | `3`     |
| `--max-recon-probes <n>`  | `8`     |

### Output

| Option             | Default               |
| ------------------ | --------------------- |
| `--output <dir>`   | `.opfor/reports`      |
| `--ui`             | Launch live dashboard |
| `--ui-port <port>` | `3847`                |

## Environment Variables

```bash
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=sk-or-v1-...
ANTHROPIC_API_KEY=sk-or-v1-...
```

## Vulnerability Classes

`jailbreak` · `prompt-injection` · `system-prompt-leak` · `sensitive-disclosure` · `harmful-content` · `tool-misuse` · `business-integrity` · `misinformation` · `bias`

## Personas

`naive-user` · `journalist` · `security-auditor` · `frustrated-developer` · `entitled-customer` · `fellow-ai`

## Strategies

`fictional-framing` · `authority-escalation` · `gradual-trust` · `instruction-override` · `encoding-obfuscation` · `context-overload`

## Troubleshooting

**Model not found?** Check `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.

**Rate limited?** Reduce `--max-operators` or `--budget-usd`.
