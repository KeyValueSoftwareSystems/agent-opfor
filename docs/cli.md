# Opfor — CLI

The CLI is a self-contained tool that handles everything: interactive setup, attack prompt generation, firing attacks, judging responses, and producing reports — all without an agent.

---

## How the pieces fit together

| Command                                      | What it does                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **`opfor init`**                             | Writes a starter `opfor.config.json` in the current directory. Optional — skip if you prefer the wizard or hand-write YAML/JSON. |
| **`opfor init --example …`**                 | Writes sample `opfor-local-target.py` / `.js` stubs only (no config). For local-script targets.                                  |
| **`opfor setup`**                            | Interactive wizard — chooses mode (MCP vs agent) and writes `.opfor/configs/opfor-config-<timestamp>-<id>.json`.                 |
| **`opfor generate --config <file>`**         | Non-interactive — reads your config, then writes `.opfor/attacks/opfor-attacks-<timestamp>-<configId>.json`. Use this in CI.     |
| **`opfor execute --attacks <attacks.json>`** | Runs attacks from the attacks file, judges responses, writes HTML + JSON reports.                                                |

**Typical paths:**

1. **Config-first:** `opfor setup --empty` → edit the generated `.opfor/configs/...json` → `opfor generate --config ...` → `opfor execute --attacks ...`
2. **Wizard-only:** set API key in env → `opfor setup` → follow the printed `Next:` commands

`setup` always produces the prompts file; `run` always consumes it.

---

## Requirements

- Node.js 18+
- API key for any supported LLM provider (OpenAI, Anthropic, Groq, Google, or any OpenAI-compatible endpoint)

---

## Install

```bash
git clone https://github.com/yourusername/opfor.git
cd opfor
npm install --ignore-scripts
npm run build
npm install -g ./cli   # make the `opfor` command available globally
```

---

## Step 1 — Config file (optional)

Only needed for `opfor setup --config`. Skip this step if using the interactive wizard.

```bash
opfor init   # writes opfor.config.json
```

**Sample local-target stubs** (no config written):

```bash
opfor init --example python    # writes opfor-local-target.py
opfor init --example node      # writes opfor-local-target.js
opfor init --example both
opfor init --example python --script-dir ./scripts
```

**Minimal JSON config:**

```json
{
  "llm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile"
  },
  "target": {
    "name": "My Support Bot",
    "description": "A customer support chatbot with access to user booking data and PII. It can issue partial refunds and look up bookings by name.",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat",
    "requestFormat": "openai",
    "targetModel": "gpt-4o-mini"
  },
  "selection": {
    "mode": "suite",
    "suite": "owasp-llm-top10"
  }
}
```

**YAML equivalent (`opfor.config.yml`):**

```yaml
llm:
  provider: groq
  model: llama-3.3-70b-versatile

target:
  name: My Support Bot
  description: >
    A customer support chatbot with access to user booking data and PII.
    It can issue partial refunds and look up bookings by name.
  type: local-script
  scriptPath: ./opfor-local-target.py

selection:
  mode: evaluators
  evaluators:
    - prompt-injection
    - sensitive-disclosure
    - system-prompt-leakage
    - jailbreaking
```

---

## Step 2 — API key

The LLM key is used during `opfor setup` (prompt generation) and `opfor execute` (judging). Set it before running either command.

**A — Environment variable / `.env` file (recommended):**

```bash
export GROQ_API_KEY=your-key-here
export OPENAI_API_KEY=your-key-here
export ANTHROPIC_API_KEY=your-key-here
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

The CLI loads `.env` from the current working directory automatically. Add `.env` to `.gitignore`.

**B — Config file field:**

```json
{ "llm": { "provider": "groq", "apiKey": "gsk_your-key-here" } }
```

**C — CLI flag (overrides A and B):**

```bash
opfor setup --config opfor.config.json --api-key gsk_your-key-here
opfor execute --attacks .opfor/attacks/opfor-attacks-….json --api-key gsk_your-key-here
```

> Avoid committing secrets. Add `.opfor/` (configs, attacks, reports) to `.gitignore` (already the default in this repo).

---

## Step 3 — Generate attack prompts

```bash
# From a config file (non-interactive; good for CI)
opfor setup --config opfor.config.json
opfor setup --config opfor.config.json --api-key gsk_your-key-here

# Interactive wizard (no config file needed)
opfor setup
```

`opfor generate` writes `.opfor/attacks/opfor-attacks-<timestamp>-<configId>.json` containing attacks and embedded run metadata.

---

## Step 4 — Run the scan

```bash
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<configId>.json

# Override API key at run time
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<configId>.json --api-key gsk_your-key-here

# Custom report directory
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<configId>.json --out-dir ./reports

