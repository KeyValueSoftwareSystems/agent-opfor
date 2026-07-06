# Opfor — CLI

The CLI handles everything: interactive setup, attack generation, firing attacks, judging responses, and producing reports.

---

## Two testing modes

Pick one per config; opfor decides which pipeline to run from `target.kind`.

| Mode    | Target                                                | How attacks are delivered                                                                              | How responses are judged                                                                                       |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `agent` | HTTP endpoint or local script speaking LLM-style chat | Attacker LLM writes free-text adversarial prompts; opfor POSTs them                                    | Judge LLM reads the target's text reply                                                                        |
| `mcp`   | MCP server (stdio process or remote URL)              | Opfor lists tools, attacker LLM crafts tool name + JSON arguments; opfor fires real `tools/call` calls | Judge LLM reads the JSON-RPC response (content + `isError`); plus optional resource scan + tool-mutation check |

Use agent mode for chatbots, RAG apps, and tool-calling agents fronted by an HTTP API. Use MCP mode when you want to attack an MCP server directly.

> Not to be confused with [running Opfor itself as an MCP server](mcp.md) so AI coding assistants can invoke it.

---

## Install

```bash
npm install -g @keyvaluesystems/agent-opfor-cli
```

**From source (contributors):**

```bash
git clone https://github.com/KeyValueSoftwareSystems/agent-opfor.git
cd opfor
npm install
npm run install:cli   # builds + installs `opfor` globally
```

---

## Quickstart

```bash
opfor run     # wizard + run in one command
```

That's it. With no `--config`, `execute` runs the setup wizard inline, writes the config to `.opfor/configs/`, then immediately runs it.

Prefer to split setup and execution into two steps (e.g. for CI or so you can review the config before firing attacks)?

```bash
opfor setup                        # interactive wizard → writes a config
opfor run --config <path>      # runs attacks + judges → writes report
```

The setup wizard prints the exact `--config` path on its last line.

---

## Step 1 — Create a config

**Interactive wizard (recommended):**

```bash
opfor setup           # prompts: agent vs mcp, provider, target, suite, effort, turns, telemetry
opfor setup --agent   # skip mode prompt, go straight to agent wizard
opfor setup --mcp     # skip mode prompt, go straight to MCP wizard
```

**Blank config to hand-edit:**

```bash
opfor setup --agent --empty   # writes a minimal agent config, no prompts
opfor setup --mcp --empty     # writes a minimal MCP config, no prompts
```

Configs land in `.opfor/configs/opfor-config-<timestamp>-<id>.json` unless you pass `--config <path>` to override.

**Minimal agent config:**

```json
{
  "target": {
    "kind": "agent",
    "name": "My Support Bot",
    "description": "A customer support chatbot with access to booking data and PII. Can issue partial refunds.",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat",
    "requestFormat": "openai"
  },
  "selection": {
    "mode": "suite",
    "suite": "owasp-llm-top10"
  },
  "attackerLlm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "OPENAI_API_KEY"
  },
  "effort": "adaptive",
  "turnMode": "multi",
  "turns": 3
}
```

**Minimal MCP config (stdio transport):**

```json
{
  "target": {
    "kind": "mcp",
    "name": "My MCP Server",
    "transport": "stdio",
    "command": "node",
    "args": ["dist/index.js"]
  },
  "selection": {
    "mode": "suite",
    "suite": "owasp-mcp-top10"
  },
  "attackerLlm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "OPENAI_API_KEY"
  },
  "effort": "adaptive",
  "turnMode": "single",
  "turns": 1
}
```

For a remote MCP server, swap `transport`/`command`/`args` to `{ "transport": "url", "url": "https://...", "urlHeaders": { "Authorization": "Bearer ..." } }`.

> `apiKeyEnv` is the **env var name** holding the key — not the key itself. Never put a raw key in the config file.

---

## Step 2 — API key

The attacker LLM key is used during `execute` (attack generation + judging). Set it before running.

**Environment variable / `.env` file (recommended):**

```bash
export OPENAI_API_KEY=sk-...
export GROQ_API_KEY=gsk_...
export ANTHROPIC_API_KEY=sk-ant-...
```

The CLI loads `.env` from the current working directory automatically. Add `.env` to `.gitignore`.

**`--env` flag for a non-default path:**

```bash
opfor run --config .opfor/configs/opfor-config-....json --env .env.prod
```

