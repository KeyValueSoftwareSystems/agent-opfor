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

No parameters. Returns every evaluator ID, severity, standard reference tag (`ref`), and all predefined suites. Call this first when you haven't specified evaluator IDs.

---

### `opfor_setup`

Generates attack prompts. Accepts **inline parameters** (preferred) or a **config file path**.

#### Inline parameters

| Parameter                 | Type                              | Required           | Description                                                                                                     |
| ------------------------- | --------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `target_name`             | string                            | Yes (inline)       | Name of the AI app (e.g. `"Support Bot"`)                                                                       |
| `target_endpoint`         | string                            | For HTTP           | URL to attack (e.g. `http://localhost:4000/chat`)                                                               |
| `target_type`             | `http-endpoint` \| `local-script` | No                 | Defaults to `http-endpoint`                                                                                     |
| `target_description`      | string                            | No                 | What the app does, sensitive data, dangerous ops. Optional when `use_langfuse=true`                             |
| `target_request_format`   | `auto` \| `openai` \| `json`      | No                 | Request shape. Defaults to `auto`                                                                               |
| `target_api_key`          | string                            | No                 | Auth token for the target endpoint                                                                              |
| `target_headers`          | object                            | No                 | Custom HTTP headers sent with every request (e.g. `{"X-Api-Key": "secret", "X-Custom": "value"}`)               |
| `target_script_path`      | string                            | For `local-script` | Path to the local script                                                                                        |
| `suite`                   | string                            | One of these       | Suite ID (e.g. `owasp-llm-top10`). Mutually exclusive with `evaluator_ids`                                      |
| `evaluator_ids`           | string[]                          | One of these       | Specific evaluator IDs. Mutually exclusive with `suite`                                                         |
| `llm_provider`            | string                            | No                 | `groq`, `openai`, `anthropic`, `google`. Defaults to `groq`                                                     |
| `llm_model`               | string                            | No                 | Model name. Uses provider default if omitted                                                                    |
| `llm_api_key`             | string                            | No                 | Overrides `GROQ_API_KEY` etc. from environment                                                                  |
| `use_langfuse`            | boolean                           | No                 | Fetch production traces to ground attack prompts. Requires `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` in env |
| `langfuse_lookback_hours` | number                            | No                 | How many hours back to fetch traces when `use_langfuse=true`. Default: 24                                       |
| `langfuse_trace_ids`      | string[]                          | No                 | Explicit trace IDs to use instead of a lookback window                                                          |
| `output_dir`              | string                            | No                 | Where to write `opfor-prompts-*.json`. Defaults to `.`                                                          |

#### Config file (backward-compatible)

| Parameter     | Type   | Description                                                                                                                              |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `config_path` | string | Path to an existing `opfor.config.json` / `.yml`. If the config has an `mcp` section, MCP server red-teaming mode is used automatically. |
| `llm_api_key` | string | Optional override for the key in the config                                                                                              |
| `output_dir`  | string | Output directory. Defaults to `.`                                                                                                        |

---

### `opfor_execute`

Fires attacks and generates reports. Auto-detects the plan type from the file:

- **Agent/chatbot plan** (`opfor-attacks-*.json` from `opfor_setup`) — sends prompts to the target endpoint, judges responses, writes HTML + JSON reports.
- **MCP server plan** (plan file containing `server` + `toolsDigest`) — calls MCP tools, scans resources, detects rug-pull mutations, writes HTML + JSON reports.

| Parameter    | Type   | Required | Description                                            |
| ------------ | ------ | -------- | ------------------------------------------------------ |
| `input_path` | string | Yes      | Path to the attack plan file produced by `opfor_setup` |
| `api_key`    | string | No       | Override the LLM key stored in the plan file           |
| `output_dir` | string | No       | Report directory. Defaults to `.opfor/reports`         |

---

## Langfuse trace integration

When `use_langfuse=true`:

- Opfor fetches the last N hours of Langfuse traces (or explicit IDs via `langfuse_trace_ids`)
- A Curator LLM picks the most relevant traces and a Summarizer LLM writes `trace-summary.md`
- Attack prompts are grounded in real user language and real tool/error patterns from production
- `target_description` can be omitted — the trace summary replaces it
- After each attack, Opfor polls Langfuse for the target's internal trace and passes it to the judge for a more accurate PASS/FAIL verdict

> **Ingestion delay:** Judge enrichment relies on the observability platform processing spans asynchronously. Depending on your platform's ingestion pipeline, the judge may receive a partial trace or none at all for multi-turn attacks. Grounded attack generation is not affected — it reads historic traces, not live ones.

Required environment variables:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # optional; required for self-hosted
```

---

## API key priority

The MCP server resolves API keys in this order:

1. `llm_api_key` passed directly in the tool call
2. `llm.apiKey` in the config file (when using `config_path`)
3. Provider env var (`GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`)

The server loads `.env` from the current working directory automatically — no need to add keys to the MCP config JSON.

---

## Publishing to npm (open-source usage)

Once published, users can run the MCP server without cloning the repo:

```json
{
  "mcpServers": {
    "opfor": {
      "command": "npx",
      "args": ["-y", "@opfor/mcp"]
    }
  }
}
```

`npx` downloads and runs the package on first use. No global install required.
