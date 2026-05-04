# Astra MCP Server

Expose Astra's red team capabilities as MCP tools so any compatible AI agent (Cursor, Claude Desktop, Windsurf, etc.) can run security assessments directly from the chat.

## Tools

| Tool | Description |
|---|---|
| `astra_setup` | Generate red team attack prompts from a config file |
| `astra_run` | Fire attacks, judge responses, and produce HTML + JSON reports |

### `astra_setup`

Reads your config file, selects evaluators, uses an LLM to generate targeted attack prompts, and writes them to an `astra-prompts-*.json` file.

**Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `config_path` | Yes | Path to your `astra.config.json` or `.yml` file |
| `api_key` | No | LLM API key (overrides config file and env var) |
| `output_dir` | No | Where to write the prompts file (default: current directory) |

### `astra_run`

Fires each attack at your target endpoint, judges every response (PASS/FAIL), and generates reports.

**Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `input_path` | Yes | Path to the `astra-prompts-*.json` produced by `astra_setup` |
| `api_key` | No | LLM API key for judging (overrides key in prompts file) |
| `output_dir` | No | Where to write reports (default: `.astra/reports`) |

---

## Setup

### 1. Build the server

```bash
cd mcp
npm install
```

This compiles TypeScript to `mcp/dist/`.

### 2. Configure your MCP client

#### Cursor

Add to `~/.cursor/mcp.json` (global — available in all projects):

```json
{
  "mcpServers": {
    "astra": {
      "command": "node",
      "args": ["/absolute/path/to/astra/mcp/dist/index.js"]
    }
  }
}
```

The server will automatically read `GROQ_API_KEY` (or whichever provider key) from your project's `.env` file. You only need the `env` block if you don't use a `.env` file:

```json
{
  "mcpServers": {
    "astra": {
      "command": "node",
      "args": ["/absolute/path/to/astra/mcp/dist/index.js"],
      "env": {
        "GROQ_API_KEY": "your-key-here"
      }
    }
  }
}
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "astra": {
      "command": "node",
      "args": ["/absolute/path/to/astra/mcp/dist/index.js"]
    }
  }
}
```

### 3. Set your API key

The MCP server automatically loads a `.env` file from the project directory it's invoked in. The API key is resolved in this priority order:

1. **Tool argument** — pass `api_key` directly in the tool call (highest priority)
2. **Project `.env` file** — `GROQ_API_KEY=...` in `.env` at your project root (recommended — automatic, no config needed)
3. **MCP config `env` block** — set in `mcp.json` (useful for CI or when there's no `.env`)
4. **System env var** — `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`

**The simplest setup:** just add your key to your project's `.env` file and you're done:

```bash
# .env (in your target project)
GROQ_API_KEY=gsk_your-key-here
```

The `env` block in `mcp.json` is then optional and only needed if you don't have a `.env` file.

---

## Usage

Once registered, you can talk to your agent naturally:

```
"Red team my chatbot at localhost:4000 using myconfig.json"

"Run astra_setup with config_path='./myconfig.json' then astra_run on the output"

"Generate attack prompts for my support bot and run a full scan"
```

The agent will call `astra_setup` → get the prompts file path → call `astra_run` → return a full findings summary.

---

## Example config file

```json
{
  "llm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile"
  },
  "target": {
    "name": "My Support Bot",
    "description": "A customer support chatbot with access to booking data and PII.",
    "type": "http-endpoint",
    "endpoint": "http://localhost:4000/chat",
    "requestFormat": "json"
  },
  "selection": {
    "mode": "suite",
    "suite": "owasp-llm-top10"
  }
}
```

---

## Project structure

```
mcp/
├── src/
│   ├── index.ts              ← MCP server entrypoint (tools registered here)
│   ├── core/
│   │   ├── setup.ts          ← Pure setup logic (load config, generate prompts)
│   │   └── run.ts            ← Pure run logic (fire attacks, judge, report)
│   ├── config/               ← Shared types and evaluator registry
│   ├── evaluators/           ← Evaluator parser, prompt generator, judge
│   ├── lib/                  ← HTTP attack agent
│   ├── providers/            ← LLM provider factory
│   └── report/               ← HTML + JSON report generator
├── dist/                     ← Compiled output (generated)
├── package.json
└── tsconfig.json
```
