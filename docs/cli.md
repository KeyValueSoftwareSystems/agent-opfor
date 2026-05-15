# Opfor — CLI

The CLI handles everything: interactive setup, attack generation, firing attacks, judging responses, and producing reports.

---

## Two testing modes

The CLI supports two distinct red-team modes. Pick one per config; opfor decides which pipeline to run from the config's `mode` field.

| Mode                        | Target                                                | How attacks are delivered                                                                                                                  | How responses are judged                                                                                                                       |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent** (`mode: "agent"`) | HTTP endpoint or local script speaking LLM-style chat | Attacker LLM writes free-text adversarial prompts; opfor POSTs them                                                                        | Judge LLM reads the target's text reply                                                                                                        |
| **MCP** (`mode: "mcp"`)     | MCP server (stdio process or remote URL)              | Opfor connects to the server, lists tools, attacker LLM crafts tool-name + JSON arguments; opfor fires real `tools/call` JSON-RPC requests | Judge LLM reads the JSON-RPC response (content + `isError`); plus optional resource-exposure scan and post-run tool-description rug-pull check |

Pick agent mode for chatbots, RAG apps, and tool-calling agents fronted by an HTTP API. Pick MCP mode when you want to attack an MCP server directly without going through an agent.

> Not to be confused with [running Opfor itself as an MCP server](mcp.md) so AI coding assistants can invoke it.

---

## How the pieces fit together

Three commands. **Only `execute` is required.** `setup` and `generate` exist to freeze intermediate artifacts on disk so you can inspect, version-control, or replay them.

**The three commands and their artifacts:**

| Command                              | Input                                                          | Output artifact                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`opfor setup`**                    | Interactive prompts (or `--empty` / `--agent` / `--mcp` flags) | **Config JSON** at `.opfor/configs/opfor-config-<timestamp>-<id>.json` — target metadata, attacker/judge LLM, selection, telemetry. _No LLM called yet._                    |
| **`opfor generate --config <file>`** | Config JSON                                                    | **Attacks JSON** at `.opfor/attacks/opfor-attacks-<timestamp>-<configId>.json` — config + frozen first-turn attack prompts (one per evaluator). _Attacker LLM called once._ |
| **`opfor execute`**                  | See next table                                                 | **Reports** at `.opfor/reports/report-<timestamp>/` — `report.html` + `report.json`.                                                                                        |

**`opfor execute` accepts three input modes:**

| Invocation                       | What it does                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `opfor execute --attacks <file>` | Replays a frozen Attacks JSON. Skips setup + generate. **Fastest path; no attacker LLM for turn 1.** |
| `opfor execute --config <file>`  | Reads a Config JSON, runs generate on the fly, then executes. Skips setup.                           |
| `opfor execute` _(no args)_      | Runs `setup` wizard → `generate` → executes. Full pipeline in one command.                           |

In every case `execute` fires attacks at the target, runs the judge, and writes the report. The flags just decide which prior steps it has to run itself.

**Typical paths:**

1. **Zero-friction first run:** `opfor execute` → wizard + generate + execute end to end.
2. **Repeated single-turn runs (save cost):** `opfor setup` → `opfor generate --config ...` → `opfor execute --attacks ...` then re-run `opfor execute --attacks ...` whenever you want, attacker LLM not called again.
3. **CI / config-first:** hand-edit `opfor setup --agent --empty` output → `opfor execute --config ...` (or split into `generate` + `execute --attacks` if you want to review attacks before firing them).

---

## Requirements

- Node.js 18+
- API key for any supported LLM provider (OpenAI, Anthropic, Groq, Google, or any OpenAI-compatible endpoint)

---

## Install

```bash
npm install -g opfor
```

**From source:**

```bash
git clone https://github.com/KeyValueSoftwareSystems/opfor.git
cd opfor
npm install --ignore-scripts
npm run build
npm install -g ./cli
```

---

## Step 1 — Create a config

**Interactive wizard (recommended):**

```bash
opfor setup          # prompts: MCP or agent, provider, target, suite
opfor setup --agent  # skip mode prompt, go straight to agent wizard
opfor setup --mcp    # skip mode prompt, go straight to MCP wizard
```

**Blank config to hand-edit:**

