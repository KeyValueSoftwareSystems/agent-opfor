# Opfor — MCP Server

The MCP server exposes Opfor as tools that any MCP-compatible AI agent (Cursor, Claude Desktop, Windsurf) can call directly. No terminal required — the agent runs the full workflow from your chat.

---

## How it works

The agent calls three tools in sequence:

1. **`opfor_list_evaluators`** — discover available evaluator IDs and suites
2. **`opfor_setup`** — configure a target and write `opfor.config.json`
3. **`opfor_run`** — generate attacks on-the-fly, run them, judge responses, write HTML + JSON reports

No pre-generated attack file is required. The agent passes target and LLM configuration to `opfor_setup`, then `opfor_run` handles attack generation, execution, and reporting in one shot.

---

## Installation

```bash
git clone https://github.com/KeyValueSoftwareSystems/agent-opfor.git
cd opfor
npm install
npm run build
```

---

## Configure in Cursor

Add to `~/.cursor/mcp.json` (global — works in all projects):

```json
{
  "mcpServers": {
    "opfor": {
      "command": "node",
      "args": ["/absolute/path/to/opfor/runners/mcp/dist/index.js"]
    }
  }
}
```

Or add to `.cursor/mcp.json` in a specific project for project-scoped access.

## Configure in Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opfor": {
      "command": "node",
      "args": ["/absolute/path/to/opfor/runners/mcp/dist/index.js"]
    }
  }
}
```

The server automatically reads API keys from your project's `.env` file — no `env` block needed.

---

## Usage

Once registered, just talk to your agent:

```
"Red team my chatbot at http://localhost:4000/chat"
```

The agent will call `opfor_list_evaluators` → `opfor_setup` → `opfor_run` and return a full findings summary in chat, with HTML and JSON reports saved to disk.

---

## Tools reference

### `opfor_list_evaluators`

No parameters. Returns every evaluator ID, severity, `standards` map, and all predefined suites. Call this first when you haven't specified evaluator IDs.

---

### `opfor_setup`

Configures a red team run and writes `opfor.config.json`. Returns the config file path — pass it to `opfor_run`.

#### Target parameters

| Parameter     | Type             | Required | Description                                             |
| ------------- | ---------------- | -------- | ------------------------------------------------------- |
| `target_name` | string           | Yes      | Human-readable name for the target system               |
| `target_kind` | `agent` \| `mcp` | Yes      | `agent` for HTTP/chatbot targets, `mcp` for MCP servers |

#### Agent target parameters (when `target_kind = "agent"`)

| Parameter                    | Type                               | Required    | Description                                                        |
| ---------------------------- | ---------------------------------- | ----------- | ------------------------------------------------------------------ |
| `agent_endpoint`             | string                             | For HTTP    | URL to attack (e.g. `http://localhost:4000/chat`)                  |
| `agent_request_format`       | `auto` \| `openai` \| `json`       | No          | Request body format. Defaults to `auto`                            |
| `agent_api_key_env`          | string                             | No          | Env var name holding the target API key (e.g. `TARGET_API_KEY`)    |
| `agent_model`                | string                             | No          | Model name sent to the target in the `model` field (e.g. `gpt-4o`) |
| `agent_script_path`          | string                             | For scripts | Path to a local script (.js/.py)                                   |
| `agent_description`          | string                             | No          | What the agent does (used in attack generation)                    |
| `agent_session_send_in`      | `body` \| `header`                 | No          | Where the session id is sent (stateful targets)                    |
| `agent_session_send_name`    | string                             | No          | Body dot-path or header name for the sent id (e.g. `session_id`)   |
| `agent_session_receive_in`   | `body` \| `header` \| `set-cookie` | No          | Where a **server-owned** target returns its id (enables capture)   |
| `agent_session_receive_name` | string                             | No          | Response dot-path / header / cookie name holding the returned id   |

> Client-owned targets set only `agent_session_send_*`; server-owned targets (the target returns its
> own id) also set `agent_session_receive_*`. See [Target session handling](sessions.md).

#### MCP target parameters (when `target_kind = "mcp"`)

