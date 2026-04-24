# Astra — CLI

The CLI is a self-contained tool that handles everything: interactive setup, attack prompt generation, firing attacks, judging responses, and producing reports — all without an agent.

---

## How the pieces fit together

| Command | What it does |
|---------|--------------|
| **`astra init`** | Writes a starter `astra.config.json` in the current directory. Optional — skip if you prefer the wizard or hand-write YAML/JSON. |
| **`astra init --example …`** | Writes sample `astra-local-target.py` / `.js` stubs only (no config). For local-script targets. |
| **`astra setup`** | Interactive wizard — asks questions in the terminal, then writes `astra-prompts-<timestamp>.json`. No config file required. |
| **`astra setup --config <file>`** | Non-interactive — reads your JSON/YAML config, then writes `astra-prompts-<timestamp>.json`. Use this in CI. |
| **`astra run --input <prompts.json>`** | Runs attacks using the target stored inside the prompts file, judges responses, writes HTML + JSON reports. |

**Typical paths:**

1. **Config-first:** `astra init` (optional) → edit `astra.config.json` → `astra setup --config astra.config.json` → `astra run --input astra-prompts-….json`
2. **Wizard-only:** set API key in env → `astra setup` → `astra run --input astra-prompts-….json`

`setup` always produces the prompts file; `run` always consumes it.

---

## Requirements

- Node.js 18+
- API key for any supported LLM provider (OpenAI, Anthropic, Groq, Google, or any OpenAI-compatible endpoint)

---

## Install

```bash
git clone https://github.com/yourusername/astra.git
cd astra
npm install --ignore-scripts
npm run build
npm install -g ./cli   # make the `astra` command available globally
```

---

## Step 1 — Config file (optional)

Only needed for `astra setup --config`. Skip this step if using the interactive wizard.

```bash
astra init   # writes astra.config.json
```

**Sample local-target stubs** (no config written):

```bash
astra init --example python    # writes astra-local-target.py
astra init --example node      # writes astra-local-target.js
astra init --example both
astra init --example python --script-dir ./scripts
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

**YAML equivalent (`astra.config.yml`):**

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
  scriptPath: ./astra-local-target.py

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

The LLM is used during `astra setup` (prompt generation) and `astra run` (judging). Priority order:

**A — CLI flag (highest priority):**

```bash
astra setup --config astra.config.json --api-key gsk_your-key-here
```

**B — Environment variable / `.env` file:**

```bash
export GROQ_API_KEY=your-key-here
export OPENAI_API_KEY=your-key-here
export ANTHROPIC_API_KEY=your-key-here
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

The CLI loads `.env` from the current working directory automatically. Add `.env` to `.gitignore`.

**C — Config file field:**

```json
{ "llm": { "provider": "groq", "apiKey": "gsk_your-key-here" } }
```

> Avoid committing a config file that contains an API key. Add `astra.config.json` and `astra-prompts-*.json` to `.gitignore`.

---

## Step 3 — Generate attack prompts

```bash
# From a config file (non-interactive; good for CI)
astra setup --config astra.config.json
astra setup --config astra.config.json --api-key gsk_your-key-here

# Interactive wizard (no config file needed)
astra setup
```

Both write `astra-prompts-<timestamp>.json` containing attack prompts and embedded target metadata.

---

## Step 4 — Run the scan

```bash
astra run --input astra-prompts-<timestamp>.json

# Override API key at run time
astra run --input astra-prompts-<timestamp>.json --api-key gsk_your-key-here

# Custom report directory
astra run --input astra-prompts-<timestamp>.json --output-dir ./reports

# Force attacks through a local script
astra run --input astra-prompts-<timestamp>.json --target-script ./astra-local-target.js
```

---

## Local target scripts (`.js` / `.py`)

When your target is not a single HTTP URL, use a local script as an adapter.

**stdin/stdout contract (one attack = one process):**

| Stream | Content |
|--------|---------|
| **Stdin** | `{"prompt":"...","context":{...},"sessionId":"..."}`. `sessionId` present for multi-turn; omitted for single-turn. |
| **Stdout** | `{"response":"..."}` on success, or `{"error":"..."}` on failure. Do not print debug lines to stdout. |
| **Stderr** | Log freely — the CLI forwards stderr to your terminal. |

**Interpreter:** picked from file extension — `.py` / `.pyw` → `python3`, `.js` / `.mjs` / `.cjs` → `node`.

**Wire in config:**

```json
"target": {
  "name": "My stack (via adapter)",
  "description": "What the system does, data it touches, and policies.",
  "type": "local-script",
  "scriptPath": "./astra-local-target.js"
}
```