```bash
opfor setup --agent --empty   # writes a minimal agent config, no prompts
opfor setup --mcp --empty     # writes a minimal MCP config, no prompts
```

**Minimal agent config:**

```json
{
  "configId": "my-config",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "mode": "agent",
  "agent": {
    "attackLlm": {
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "apiKeyEnv": "GROQ_API_KEY"
    },
    "target": {
      "name": "My Support Bot",
      "description": "A customer support chatbot with access to booking data and PII. Can issue partial refunds.",
      "type": "http-endpoint",
      "endpoint": "http://localhost:4000/chat",
      "requestFormat": "openai",
      "targetModel": "gpt-4o-mini"
    },
    "selection": {
      "mode": "suite",
      "suite": "owasp-llm-top10"
    },
    "turnMode": "single",
    "telemetry": { "provider": "none" }
  }
}
```

> `apiKeyEnv` is the **env var name** that holds the key — not the key itself. Never put the raw key in the config file.

**Minimal MCP config (stdio transport):**

```json
{
  "configId": "my-mcp-config",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "mode": "mcp",
  "mcp": {
    "server": {
      "transport": "stdio",
      "command": "node",
      "args": ["dist/index.js"]
    },
    "generatorModel": {
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "apiKeyEnv": "GROQ_API_KEY"
    },
    "turnMode": "single"
  }
}
```

For a remote MCP server, swap `server` to `{ "transport": "url", "url": "https://...", "headers": { "Authorization": "Bearer ..." } }`.

---

## Step 2 — API key

The LLM key is used during `generate` (attack generation) and `execute` (judging). Set it before running either.

**Environment variable / `.env` file (recommended):**

```bash
export GROQ_API_KEY=your-key-here
export OPENAI_API_KEY=your-key-here
export ANTHROPIC_API_KEY=your-key-here
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

The CLI loads `.env` from the current working directory automatically. Add `.env` to `.gitignore`.

**`--env` flag (for CI or non-standard paths):**

```bash
opfor generate --config .opfor/configs/opfor-config-....json --env .env.prod
opfor execute --attacks .opfor/attacks/opfor-attacks-....json --env .env.prod
```

> Add `.opfor/` to `.gitignore` — it contains configs, attacks, and reports with embedded target metadata.

---

## Step 3 — Generate attack prompts (optional)

`generate` calls the attacker LLM and writes a self-contained attacks JSON that `execute` can replay later. You can skip this step entirely — `opfor execute --config <file>` does it on the fly.

```bash
# Freeze attacks for later replay
opfor generate --config .opfor/configs/opfor-config-<timestamp>-<id>.json

# Override suite or pick specific evaluators at generate time
opfor generate --config ... --suite owasp-agentic-ai
opfor generate --config ... --evaluators prompt-injection sensitive-disclosure
```

Writes `.opfor/attacks/opfor-attacks-<timestamp>-<configId>.json` — contains one frozen first-turn prompt per evaluator, plus the full target/judge config copied from the config file.

**When freezing pays off:**

- **Single-turn scans** — attacker LLM is called once during `generate` and never again. Re-running `opfor execute --attacks ...` does only target requests + judging. Big savings on re-runs.
- **CI** — reviewable, version-controlled attack set; build fails on the _same_ attacks each run.
- **Audit** — the exact prompts that hit your target are pinned on disk.

**When freezing doesn't help much:**

- **Multi-turn scans** — only turn 1 is frozen. Turns 2-N are still generated live by the attacker LLM during `execute`, so most of the attacker-LLM cost remains.
- **One-off runs** — just use `opfor execute --config <file>` or `opfor execute` with no args.

---

## Step 4 — Run the scan

```bash
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<id>.json

# Custom report directory
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<id>.json --out-dir ./reports

