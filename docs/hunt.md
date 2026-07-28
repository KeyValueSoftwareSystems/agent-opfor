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

| Option                       | Description                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--endpoint <url>`           | Target HTTP endpoint (required unless a local-script target is given via `--target-config`)                 |
| `--objective <text>`         | Attack objective                                                                                            |
| `--objective-file <path>`    | Read objective from file                                                                                    |
| `--target-key-env <var>`     | Env var with target API key                                                                                 |
| `--target-key <key>`         | Target API key directly                                                                                     |
| `--name <name>`              | Display name for target                                                                                     |
| `--target-model <id>`        | Model value in requests                                                                                     |
| `--stateless` / `--stateful` | History handling mode                                                                                       |
| `--session-field <name>`     | Body field for the session id (client-owned, stateful)                                                      |
| `--target-config <path>`     | JSON file with a run-style `target` block; enables server-owned & header sessions, and local-script targets |

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

### Local-script targets

For targets that can't be modeled as a simple HTTP request/response — async/polling APIs, session ids
embedded in a URL path segment, or auth flows needing custom logic — point `opfor hunt` at a local
script adapter instead of an endpoint, using the same `type: "local-script"` shape and stdin/stdout
contract as `opfor run` (see [Local target scripts](cli.md#local-target-scripts-js--py---agent-mode)).

```jsonc
// target.json
{
  "target": {
    "kind": "agent",
    "type": "local-script",
    "scriptPath": "./opfor-local-target.js",
  },
}
```

```bash
opfor hunt --target-config target.json --objective "Probe for jailbreaks and safety bypasses."
```

There is no `--endpoint`, `--script-path`, or similar CLI flag for this — local-script targets are only
configured via `--target-config`. `--name` still works to override the display name (defaults to the
script's basename otherwise).

Hunt's per-thread `threadId` is passed to the script as `sessionId`, so each forked attack thread gets
an isolated session automatically — no extra wiring needed. The script has 240 seconds per turn to
respond before it's killed.

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

Each run writes everything into one folder — `hunt-report-<timestamp>-<target>-<id>/` — containing the live log (`hunt-live.log`), the structured event trail (`run-events.jsonl`), and the final `*-report.html` / `*-report.json`.

## Trace-aware hunting (optional)

If your target is wired to an observability backend (Netra or Langfuse), hunt can use its production traces — the same `telemetry` config `opfor run` uses (see **[Trace-aware testing](telemetry.md)** for the full field reference). This is strictly opt-in; the zero-config quick-start is unchanged. It unlocks **three independent capabilities**, gated separately on what your config provides:

- **Grounded attack planning** (needs `provider` + trace access) — hunt curates real historic traces into a summary the commander plans against, so attacks target the agent's actual tools, data, and flows instead of generic guesses. This is the primary value and works on **any** instrumented backend.
- **Silent-leak detection** (needs a `propagation` block) — hunt mints a trace id per attack thread, propagates it to the target on every turn, and gives operators a `get_trace` tool to inspect the recorded tool calls / retrieval behind a reply. This catches data that leaks into a tool call or an unauthorized record fetched but rendered as a clean answer — invisible in the reply alone.
- **Finding enrichment** (needs `propagation` + `enrichJudgeFromTrace`) — confirmed findings carry the recorded trace excerpt in the report, and the independent verifier judges against it too.

> **Propagation and enrichment only work if the target cooperates.** They depend on the target reading the trace id you inject (`x-trace-id` header or a body field) and exporting its telemetry under _that_ id to the backend hunt queries. Many agents mint their own server-side trace id and ignore an inbound one. To avoid a false sense of coverage, hunt runs a **preflight round-trip check** during recon: it sends one benign probe with a trace id, then tries to read that trace back. The result is reported as `trace round-trip: OK` or `NOT DETECTED`. On `NOT DETECTED`, hunt **continues** (the miss may be ingestion lag) but warns you, records it in the report, and tells operators that an empty `get_trace` is **not** evidence the target is clean. Grounded planning is unaffected either way.

Point hunt at a telemetry config in either of two ways:

```bash
# Dedicated file (bare `telemetry` block, or a { "telemetry": … } wrapper)
opfor hunt --endpoint https://your-target.com/chat --objective "…" --telemetry-config telemetry.json

# Or reuse an existing `opfor run` config — hunt reads its `telemetry` sibling block
opfor hunt --target-config opfor.config.json --objective "…"
```

| Option                      | Description                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `--telemetry-config <path>` | JSON file with a run-style `telemetry` block. Overrides a `telemetry` block in `--target-config`. |

```jsonc
// telemetry.json
{
  "provider": "netra",
  "netra": { "baseUrl": "http://localhost:3000", "traceSelection": { "lookbackHours": 24 } },
  "propagation": { "headers": { "x-trace-id": "{{traceId}}" }, "traceIdStrategy": "per-attack" },
  "enrichJudgeFromTrace": true,
}
```

> **Grounded planning needs an Anthropic API key.** The curator/summarizer LLM runs via `ANTHROPIC_API_KEY` (or a gateway: `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`). On a subscription/OAuth login only, hunt still runs and still propagates + enriches findings — it just skips grounded planning with a one-line notice. Trace propagation and finding enrichment use the telemetry backend's own credentials (`NETRA_API_KEY` / Langfuse keys), not the brain key.

## Stopping a run

Press **Ctrl+C** once to stop early: the agent is interrupted, and a report is still written from the findings gathered so far (with the live log and event trail already on disk). The report is marked as truncated so it's clear the assessment was cut short. Press **Ctrl+C** a second time to force-quit without writing a report.

The same applies if a run errors out mid-flight (provider block, network failure) — findings captured up to that point are preserved in a partial report rather than lost.

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
