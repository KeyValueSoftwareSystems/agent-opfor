---
name: opfor-mcp-setup
description: Set up an MCP server target for Opfor red-teaming.
---

# Opfor — MCP Server Target Configuration

Configure an MCP server target for adversarial security evaluation. When this skill is **installed in the user's repo**, prefer **reading that repo** (mcp.json, docker configs, server source) **before** a long questionnaire; then collect **only** what is still unknown.

## 1. Target Information

Ask the user about their MCP server (or pre-fill from repo scan when obvious):

- **Name** — what do they call it? (e.g., "File Server", "Database MCP")
- **Transport** — how to connect? (`stdio` or `url`)
- **Command/URL** — for stdio: the launch command (e.g., `npx @myorg/server`); for url: the SSE/HTTP endpoint (e.g., `http://localhost:3000/sse`)
- **Args** — command-line arguments (stdio only)
- **Env** — environment variables needed (e.g., `DB_PATH=/tmp/test.db`)

## 2. Transport Type

Ask the user which transport their server uses. Discover available options by scanning `./targets/` for `.md` files. Default to `stdio`.

- **stdio** — server runs as a child process, communicates via stdin/stdout
- **url** — server runs as an HTTP service (SSE or Streamable HTTP)

## 3. Auto-Detect Server Configuration

End users often **pull this skill into their own repo**. Treat that repo as the source of truth.

### With filesystem access (Claude Code, Cursor, Windsurf, local agents):

1. **MCP configuration files** (highest priority):
   - `.cursor/mcp.json` → `mcpServers.<name>` entries
   - `claude_desktop_config.json` → same format
   - `mcp.json` at repo root
   - `docker-compose*.yml` — containerized MCP servers

2. **Server source code** (if config not found):
   - `package.json` → scripts that start MCP servers
   - Python `__main__.py` or entry points with `mcp` imports
   - Go/Rust binaries with MCP server initialization

3. **Environment and configuration**:
   - `.env`, `.env.example` — environment variables the server expects
   - `Dockerfile` — server build and entrypoint
   - README sections about "running the server"

**Extract:**

- Server command and arguments
- Required environment variables (names only — never ask for secret values)
- Expected transport type
- Brief description of what the server does (from README or package.json description)

### Without filesystem access:

Ask the user directly for the transport type, command/URL, and any required env vars.

**Confirmation Flow:**

```
🔍 I scanned your repo and found an MCP server configuration.

Pre-filled Server Config:
  Name:       [from package.json name or mcp.json key]
  Transport:  stdio
  Command:    npx @myorg/mcp-server
  Args:       ["/tmp/data"]
  Env:        DB_PATH (from .env.example)

✅ Looks good, use this?
📝 Edit these fields?
❌ Start fresh?
```

**User must explicitly confirm** before proceeding.

---

## 4. Tool & Resource Discovery

After confirming server configuration, connect to the server and discover its attack surface:

1. **Launch/connect** using the configured transport adapter (from `./targets/`)
2. **Initialize** the MCP session
3. **List tools** (`tools/list`) — record all tool names, descriptions, and input schemas
4. **List resources** (`resources/list`) — record all resource URIs and descriptions

Present the discovered surface:

```
🔍 Discovered Attack Surface:

Tools (5):
  • read_file (description: Read file contents)
  • write_file (description: Write content to file)
  • execute_query (description: Run SQL query)
  • list_directory (description: List directory contents)
  • delete_file (description: Delete a file)

Resources (3):
  • file:///config/settings.json
  • file:///data/users.db
  • file:///logs/access.log
```

This discovery informs which evaluators are most relevant.

---

## 5. Assessment Scope: Suite or Custom Evaluators

### Step 1: Load Catalog

Read `./catalog.json`. This single file contains all evaluators and suites for this surface, pre-built from the evaluator tree. Parse it as JSON — it has this shape:

```json
{
  "version": 1,
  "source": "evaluators/mcp",
  "evaluators": [
    {
      "id": "ssrf",
      "name": "Server-Side Request Forgery (SSRF)",
      "severity": "critical",
      "standards": { "owasp-mcp": "MCP05" },
      "description": "...",
      "passCriteria": "...",
      "failCriteria": "...",
      "patterns": [{ "name": "AWS IMDSv1 Metadata SSRF", "template": "..." }]
    }
  ],
  "suites": [
    {
      "id": "mcp-smoke",
      "name": "MCP Smoke",
      "description": "...",
      "evaluatorIds": ["command-injection", "..."]
    },
    {
      "id": "owasp-mcp-top10",
      "name": "OWASP MCP Top 10",
      "description": "...",
      "evaluatorIds": ["ssrf", "..."],
      "derived": true
    }
  ]
}
```

From the catalog extract:

- **Suites:** each has `id`, `name`, `description`, and `evaluatorIds` (list of evaluator IDs). Standards-based suites (OWASP MCP, ATLAS) also carry `"derived": true` — synthesized from evaluator `standards:` tags, not curated by hand.
- **Evaluators:** each has `id`, `name`, `severity`, `standards`, `description`, `patterns` (array of `{ name, template }`), `passCriteria`, `failCriteria`. Whitebox source-scan evaluators additionally carry `scanMode: "source_code"`, `correlatesWith`, and a `sourceScan` block; baseline-scanner evaluators may carry `judgeNeedsLlm`, `appliesToAllTools`, and `mcpTop10`.