# Force attacks through a local script (overrides what's in the attacks file)
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<id>.json --target-script ./opfor-local-target.js
```

Reports land in `.opfor/reports/report-<timestamp>/` as `report.html` and `report.json`.

**MCP mode adds two phases not present in agent mode:**

- **Resource scan** — before firing attacks, opfor calls `resources/list` and `resources/read` on each one, judging for secret/PII exposure. Disable with `mcp.scanResources: false`.
- **Rug-pull check** — after firing attacks, opfor re-lists tools and diffs descriptions against the initial digest, flagging any mutations as a `tool-description-injection` failure.

---

## Local target scripts (`.js` / `.py`) — agent mode

When your agent-mode target is not a single HTTP URL, use a local script as an adapter (`target.type: "local-script"`).

**stdin/stdout contract (one attack = one process):**

| Stream     | Content                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| **Stdin**  | `{"prompt":"...","context":{...},"sessionId":"..."}`. `sessionId` present for multi-turn; omitted for single-turn. |
| **Stdout** | `{"response":"..."}` on success, or `{"error":"..."}` on failure. Do not print debug lines to stdout.              |
| **Stderr** | Log freely — the CLI forwards stderr to your terminal.                                                             |

**Interpreter:** picked from file extension — `.py` / `.pyw` → `python3`, `.js` / `.mjs` / `.cjs` → `node`.

**Wire in config:**

```json
"target": {
  "name": "My stack (via adapter)",
  "description": "What the system does, data it touches, and policies.",
  "type": "local-script",
  "scriptPath": "./opfor-local-target.js"
}
```

**Sanity-check without a full scan:**

```bash
echo '{"prompt":"hello","context":{}}' | node ./opfor-local-target.js
echo '{"prompt":"hello","context":{}}' | python3 ./opfor-local-target.py
```

---

## Single-turn vs multi-turn

By default opfor executes **single-turn** attacks: one attack → one response → judged.

**Multi-turn** fires a short adversarial conversation. After each response, if the judge holds the target as PASS, an attacker LLM generates a more escalating follow-up (up to `turns`, default 3). Stops early when judge returns FAIL.

**Agent mode:** multi-turn requires your target to maintain its own conversation history across requests using a `sessionId`. Opfor injects it but does not replay history itself.

```json
{
  "turnMode": "multi",
  "turns": 3,
  "target": {
    "sessionIdField": "session_id"
  }
}
```

- **HTTP targets:** set `target.sessionIdField` so opfor injects the ID into the request body.
- **Local-script targets:** `sessionId` is always included in the stdin JSON.

**MCP mode:** multi-turn is fully adaptive. Opfor feeds the previous `tools/call` response and judge reasoning back to the attacker LLM, which crafts the next tool name + arguments. No session-ID wiring needed — opfor manages the loop. Set `mcp.turnMode: "multi"` and `mcp.turns` (2–10).

---

## Trace-aware testing (agent mode only)

> Applies only to `mode: "agent"` configs. MCP red-teaming uses JSON-RPC, which can't propagate OTel trace IDs through `tools/call` requests yet.

Plugging in a telemetry provider (Langfuse or Netra) unlocks two capabilities:

1. **Smarter attack generation** — opfor fetches real production traces and uses them to ground prompts in actual user language, flows, and data patterns. Generic attacks become targeted ones.
2. **Trace-enriched judging** — opfor injects a trace ID into each attack request, then fetches the recorded trace after execution and passes every tool call, retrieval step, and intermediate reasoning span to the LLM judge — not just the final response. This catches PII leaking into a tool call but never reaching the user, scope escalations that don't change the response text, and agents that retrieve unauthorized data but render a clean reply.

### Langfuse

```json
"telemetry": {
  "provider": "langfuse",
  "langfuse": {
    "baseUrl": "https://cloud.langfuse.com",
    "traceSelection": { "lookbackHours": 24 }
  },
  "propagation": {
    "traceIdBodyField": "trace_id"
  },
  "enrichJudgeFromTrace": true
}
```

Set credentials in the environment (never in the config file):

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
```

For custom env var names use `langfuse.publicKeyEnv` / `langfuse.secretKeyEnv` in the config.

### Netra

```json
"telemetry": {
  "provider": "netra",
  "netra": {
    "baseUrl": "http://localhost:3000",
    "traceSelection": { "lookbackHours": 24 }
  },
  "propagation": {
    "traceIdBodyField": "trace_id",
    "traceIdStrategy": "per-attack"
  },
  "enrichJudgeFromTrace": true
}
```

```bash
export NETRA_API_KEY=NE_...
```

`propagation.traceIdBodyField` must match the field your agent reads from the request body and forwards to the Netra SDK as the active OTel trace ID. Without that wiring, judge enrichment won't correlate correctly.

