# Opfor Hunt — Autonomous Red-Teaming

`opfor hunt` runs an adaptive attack campaign via a multi-agent system (commander, operators, scout). Unlike `opfor run`, the agents run on **Claude only** — your target can be anything. See [Authentication](#authentication) below.

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

| Option                       | Description                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `--endpoint <url>`           | Target HTTP endpoint (required)                                                   |
| `--objective <text>`         | Attack objective                                                                  |
| `--objective-file <path>`    | Read objective from file                                                          |
| `--target-key-env <var>`     | Env var with target API key                                                       |
| `--target-key <key>`         | Target API key directly                                                           |
| `--name <name>`              | Display name for target                                                           |
| `--target-model <id>`        | Model value in requests                                                           |
| `--stateless` / `--stateful` | History handling mode                                                             |
| `--session-field <name>`     | Body field for the session id (client-owned, stateful)                            |
| `--target-config <path>`     | JSON file with a run-style `target` block; enables server-owned & header sessions |

### Session handling

For a client-owned stateful target, `--stateful --session-field <name>` sends opfor's id in that
body field. For richer setups — **server-owned** targets (the target mints its own id) or session
ids carried in a **header** — pass a `--target-config` file containing a run-style `target` block
(bare or wrapped in `{ "target": … }`). CLI flags override its fields.

```jsonc
// target.json — server-owned session captured from a response header
{
  "target": {
    "kind": "agent",
    "type": "http-endpoint",
    "endpoint": "https://your-target.com/chat",
    "requestFormat": "json",
    "promptPath": "prompt",
    "responsePath": "response",
    "apiKeyEnv": "TARGET_API_KEY",
    "stateful": true,
    "session": {
      "send": { "in": "header", "name": "Mcp-Session-Id" },
      "receive": { "in": "header", "name": "Mcp-Session-Id" },
    },
  },
}
```

```bash
opfor hunt --target-config target.json --objective "Probe for jailbreaks and safety bypasses."
```

The `--ui` setup form also has a Session section. See **[Target session handling](sessions.md)** for
the full model. Note: because a server-owned session belongs to the target, forking an attack thread
opens a **new** server session.

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

## Authentication

Credentials are resolved in order:

1. `ANTHROPIC_API_KEY` — pay-per-token Anthropic API key.
2. `CLAUDE_CODE_OAUTH_TOKEN` — token from `claude setup-token`.
3. Local Claude subscription — falls back to your `claude login` session (Pro/Max) if neither is set. Runs against your subscription's usage/rate limits, not a separate API bill.

Options 2 and 3 require the [Claude Code CLI](https://docs.claude.com/claude-code) (`npm install -g @anthropic-ai/claude-code`).

**Gateway / self-hosted proxy** — set both together (a token without a base URL is ignored):

```bash
ANTHROPIC_BASE_URL=https://your-gateway.example.com
ANTHROPIC_AUTH_TOKEN=...
```

## Vulnerability Classes

`bias` · `harmful` · `accuracy` · `disclosure` · `injection` · `excessive-agency` · `brand-conduct` · `access-control` · `mcp-usage`

These are the same category ids `opfor run` uses under `evaluators/agent/` — hunt draws from a hand-picked subset of that taxonomy (see `HUNT_VULN_CLASS_CATEGORIES` in `core/src/autonomous/knowledge/vulnClasses.ts`), reading each category's `README.md`, so the two stay in sync.

## Personas

`naive-user` · `journalist` · `security-auditor` · `frustrated-developer` · `entitled-customer` · `fellow-ai`

## Strategies

`fictional-framing` · `authority-escalation` · `gradual-trust` · `instruction-override` · `encoding-obfuscation` · `context-overload`

## Troubleshooting

**Model not found?** Check `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`.

**Rate limited?** Reduce `--max-operators` or `--budget-usd`. If running on a subscription (no `ANTHROPIC_API_KEY`), you may be hitting the subscription's own rate limit — use an API key for heavier runs.