### Step 3: Ask User to Choose

Present two paths:

```
How would you like to define what to test?

A) Use a predefined suite (faster, standard coverage)
B) Custom selection (pick specific evaluators)
```

**IMPORTANT:**

- List **only** the suites present in the catalog's `suites` array — never invent a suite name. Enumerate them from `catalog.suites` (both curated and `"derived": true` standards suites, e.g. `owasp-mcp-top10`, `mitre-atlas`), showing each suite's `id`, `name`, and `description`.
- If user chooses A, resolve the suite's `evaluatorIds` and show which evaluators will run.
- If user chooses B, present evaluators grouped by severity.

### Recommending Evaluators Based on Discovery

After tool/resource discovery, highlight which evaluators are most relevant:

```
Based on your server's tools and resources, I recommend:

🔴 CRITICAL:
  • command-injection — your server has execute_query (SQL interface)
  • resource-exposure — 3 file resources discovered

🟠 HIGH:
  • scope-escalation — write_file + delete_file could be abused
  • missing-authentication — verify auth is enforced
```

---

## 6. Attack Configuration

Ask: **"How many attack variations per evaluator?"**

- **3** — quick (basic patterns)
- **5** — balanced (recommended)
- **10** — comprehensive
- **Custom** — any number 1-20

Ask: **"Single-turn or multi-turn attacks?"**

- **Single-turn** — one tool call per attack (faster)
- **Multi-turn** — 2-5 escalating tool calls per attack (more realistic, finds chained exploits)

---

## 7. Generate Attack Plan

For each selected evaluator:

1. Look up the evaluator entry by `id` in the catalog's `evaluators` array
2. Use the entry's `patterns` array (`{ name, template }`) as attack templates
3. Generate `<n>` attack variations:
   - Adapt templates to the specific tools and resources discovered in Step 4
   - Use actual tool names, argument schemas, and resource URIs
   - For evaluators without patterns (scanner-only): generate attacks based on the evaluator's description and the discovered attack surface
4. Copy `passCriteria` and `failCriteria` from the catalog entry

Show progress:

```
Generating attack plan...
  command-injection (5 attacks)     ✓
  resource-exposure (5 attacks)     ✓
  scope-escalation (5 attacks)      ✓
  ...
```

---

## 8. Write Config Folder

Generate a UUID-based folder name: `config-YYYYMMDD-HHMMSS-XXXX`

Create folder structure:

```
.opfor/configs/<uuid>/
  config.md
  inputs/
    command-injection.md
    resource-exposure.md
    scope-escalation.md
    ... (one file per evaluator)
```

**Write `config.md`:**

```markdown
# MCP Red Team Configuration

## Server Information

**Name:** <server name>
**Transport:** <stdio | url>
**Command:** <launch command (stdio)>
**URL:** <endpoint URL (url transport)>
**Args:** <arguments>
**Env:** <required env var names>

## Discovered Attack Surface

### Tools

<list of tool names + descriptions>

### Resources

<list of resource URIs + descriptions>

## Test Configuration

**Mode:** suite | custom
**Suite:** <selected suite (if Mode=suite)>
**Evaluators:** <comma-separated list (if Mode=custom)>
**Attack Count:** <n per evaluator>
**Turn Mode:** single | multi

## Notes

<user's free-form context>

<!--
Config ID: <uuid>
Created: <ISO 8601 timestamp>
Generated Attacks: <count>
-->
```

**Write each `inputs/<evaluator-id>.md`:**

````markdown
---
evaluator: command-injection
name: Command Injection
severity: critical
attack_count: 5
turn_mode: single
---

# Generated Attacks

## Attack 1: SQL Injection via execute_query

**Tool:** execute_query
**Arguments:**

```json
{ "query": "SELECT * FROM users; DROP TABLE sessions; --" }
```
````

## Attack 2: Path Traversal via read_file

**Tool:** read_file
**Arguments:**

```json
{ "path": "../../../etc/passwd" }
```

...

# Evaluation Criteria

## PASS (server defended)

<from evaluator frontmatter passCriteria>

## FAIL (vulnerability found)

<from evaluator frontmatter failCriteria>
```

---

## 9. Confirm

Show summary:

```
✅ MCP Configuration Complete

Server:          My Database MCP (stdio)
Command:         npx @myorg/db-server /tmp/test.db
Attack Surface:  5 tools, 3 resources
Assessment:      OWASP MCP Top 10 (10 evaluators)
Attacks:         5 per evaluator = 50 total
Turn Mode:       single-turn

Config Location: .opfor/configs/<uuid>/
Next Step:       Run /opfor-mcp-run to start the assessment

You can:
  • Review/edit attacks at .opfor/configs/<uuid>/inputs/
  • Run the assessment: use /opfor-mcp-run
  • Create more configs: run /opfor-mcp-setup again
```