**Propagation via headers** (alternative to body field):

```json
"propagation": {
  "headers": { "X-Trace-Id": "{{traceId}}" }
}
```

---

## CI/CD integration

```yaml
# .github/workflows/opfor.yml
- name: Generate attack prompts
  run: opfor generate --config opfor.config.json

- name: Run scan
  run: opfor execute --attacks .opfor/attacks/opfor-attacks-*.json
```

---

## Commands reference

| Command                                                 | Description                                      |
| ------------------------------------------------------- | ------------------------------------------------ |
| `opfor setup`                                           | Interactive wizard — write a timestamped config  |
| `opfor setup --agent` / `--mcp`                         | Skip mode prompt                                 |
| `opfor setup --empty`                                   | Write a blank config without wizard prompts      |
| `opfor generate --config <file>`                        | Generate attacks from a config (non-interactive) |
| `opfor generate --config <file> --suite <id>`           | Override suite at generate time                  |
| `opfor generate --config <file> --evaluators <ids...>`  | Run specific evaluators only                     |
| `opfor execute --attacks <file>`                        | Fire attacks and generate HTML + JSON report     |
| `opfor execute --config <file>`                         | Generate + execute in one step                   |
| `opfor execute --attacks <file> --target-script <path>` | Run attacks via a local `.js`/`.py` adapter      |
| `opfor execute --attacks <file> --out-dir <path>`       | Custom report directory                          |

---

## Config fields reference

Top-level keys are `configId`, `createdAt`, `mode` (`agent` or `mcp`), and one of the two mode-specific blocks below.

### Agent mode fields (`agent.*`)

| Field                                          | Required           | Description                                                                                    |
| ---------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `agent.attackLlm.provider`                     | No                 | `groq`, `openai`, `anthropic`, `google`, or `other`. Defaults to `groq`.                       |
| `agent.attackLlm.model`                        | No                 | Model name. Defaults to provider's recommended model.                                          |
| `agent.attackLlm.apiKeyEnv`                    | No                 | Env var **name** holding the API key (e.g. `"GROQ_API_KEY"`).                                  |
| `agent.attackLlm.baseURL`                      | Only for `other`   | Base URL for OpenAI-compatible endpoints.                                                      |
| `agent.judgeLlm.*`                             | No                 | Same fields as `attackLlm`. Separate model for judging. Falls back to `attackLlm` when absent. |
| `agent.target.name`                            | Yes                | Human-readable name for the target.                                                            |
| `agent.target.description`                     | No                 | What it does, data it handles, restrictions. More detail = better attacks.                     |
| `agent.target.type`                            | Yes                | `http-endpoint` or `local-script`.                                                             |
| `agent.target.scriptPath`                      | For `local-script` | Path to the adapter script, relative to cwd.                                                   |
| `agent.target.endpoint`                        | For HTTP           | Full URL to POST attacks to.                                                                   |
| `agent.target.requestFormat`                   | For HTTP           | `openai`, `json`, or `auto` (default).                                                         |
| `agent.target.targetModel`                     | For HTTP / openai  | Model name to send in the request body.                                                        |
| `agent.target.targetApiKey`                    | No                 | Bearer token for the target endpoint.                                                          |
| `agent.target.promptPath`                      | No                 | Dot-path for the prompt field (e.g. `input.message`). Defaults to `prompt`.                    |
| `agent.target.responsePath`                    | No                 | Dot-path to extract the reply (e.g. `data.reply`). Falls back to built-in chain.               |
| `agent.target.sessionIdField`                  | No                 | Body field to inject a session ID for multi-turn attacks.                                      |
| `agent.selection.mode`                         | Yes                | `suite` or `evaluators`.                                                                       |
| `agent.selection.suite`                        | For suite          | Suite ID — see [evaluators reference](evaluators.md).                                          |
| `agent.selection.evaluators`                   | For evaluators     | Array of evaluator IDs.                                                                        |
| `agent.turnMode`                               | No                 | `single` (default) or `multi`.                                                                 |
| `agent.turns`                                  | No                 | Number of turns per attack when `turnMode` is `multi`. Defaults to `3`.                        |
| `agent.telemetry.provider`                     | No                 | `langfuse`, `netra`, or `none` (default).                                                      |
| `agent.telemetry.enrichJudgeFromTrace`         | No                 | Fetch the recorded trace after each attack and pass spans to the LLM judge. Default `false`.   |
| `agent.telemetry.propagation.traceIdBodyField` | No                 | Request body field to inject a trace ID (e.g. `trace_id`).                                     |
| `agent.telemetry.propagation.headers`          | No                 | HTTP headers to set on each target request. Values support `{{traceId}}`, `{{runId}}`.         |
| `agent.telemetry.propagation.traceIdStrategy`  | No                 | `per-attack` (default) or `per-run`.                                                           |