**Override at run time:**

```bash
astra run --input astra-prompts-<timestamp>.json --target-script ./astra-local-target.js
```

**Sanity-check without a full scan:**

```bash
echo '{"prompt":"hello","context":{}}' | node ./astra-local-target.js
echo '{"prompt":"hello","context":{}}' | python3 ./astra-local-target.py
```

---

## Single-turn vs multi-turn

By default astra runs **single-turn** attacks: one prompt → one response → judged.

**Multi-turn** fires a short adversarial conversation. After each response, if the target holds firm, an attacker LLM generates a more escalating follow-up (up to `turns`, default 3). Stops as soon as the judge returns FAIL.

Multi-turn requires your target to maintain conversation history across requests using a `sessionId`. Astra injects it but does not replay history itself.

```json
{
  "turnMode": "multi",
  "turns": 3,
  "target": {
    "sessionIdField": "session_id"
  }
}
```

- **HTTP targets:** set `target.sessionIdField` so astra injects the ID into the request body.
- **Local-script targets:** `sessionId` is always included in the stdin JSON.

---

## Langfuse telemetry (optional)

When `telemetry.provider: langfuse` is set in the config, astra fetches production traces during `setup` to ground attack prompts in real user language and flows.

Set keys in the environment — do not put them in the config file:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_BASE_URL=https://cloud.langfuse.com   # optional; for self-hosted
```

For different env var names (e.g. in CI), set `langfuse.publicKeyEnv` and `langfuse.secretKeyEnv` in the config to the variable names; the CLI reads the values at runtime.

---

## CI/CD integration

```yaml
# .github/workflows/astra.yml
- name: Generate attack prompts
  run: astra setup --config astra.config.json

- name: Run Astra scan
  run: astra run --input astra-prompts-*.json
```

---

## Commands reference

| Command | Description |
|---------|-------------|
| `astra init` | Generate a sample `astra.config.json` |
| `astra init --example python` / `node` / `both` | Write sample local-target stubs only; optional `--script-dir` |
| `astra setup` | Interactive wizard — generate attack prompts |
| `astra setup --config <file>` | Non-interactive setup from a JSON or YAML config file |
| `astra setup --config <file> --api-key <key>` | Setup with API key override |
| `astra run --input <file>` | Fire attacks and generate HTML + JSON report |
| `astra run --input <file> --target-script <path>` | Run attacks via a local `.js`/`.py` adapter |
| `astra run --input <file> --api-key <key>` | Run with API key override |

---

## Config fields reference

| Field | Required | Description |
|-------|----------|-------------|
| `llm.provider` | No | `groq`, `openai`, `anthropic`, `google`, or `other`. Defaults to `groq`. |
| `llm.model` | No | Model name. Defaults to provider's recommended model. |
| `llm.apiKey` | No | API key. If omitted, read from the corresponding env var. |
| `llm.baseURL` | Only for `other` | Base URL for custom OpenAI-compatible endpoints. |
| `target.name` | Yes | Human-readable name for the target. |
| `target.description` | No | What the target does, data it handles, restrictions. More detail = better attacks. Optional when Langfuse enrichment is used. |
| `target.type` | Yes | `http-endpoint` or `local-script`. |
| `target.scriptPath` | For `local-script` | Path to the adapter script, relative to cwd. |
| `target.endpoint` | For HTTP | Full URL to POST attacks to. |
| `target.requestFormat` | For HTTP | `openai`, `json`, or `auto` (default). |
| `target.targetModel` | For HTTP / openai | Model name to send in the request body. |
| `target.targetApiKey` | No | Bearer token for the target endpoint. |
| `target.promptPath` | No | Dot-path for the prompt field (e.g. `input.message`). Defaults to `prompt`. |
| `target.responsePath` | No | Dot-path to extract the reply (e.g. `data.reply`). Falls back to built-in chain. |
| `target.sessionIdField` | No | Body field to inject a session ID for multi-turn attacks. |
| `selection.mode` | Yes | `suite` or `evaluators`. |
| `selection.suite` | For suite | `owasp-llm-top10` or `owasp-agentic-ai`. |
| `selection.evaluators` | For evaluators | Array of evaluator IDs. |
| `turnMode` | No | `single` (default) or `multi`. |
| `turns` | No | Number of turns per attack when `turnMode` is `multi`. Defaults to `3`. |

---

## Supported LLM providers

| Provider | Env var | Default model |
|----------|---------|---------------|
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-5-haiku-20241022` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| `other` | `ASTRA_API_KEY` | (requires `llm.baseURL`) |

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