Telemetry credentials (Langfuse, Netra) also come from env vars — see [Trace-aware testing](#trace-aware-testing-agent-only).

> Add `.opfor/` to `.gitignore` — it contains configs and reports with embedded target metadata.

---

## Step 3 — Run the scan

```bash
opfor run --config .opfor/configs/opfor-config-<timestamp>-<id>.json

# Override effort or turns at run time
opfor run --config ... --effort comprehensive
opfor run --config ... --turns 5

# Custom report directory
opfor run --config ... --output ./my-reports

# Skip steps 1 + 2 entirely — wizard inline, then execute
opfor run
```

**MCP mode adds two phases not present in agent mode:**

- **Resource scan** — before firing attacks, opfor calls `resources/list` and `resources/read`, judging for secret/PII exposure.
- **Rug-pull check** — after firing attacks, opfor re-lists tools and diffs descriptions against the initial digest, flagging any mutations.

---

## Reports

Each run lands in its own subfolder:

```
.opfor/reports/run-report-<compactTs>-<slug>-<shortId>/
├── <slug>-report.html
└── <slug>-report.json
```

Where `<slug>` is the target name slugified (e.g. `erkala-travel-support-agent`) and `<shortId>` is the first 8 hex chars of the run's report ID. Default parent is `.opfor/reports/`; override with `--output <dir>`.

---

## Effort: adaptive vs comprehensive

| Effort          | What it does                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `adaptive`      | One sustained conversation per evaluator. Attacker LLM picks tactics on the fly using the previous response + judge signal. |
| `comprehensive` | One fresh multi-turn attack per named pattern in each evaluator. Wider coverage, more LLM calls.                            |

---

## Single-turn vs multi-turn

By default opfor runs **single-turn** attacks: one attack → one response → judged.

**Multi-turn** fires a short adversarial conversation. After each response, if the judge still rates the target as PASS, the attacker LLM generates a more escalating follow-up (up to `turns`, default 3). Stops early when the judge returns FAIL.

For HTTP agent targets, you choose how opfor delivers conversation context across turns via `target.stateful`:

| `target.stateful` | When to use                                                                                                                                                           | What opfor sends per turn                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `true` (default)  | Custom agents and chat apps that maintain conversation history themselves (in a DB, in memory, etc.), keyed by a session identifier opfor passes in.                  | Only the current turn's user prompt, plus a per-attack session UUID injected at `target.sessionIdField`. Honours `requestFormat`.         |
| `false`           | Raw LLM endpoints that are stateless by design — OpenAI, Groq, Anthropic via OpenAI-compatible gateway, LiteLLM, vLLM, etc. The endpoint has no concept of a session. | The full `{role, content}` conversation history as a chat-completions `messages` array. Forces OpenAI shape; `sessionIdField` is ignored. |

```json
// Stateful — custom agent that owns its session store
{
  "turnMode": "multi",
  "turns": 3,
  "target": { "stateful": true, "sessionIdField": "session_id" }
}

// Stateless — raw LLM API; opfor replays the whole conversation each turn
{
  "turnMode": "multi",
  "turns": 3,
  "target": { "stateful": false, "model": "gpt-4o-mini" }
}
```

- **Agent (HTTP):** pick `stateful` based on what the endpoint expects. Omitting the field keeps the default of `true`, preserving the historical behaviour.
- **Agent (local-script):** `sessionId` is always included in the stdin JSON — your script holds the history. `stateful` does not apply.
- **MCP:** fully adaptive. Opfor feeds the previous `tools/call` response + judge reasoning back to the attacker LLM, which crafts the next tool call. No session-ID wiring needed.

For stateful targets there is a second choice — whether **opfor mints the session id** (client-owned, the default) or **the target returns its own id** that opfor captures and echoes (server-owned, e.g. MCP `Mcp-Session-Id`, cookie sessions). Configure this with `target.session` (request send: body or header; response receive: body, header, or set-cookie). See **[Target session handling](sessions.md)** for the full model; the legacy `target.sessionIdField` above is shorthand for a client-owned body field.

`turnMode` expresses intent (`single` / `multi`); `turns` caps the count when multi. With `turnMode: "single"`, `turns` is ignored.

---

## Local target scripts (`.js` / `.py`) — agent mode

When the agent target is not a single HTTP URL, use a local script as an adapter (`target.type: "local-script"`).

**stdin/stdout contract (one attack = one process):**

| Stream     | Content                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| **Stdin**  | `{"prompt":"...","context":{...},"sessionId":"..."}`. `sessionId` present for multi-turn; omitted for single-turn. |
| **Stdout** | `{"response":"..."}` on success, or `{"error":"..."}` on failure. Do not print debug lines to stdout.              |
| **Stderr** | Log freely — the CLI forwards stderr to your terminal.                                                             |

**Interpreter:** picked from file extension — `.py` / `.pyw` → `python3`, `.js` / `.mjs` / `.cjs` → `node`.

```json
"target": {
  "kind": "agent",
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

## Trace-aware testing (agent only)

See [telemetry.md](telemetry.md) for Langfuse and Netra setup, config fields, and ingestion-delay notes.

---

## Commands reference

| Command                                       | Description                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `opfor setup`                                 | Interactive wizard — writes a timestamped config                       |
| `opfor setup --agent` / `--mcp`               | Skip mode prompt                                                       |
| `opfor setup --empty`                         | Write a blank config without wizard prompts                            |
| `opfor setup --config <path>`                 | Override the output config path                                        |
| `opfor run`                                   | Run the setup wizard inline, then run the resulting config             |
| `opfor run --config <file>`                   | Read an existing config, fire attacks, judge, write HTML + JSON report |
| `opfor run --config <file> --effort <e>`      | Override `effort` (`adaptive` or `comprehensive`)                      |
| `opfor run --config <file> --turns <n>`       | Override turn count (1 forces single-turn)                             |
| `opfor run --config <file> --output <d>`      | Override report parent directory (default `.opfor/reports/`)           |
| `opfor run --config <file> --env <path>`      | Load env vars from a non-default `.env` path                           |
| `opfor setup --env <path>`                    | Same `--env` flag works on setup                                       |
| `opfor hunt --endpoint <url> --objective <t>` | Autonomous agentic red-team — see [hunt.md](hunt.md)                   |

---

## Config fields reference

### Common fields (both modes)

| Field                   | Required                      | Description                                                                                        |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `target.kind`           | Yes                           | `"agent"` or `"mcp"`.                                                                              |
| `selection.mode`        | Yes                           | `"suite"` or `"evaluators"`.                                                                       |
| `selection.suite`       | For suite                     | Suite ID — see [evaluators reference](evaluators.md).                                              |
| `selection.evaluators`  | For evaluators                | Array of evaluator IDs.                                                                            |
| `attackerLlm.provider`  | Yes                           | See [Supported LLM providers](#supported-llm-providers).                                           |
| `attackerLlm.model`     | Yes                           | Model name (e.g. `gpt-4o-mini`).                                                                   |
| `attackerLlm.apiKeyEnv` | Yes                           | Env var **name** holding the API key.                                                              |
| `attackerLlm.baseURL`   | For openai-compatible / azure | Base URL for the LLM endpoint.                                                                     |
| `judgeLlm.*`            | No                            | Same fields as `attackerLlm`. Separate model for judging. Falls back to `attackerLlm` when absent. |
| `effort`                | Yes                           | `"adaptive"` or `"comprehensive"`.                                                                 |
| `turnMode`              | No                            | `"single"` (default when omitted) or `"multi"`.                                                    |
| `turns`                 | Yes                           | Turns per attack. Ignored when `turnMode` is `"single"`. Range 1–10 (wizard default 3).            |

### Agent fields (`target.kind: "agent"`)

| Field                   | Required           | Description                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target.name`           | Yes                | Human-readable name. Used as the report slug.                                                                                                                                                                                                                                                                                |
| `target.description`    | Yes                | What it does, data it handles, restrictions. More detail = better attacks.                                                                                                                                                                                                                                                   |
| `target.type`           | Yes                | `"http-endpoint"` or `"local-script"`.                                                                                                                                                                                                                                                                                       |
| `target.endpoint`       | For HTTP           | Full URL to POST attacks to.                                                                                                                                                                                                                                                                                                 |
| `target.requestFormat`  | For HTTP           | `"openai"`, `"json"`, or `"auto"` (default). Ignored when `target.stateful` is `false` (stateless mode forces OpenAI shape).                                                                                                                                                                                                 |
| `target.model`          | For HTTP / openai  | Model name to send in the request body.                                                                                                                                                                                                                                                                                      |
| `target.apiKeyEnv`      | No                 | Env var **name** holding the target's API key (e.g. `"TARGET_API_KEY"`). Never put the raw key here.                                                                                                                                                                                                                         |
| `target.headers`        | No                 | Custom HTTP headers (e.g. `{"X-Api-Key": "secret"}`). Merged with built-in headers.                                                                                                                                                                                                                                          |
| `target.promptPath`     | No                 | Dot-path for the prompt field (e.g. `"input.message"`). Defaults to top-level `prompt`.                                                                                                                                                                                                                                      |
| `target.responsePath`   | No                 | Dot-path to extract the reply (e.g. `"data.reply"`). Falls back to built-in chain.                                                                                                                                                                                                                                           |
| `target.sessionIdField` | No                 | Legacy shorthand for `session.send = { in: "body", name: … }` (client-owned, body). Still honored.                                                                                                                                                                                                                           |
| `target.session`        | No                 | Session id handling for stateful targets — `send` (body/header) and, for server-owned targets, `receive` (body/header/set-cookie). See [Target session handling](sessions.md).                                                                                                                                               |
| `target.stateful`       | No                 | `true` (default): send only the current turn's prompt + `sessionIdField`. `false`: send the full chat history as a chat-completions `messages` array each turn (forces OpenAI shape, ignores `requestFormat` and `sessionIdField`) — required for raw LLM APIs. See [Single-turn vs multi-turn](#single-turn-vs-multi-turn). |
| `target.scriptPath`     | For `local-script` | Path to the `.js`/`.py` adapter, relative to cwd.                                                                                                                                                                                                                                                                            |
| `telemetry.*`           | No                 | Trace-aware testing (Langfuse / Netra). See [telemetry.md](telemetry.md).                                                                                                                                                                                                                                                    |

### MCP fields (`target.kind: "mcp"`)

| Field                | Required  | Description                                                               |
| -------------------- | --------- | ------------------------------------------------------------------------- |
| `target.name`        | Yes       | Human-readable name. Used as the report slug.                             |
| `target.description` | No        | Short note on the server; helps attack prompts when provided.             |
| `target.transport`   | Yes       | `"stdio"` (local process) or `"url"` (remote endpoint).                   |
| `target.command`     | For stdio | Executable to run (e.g. `"node"`).                                        |
| `target.args`        | For stdio | Array of CLI args (e.g. `["dist/index.js"]`).                             |
| `target.cwd`         | No        | Working directory for the spawned process (stdio only).                   |
| `target.env`         | No        | Env vars passed to the spawned server. Values support `${VAR}` expansion. |
| `target.url`         | For url   | Full HTTP/SSE endpoint URL.                                               |
| `target.urlHeaders`  | No        | HTTP headers for the URL transport. Values support `${VAR}` expansion.    |

---

## Supported LLM providers

| Provider            | Env var                        | Default model               | Notes                          |
| ------------------- | ------------------------------ | --------------------------- | ------------------------------ |
| `openai`            | `OPENAI_API_KEY`               | `gpt-4o-mini`               |                                |
| `anthropic`         | `ANTHROPIC_API_KEY`            | `claude-3-5-haiku-20241022` |                                |
| `groq`              | `GROQ_API_KEY`                 | `llama-3.3-70b-versatile`   |                                |
| `google`            | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash`          |                                |
| `deepseek`          | `DEEPSEEK_API_KEY`             | `deepseek-chat`             |                                |
| `azure`             | `AZURE_OPENAI_API_KEY`         | `gpt-4o-mini`               | requires `attackerLlm.baseURL` |
| `openai-compatible` | `OPFOR_API_KEY`                | (no default)                | requires `attackerLlm.baseURL` |

---

## Target endpoint formats — agent mode

Applies to `target.requestFormat` for HTTP targets.

**`openai`** — OpenAI messages format:

```json
POST /chat
{ "model": "gpt-4o-mini", "messages": [{ "role": "user", "content": "attack prompt" }] }
```

Response extracted from `choices[0].message.content`.

For multi-turn attacks against a raw LLM endpoint, also set `target.stateful: false` so opfor sends the full conversation history as the `messages` array each turn instead of just the latest user message. See [Single-turn vs multi-turn](#single-turn-vs-multi-turn).

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