### MCP mode fields (`mcp.*`)

| Field                          | Required         | Description                                                                                   |
| ------------------------------ | ---------------- | --------------------------------------------------------------------------------------------- |
| `mcp.server.transport`         | Yes              | `stdio` (local process) or `url` (remote endpoint).                                           |
| `mcp.server.command`           | For stdio        | Executable to run (e.g. `node`).                                                              |
| `mcp.server.args`              | For stdio        | Array of CLI args (e.g. `["dist/index.js"]`).                                                 |
| `mcp.server.cwd`               | No               | Working directory for the spawned process.                                                    |
| `mcp.server.env`               | No               | Environment variables passed to the server process.                                           |
| `mcp.server.url`               | For url          | Full HTTP/SSE/WS endpoint URL.                                                                |
| `mcp.server.headers`           | No               | HTTP headers (e.g. `{"Authorization":"Bearer ..."}`).                                         |
| `mcp.generatorModel.provider`  | Yes              | Attacker LLM provider. Same values as agent's `attackLlm.provider`.                           |
| `mcp.generatorModel.model`     | Yes              | Attacker LLM model name.                                                                      |
| `mcp.generatorModel.apiKeyEnv` | No               | Env var name holding the API key.                                                             |
| `mcp.generatorModel.baseURL`   | Only for `other` | Base URL for OpenAI-compatible endpoints.                                                     |
| `mcp.judgeModel.*`             | No               | Same fields as `generatorModel`. Falls back to `generatorModel` when absent.                  |
| `mcp.suite`                    | No               | Suite ID; default `owasp-mcp-top10`. Ignored if `evaluators` is set.                          |
| `mcp.evaluators`               | No               | Explicit array of evaluator IDs (highest priority).                                           |
| `mcp.turnMode`                 | No               | `single` (default) or `multi` (attacker adapts using judge feedback).                         |
| `mcp.turns`                    | No               | Number of adaptive turns when `turnMode` is `multi` (2–10, default 3).                        |
| `mcp.scanResources`            | No               | Enumerate + read resources before attacks. Default `true`.                                    |
| `mcp.attackerInstructions`     | No               | Free-form notes the attacker LLM uses to ground attacks (real IDs, tenant info, focus areas). |
| `mcp.notes`                    | No               | Free-form comment on the config.                                                              |

---

## Supported LLM providers

| Provider    | Env var                        | Default model                  |
| ----------- | ------------------------------ | ------------------------------ |
| `groq`      | `GROQ_API_KEY`                 | `llama-3.3-70b-versatile`      |
| `openai`    | `OPENAI_API_KEY`               | `gpt-4o-mini`                  |
| `anthropic` | `ANTHROPIC_API_KEY`            | `claude-3-5-haiku-20241022`    |
| `google`    | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash`             |
| `other`     | `OPFOR_API_KEY`                | (requires `attackLlm.baseURL`) |

---

## Target endpoint formats — agent mode

Applies to `agent.target.requestFormat` for HTTP targets.

**`openai`** — OpenAI messages format:

```json
POST /chat
{ "model": "gpt-4o-mini", "messages": [{ "role": "user", "content": "attack prompt" }] }
```

Response extracted from `choices[0].message.content`.

**`json`** — Generic JSON. Sends `{ "prompt": "..." }` by default, reads from `.response`:

```json
POST /chat
{ "prompt": "attack prompt" }
```

Customise with `promptPath` and `responsePath`:

```json
"target": {
  "requestFormat": "json",
  "promptPath": "input.message",
  "responsePath": "output.text"
}
```

**`auto`** (default) — tries `openai` first; falls back to `json` on non-2xx.