| Parameter       | Type             | Required  | Description                                  |
| --------------- | ---------------- | --------- | -------------------------------------------- |
| `mcp_transport` | `stdio` \| `url` | No        | Transport type. Defaults to `stdio`          |
| `mcp_command`   | string           | For stdio | Command to start the MCP server              |
| `mcp_args`      | string[]         | No        | Arguments for the server command             |
| `mcp_env`       | object           | No        | Environment variables for the server process |
| `mcp_url`       | string           | For url   | MCP server URL (SSE/Streamable HTTP)         |

#### Evaluator selection

| Parameter       | Type     | Required     | Description                                                                |
| --------------- | -------- | ------------ | -------------------------------------------------------------------------- |
| `suite_id`      | string   | One of these | Suite ID (e.g. `owasp-mcp-top10`). Mutually exclusive with `evaluator_ids` |
| `evaluator_ids` | string[] | One of these | Specific evaluator IDs. Mutually exclusive with `suite_id`                 |

#### LLM configuration

| Parameter    | Type   | Required | Description                                          |
| ------------ | ------ | -------- | ---------------------------------------------------- |
| `attack_llm` | object | Yes      | LLM for generating attacks (see schema below)        |
| `judge_llm`  | object | No       | LLM for judging responses (defaults to `attack_llm`) |

LLM object schema:

```json
{
  "provider": "openai | anthropic | groq | google | deepseek | azure | openai-compatible",
  "model": "model-name",
  "api_key_env": "ENV_VAR_NAME",
  "base_url": "https://custom-endpoint/v1" // optional, for openai-compatible
}
```

#### Run settings

| Parameter     | Type                          | Required | Description                                                              |
| ------------- | ----------------------------- | -------- | ------------------------------------------------------------------------ |
| `effort`      | `adaptive` \| `comprehensive` | No       | Defaults to `adaptive`. Comprehensive runs one attack per named pattern. |
| `turns`       | number (1–10)                 | No       | Turns per attack. 1 = single-turn. Defaults to 1.                        |
| `output_dir`  | string                        | No       | Directory to write `opfor.config.json`. Defaults to `.`                  |
| `config_path` | string                        | No       | Full path for config file (overrides `output_dir`)                       |

---

### `opfor_run`

Runs the full red team evaluation from a config file produced by `opfor_setup`. Generates attacks on-the-fly, runs them against the target, judges responses, and writes an HTML + JSON report.

| Parameter         | Type                          | Required | Description                                          |
| ----------------- | ----------------------------- | -------- | ---------------------------------------------------- |
| `config_path`     | string                        | Yes      | Path to `opfor.config.json` written by `opfor_setup` |
| `output_dir`      | string                        | No       | Report directory. Defaults to config file directory  |
| `effort_override` | `adaptive` \| `comprehensive` | No       | Override the effort level from config                |
| `turns_override`  | number (1–10)                 | No       | Override turns per attack from config                |

---

## Supported providers

| Provider           | Value               | API key env var                      |
| ------------------ | ------------------- | ------------------------------------ |
| OpenAI             | `openai`            | `OPENAI_API_KEY`                     |
| Anthropic (Claude) | `anthropic`         | `ANTHROPIC_API_KEY`                  |
| Groq               | `groq`              | `GROQ_API_KEY`                       |
| Google (Gemini)    | `google`            | `GOOGLE_GENERATIVE_AI_API_KEY`       |
| DeepSeek           | `deepseek`          | `DEEPSEEK_API_KEY`                   |
| Azure OpenAI       | `azure`             | `AZURE_OPENAI_API_KEY`               |
| OpenAI-compatible  | `openai-compatible` | (set via `api_key_env` + `base_url`) |

---

## API key priority

The MCP server resolves API keys in this order:

1. The env var named in the LLM config's `api_key_env` field
2. Provider default env var (e.g. `OPENAI_API_KEY` for `openai` provider)

The server loads `.env` from the current working directory automatically — no need to add keys to the MCP config JSON.

---

## Publishing to npm (open-source usage)

Once published, users can run the MCP server without cloning the repo:

```json
{
  "mcpServers": {
    "opfor": {
      "command": "npx",
      "args": ["-y", "@keyvaluesystems/agent-opfor-mcp"]
    }
  }
}
```

`npx` downloads and runs the package on first use. No global install required.