# Force attacks through a local script
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<configId>.json --target-script ./opfor-local-target.js
```

---

## Local target scripts (`.js` / `.py`)

When your target is not a single HTTP URL, use a local script as an adapter.

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

**Override at run time:**

```bash
opfor execute --attacks .opfor/attacks/opfor-attacks-<timestamp>-<configId>.json --target-script ./opfor-local-target.js
```

**Sanity-check without a full scan:**

```bash
echo '{"prompt":"hello","context":{}}' | node ./opfor-local-target.js
echo '{"prompt":"hello","context":{}}' | python3 ./opfor-local-target.py
```

---

## Single-turn vs multi-turn

By default opfor executes **single-turn** attacks: one prompt → one response → judged.

**Multi-turn** fires a short adversarial conversation. After each response, if the target holds firm, an attacker LLM generates a more escalating follow-up (up to `turns`, default 3). Stops as soon as the judge returns FAIL.

Multi-turn requires your target to maintain conversation history across requests using a `sessionId`. Opfor injects it but does not replay history itself.

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

---

## Telemetry (optional)

When a telemetry provider is configured, opfor does two things:

1. **Setup** — fetches real production traces and uses them to ground attack prompts in actual user language and flows, producing more targeted attacks.
2. **Run** — optionally injects a trace ID into each target request (`propagation.traceIdBodyField`) so the recorded trace can be fetched after the attack and passed to the LLM judge, giving it visibility into internal tool calls, retrieved data, and intermediate reasoning — not just the final response.

### Langfuse

```json
"telemetry": {
  "provider": "langfuse",
  "langfuse": {
    "baseUrl": "https://cloud.langfuse.com",
    "traceSelection": { "lookbackHours": 24 }
  }
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

Set the API key in the environment:

```bash
export NETRA_API_KEY=NE_...
```

For a custom env var name use `netra.apiKeyEnv` in the config. `propagation.traceIdBodyField` must match a field your agent reads from the request body and forwards to the Netra SDK as the active OTel trace ID — without that wiring, judge enrichment won't correlate correctly.

---

## CI/CD integration

```yaml
# .github/workflows/opfor.yml
- name: Generate attack prompts
  run: opfor setup --config opfor.config.json

- name: Run Opfor scan
  run: opfor execute --attacks .opfor/attacks/opfor-attacks-*.json
```

---

## Commands reference

| Command                                                 | Description                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `opfor init`                                            | Generate a sample `opfor.config.json`                         |
| `opfor init --example python` / `node` / `both`         | Write sample local-target stubs only; optional `--script-dir` |
| `opfor setup`                                           | Interactive wizard — generate attack prompts                  |
| `opfor setup --config <file>`                           | Non-interactive setup from a JSON or YAML config file         |
| `opfor setup --config <file> --api-key <key>`           | Setup with API key override                                   |
| `opfor execute --attacks <file>`                        | Fire attacks and generate HTML + JSON report                  |
| `opfor execute --attacks <file> --target-script <path>` | Run attacks via a local `.js`/`.py` adapter                   |
| `opfor execute --attacks <file> --api-key <key>`        | Run with API key override                                     |

---

## Config fields reference

| Field                                    | Required           | Description                                                                                                                   |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `llm.provider`                           | No                 | `groq`, `openai`, `anthropic`, `google`, or `other`. Defaults to `groq`.                                                      |
| `llm.model`                              | No                 | Model name. Defaults to provider's recommended model.                                                                         |
| `llm.apiKey`                             | No                 | API key. If omitted, read from the corresponding env var.                                                                     |
| `llm.baseURL`                            | Only for `other`   | Base URL for custom OpenAI-compatible endpoints.                                                                              |
| `target.name`                            | Yes                | Human-readable name for the target.                                                                                           |
| `target.description`                     | No                 | What the target does, data it handles, restrictions. More detail = better attacks. Optional when Langfuse enrichment is used. |
| `target.type`                            | Yes                | `http-endpoint` or `local-script`.                                                                                            |
| `target.scriptPath`                      | For `local-script` | Path to the adapter script, relative to cwd.                                                                                  |
| `target.endpoint`                        | For HTTP           | Full URL to POST attacks to.                                                                                                  |
| `target.requestFormat`                   | For HTTP           | `openai`, `json`, or `auto` (default).                                                                                        |
| `target.targetModel`                     | For HTTP / openai  | Model name to send in the request body.                                                                                       |
| `target.targetApiKey`                    | No                 | Bearer token for the target endpoint.                                                                                         |
| `target.promptPath`                      | No                 | Dot-path for the prompt field (e.g. `input.message`). Defaults to `prompt`.                                                   |
| `target.responsePath`                    | No                 | Dot-path to extract the reply (e.g. `data.reply`). Falls back to built-in chain.                                              |
| `target.sessionIdField`                  | No                 | Body field to inject a session ID for multi-turn attacks.                                                                     |
| `selection.mode`                         | Yes                | `suite` or `evaluators`.                                                                                                      |
| `selection.suite`                        | For suite          | `owasp-llm-top10` or `owasp-agentic-ai`.                                                                                      |
| `selection.evaluators`                   | For evaluators     | Array of evaluator IDs.                                                                                                       |
| `turnMode`                               | No                 | `single` (default) or `multi`.                                                                                                |
| `turns`                                  | No                 | Number of turns per attack when `turnMode` is `multi`. Defaults to `3`.                                                       |
| `telemetry.provider`                     | No                 | `langfuse`, `netra`, or `none` (default).                                                                                     |
| `telemetry.propagation.traceIdBodyField` | No                 | Request body field to inject a trace ID into (e.g. `trace_id`). Requires the target agent to forward it to the telemetry SDK. |
| `telemetry.propagation.traceIdStrategy`  | No                 | `per-attack` (default) or `per-run`.                                                                                          |
| `telemetry.enrichJudgeFromTrace`         | No                 | Fetch the recorded trace after each attack and pass spans to the LLM judge. Default `false`.                                  |

---

## Supported LLM providers

| Provider    | Env var                        | Default model               |
| ----------- | ------------------------------ | --------------------------- |
| `groq`      | `GROQ_API_KEY`                 | `llama-3.3-70b-versatile`   |
| `openai`    | `OPENAI_API_KEY`               | `gpt-4o-mini`               |
| `anthropic` | `ANTHROPIC_API_KEY`            | `claude-3-5-haiku-20241022` |
| `google`    | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash`          |
| `other`     | `OPFOR_API_KEY`                | (requires `llm.baseURL`)    |

---

## Target endpoint formats

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
