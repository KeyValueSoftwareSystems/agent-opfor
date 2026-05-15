# Opfor — MCP Server

The MCP server exposes Opfor as tools that any MCP-compatible AI agent (Cursor, Claude Desktop, Windsurf) can call directly. No terminal required — the agent runs the full workflow from your chat.

---

## How it works

The agent calls three tools in sequence:

1. **`opfor_list_evaluators`** — discover available evaluator IDs and suites
2. **`opfor_setup`** — generate targeted attack prompts (inline parameters or config file)
3. **`opfor_execute`** — fire attacks, judge responses, write HTML + JSON reports

No config file is required. The agent can pass all parameters inline based on what it finds in your repo.

---

## Installation

```bash
git clone https://github.com/yourusername/opfor.git
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
      "args": ["/absolute/path/to/opfor/mcp/dist/index.js"]
    }
  }
}
```

## Configure in Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opfor": {
      "command": "node",
      "args": ["/absolute/path/to/opfor/mcp/dist/index.js"]
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

The agent will call `opfor_list_evaluators` → `opfor_setup` → `opfor_execute` and return a full findings summary in chat, with HTML and JSON reports saved to disk.

---

## Tools reference

### `opfor_list_evaluators`

No parameters. Returns every evaluator ID, severity, OWASP tag, and all predefined suites. Call this first when you haven't specified evaluator IDs.

---

### `opfor_setup`

Generates attack prompts. Accepts **inline parameters** (preferred for agent red-teaming) or a **config file path** (agent or MCP red-teaming). Mode is auto-detected:

- Inline `target_*` params → agent/chatbot red-teaming
- `config_path` with `target` + `selection` blocks → agent/chatbot red-teaming from a config file
- `config_path` with an `mcp` block → **MCP server red-teaming** (opfor connects to the server, lists tools, fires real `tools/call` attacks). See [cli.md → Two testing modes](cli.md#two-testing-modes).

#### Inline parameters

| Parameter                 | Type                              | Required           | Description                                                                                                                                  |
| ------------------------- | --------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `target_name`             | string                            | Yes (inline)       | Name of the AI app (e.g. `"Support Bot"`)                                                                                                    |
| `target_endpoint`         | string                            | For HTTP           | URL to attack (e.g. `http://localhost:4000/chat`)                                                                                            |
| `target_type`             | `http-endpoint` \| `local-script` | No                 | Defaults to `http-endpoint`                                                                                                                  |
| `target_description`      | string                            | No                 | What the app does, sensitive data, dangerous ops. Optional when `use_langfuse=true`                                                          |
| `target_request_format`   | `auto` \| `openai` \| `json`      | No                 | Request shape. Defaults to `auto`                                                                                                            |
| `target_api_key`          | string                            | No                 | Auth token for the target endpoint                                                                                                           |
| `target_script_path`      | string                            | For `local-script` | Path to the local script                                                                                                                     |
| `suite`                   | string                            | One of these       | Suite ID (e.g. `owasp-llm-top10`). Mutually exclusive with `evaluator_ids`                                                                   |
| `evaluator_ids`           | string[]                          | One of these       | Specific evaluator IDs. Mutually exclusive with `suite`                                                                                      |
| `llm_provider`            | string                            | No                 | `groq`, `openai`, `anthropic`, `google`. Defaults to `groq`                                                                                  |
| `llm_model`               | string                            | No                 | Model name. Uses provider default if omitted                                                                                                 |
| `llm_api_key_env`         | string                            | No                 | Env var **name** holding the API key (e.g. `"GROQ_API_KEY"`). The value is read from the environment; the key itself is never passed inline. |
| `use_langfuse`            | boolean                           | No                 | Fetch production traces to ground attack prompts. Requires `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` in env                              |
| `langfuse_lookback_hours` | number                            | No                 | How many hours back to fetch traces when `use_langfuse=true`. Default: 24                                                                    |
| `langfuse_trace_ids`      | string[]                          | No                 | Explicit trace IDs to use instead of a lookback window                                                                                       |
| `turn_mode`               | `single` \| `multi`               | No                 | Single-turn (one prompt → judged) or adaptive multi-turn conversation. Default: `single`                                                     |
| `turns`                   | number                            | No                 | Max turns when `turn_mode="multi"`. Default: 3                                                                                               |
| `session_id_field`        | string                            | No                 | For multi-turn HTTP targets: request body field opfor injects a session ID into so your target keeps history                                 |
| `output_dir`              | string                            | No                 | Where to write `opfor-prompts-*.json`. Defaults to `.`                                                                                       |

#### Config file

| Parameter       | Type     | Description                                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `config_path`   | string   | Path to an existing `opfor.config.json` / `.yml`. Agent or MCP — the presence of an `mcp` block flips modes. |
| `output_dir`    | string   | Output directory. Defaults to `.`                                                                            |
| `suite`         | string   | Optional override of the suite declared in the config                                                        |
| `evaluator_ids` | string[] | Optional override of the evaluator list declared in the config                                               |

---

### `opfor_execute`

Fires attacks and generates reports. Mode (agent vs MCP server) is auto-detected from the plan file structure — no flag needed. MCP plans produce extra report fields (rug-pull tool-description mutations, resource-exposure findings).

| Parameter    | Type   | Required | Description                                     |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `input_path` | string | Yes      | Path to the plan file produced by `opfor_setup` |
| `output_dir` | string | No       | Report directory. Defaults to `.opfor/reports`  |

API keys are resolved from the environment at execute time (the plan file embeds env var names, never the keys themselves).

---

## Langfuse trace integration

When `use_langfuse=true`:

- Opfor fetches the last N hours of Langfuse traces (or explicit IDs via `langfuse_trace_ids`)
- A Curator LLM picks the most relevant traces and a Summarizer LLM writes `trace-summary.md`
- Attack prompts are grounded in real user language and real tool/error patterns from production
- `target_description` can be omitted — the trace summary replaces it
- After each attack, Opfor polls Langfuse for the target's internal trace and passes it to the judge for a more accurate PASS/FAIL verdict

Required environment variables:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # optional; required for self-hosted
```

---

## API key resolution

API keys are never passed inline. The MCP server resolves them from the environment:

1. If `llm_api_key_env` is set on the tool call, opfor reads that named env var (e.g. `"GROQ_API_KEY"` → `process.env.GROQ_API_KEY`).
2. Otherwise opfor falls back to the provider's default env var (`GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`).

The server loads `.env` from the current working directory automatically at startup — no need to add an `env` block to your MCP client config.

---

## Publishing to npm (open-source usage)

The package is `@opfor/agent-mcp-server` (bin: `opfor-agent-mcp`). Not yet on npm — install from source today.

Once published, users will be able to run it without cloning:

```json
{
  "mcpServers": {
    "opfor": {
      "command": "npx",
      "args": ["-y", "@opfor/agent-mcp-server"]
    }
  }
}
```

`npx` downloads and runs the package on first use. No global install required.
