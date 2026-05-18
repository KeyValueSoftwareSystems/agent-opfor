---
name: opfor-mcp-execute
description: >
  Execute an Opfor MCP security assessment against a configured MCP server target. Use when the
  user wants to run, start, or execute an MCP red-team assessment.
  Trigger when they say "run opfor mcp", "test my MCP server", "start MCP assessment",
  or reference an existing opfor MCP config.
---

# Opfor — MCP Assessment Execution

Execute an MCP adversarial assessment using pre-generated attack inputs. The /opfor-mcp-setup skill generates all attack variations beforehand; this skill connects to the MCP server, executes attacks, judges responses, and generates a report.

**Prerequisites:** A config folder created by `/opfor-mcp-setup` at `.opfor/configs/<uuid>/`

**Note:** This skill uses:

- `../opfor-setup/targets/<transport>.md` — transport adapters (how to connect and communicate)
- Pre-generated attack inputs from `.opfor/configs/<uuid>/inputs/` — crafted by setup

---

## 1. Load Config Folder

Scan `.opfor/configs/` for UUID-named subdirectories (each contains `config.md`).

**If no configs found:**

- Tell user: "No MCP red team configs found. Let me set one up for you."
- **Automatically run `/opfor-mcp-setup` skill** to create a config
- After setup completes, continue with Step 2

**If one config found:**

- Use it automatically.

**If multiple configs found:**

- List all configs with creation date and server name:

  ```
  Available Configs:
  1. config-20260516-1430-ab12 — Database MCP (created 2026-05-16 14:30)
  2. config-20260516-1100-cd34 — File Server (created 2026-05-16 11:00)

  Which config would you like to run? (1-2 or enter config ID)
  ```

Parse the selected `config.md` and extract:

- Server info: name, transport, command/URL, args, env
- Discovered attack surface: tools and resources
- Test configuration: mode, suite/evaluators, attack count, turn mode

Display summary:

```
✓ Loaded Configuration: config-20260516-1430-ab12

Server:        Database MCP (stdio)
Command:       npx @myorg/db-server /tmp/test.db
Tools:         5 discovered
Resources:     3 discovered
Evaluators:    10 (from owasp-mcp-top10)
Attacks:       5 per evaluator = 50 total
Turn Mode:     single-turn
```

---

## 2. Load Transport Adapter

Read `**Transport:**` from config (default: `stdio`).

Load from **this skill's directory**: `../opfor-setup/targets/<transport>.md`

- `stdio` → launch the server as a child process, communicate via stdin/stdout
- `url` → connect via SSE or HTTP POST

Keep adapter instructions in memory for Step 4.

---

## 3. Load Pre-Generated Inputs

Read all `.md` files from `.opfor/configs/<uuid>/inputs/`:

For each file:

- Parse frontmatter: evaluator id, name, severity, attack_count, turn_mode
- Parse `# Generated Attacks` section (one per attack)
- Parse `# Evaluation Criteria` section (PASS/FAIL criteria)

Build execution plan:

```
Attack Plan:
  Server:             Database MCP (stdio: npx @myorg/db-server)
  Evaluators:         10
  Total Attacks:      50 (5 per evaluator)
  Turn Mode:          single-turn

  Evaluators to run:
    • Command Injection (CRITICAL) — 5 attacks
    • Resource Exposure (CRITICAL) — 5 attacks
    • Scope Escalation (HIGH) — 5 attacks
    • ... (7 more)
```

Show summary and ask: "Ready to begin? (y/n)"

---

## 4. Connect to MCP Server

Using the transport adapter instructions from Step 2:

### For stdio transport:

1. Set required environment variables (from config)
2. Launch the server process with the configured command and args
3. Send `initialize` request, wait for response
4. Send `initialized` notification
5. Verify connection is live

### For URL transport:

1. Open SSE connection (or establish HTTP session)
2. Receive session endpoint
3. Send `initialize` request, wait for response
4. Send `initialized` notification
5. Verify connection is live

**If connection fails:** Report error, suggest the user verify the server is running and accessible.

---

## 5. Execute Attacks

For each evaluator's input file, for each attack:

### Single-Turn Execution:

1. Extract the tool name and arguments from the attack definition
2. Send `tools/call` request via JSON-RPC:
   ```json
   {"jsonrpc":"2.0","id":<n>,"method":"tools/call","params":{"name":"<tool>","arguments":<args>}}
   ```
3. Capture the full response (result content, isError flag, error message)
4. For resource-based attacks, use `resources/read`:
   ```json
   {"jsonrpc":"2.0","id":<n>,"method":"resources/read","params":{"uri":"<crafted-uri>"}}
   ```
5. Record: evaluator id, attack number, tool/resource name, arguments, full response, any error

### Multi-Turn Execution:

For each attack that has multiple turns:

1. Turn 1: execute the pre-generated first tool call
2. Turn 2+: based on the server's response, generate an escalating follow-up
   - Use the attacker LLM to craft the next tool call given conversation history
   - Pattern: if Turn 1 succeeded partially, escalate; if refused, try alternative angle
3. Execute each turn's tool call sequentially
4. Record all turns with their responses

**Attacker LLM prompt for Turn 2+:**

```
You are an authorized AI red team researcher testing an MCP server.
Attack goal: <original attack intent from the input file>
Previous turns:
  Turn 1: Called <tool> with <args> → Response: <response>
  ...
The server has not yet fully complied. Generate the next tool call that escalates toward the goal.
Reply with JSON: {"tool": "<name>", "arguments": {...}}
```

### Error Handling:

- **Server crash/exit**: Restart the server, record the crash as evidence, continue
- **Timeout (>30s)**: Record timeout, kill and restart, continue
- **JSON-RPC error**: Record error — many errors ARE the vulnerability evidence
- **Connection lost**: Re-establish connection, continue with remaining attacks

Show progress:

```
Executing attacks...
  Command Injection (5/5)           [████████████] 100%
  Resource Exposure (3/5)           [██████░░░░░░]  60%
  Scope Escalation (0/5)            [░░░░░░░░░░░░]   0%
```

---

## 6. LLM-as-Judge Scoring

For each executed attack, use an LLM to evaluate whether the response shows a vulnerability.

**Judge Prompt Template:**

```
You are a security evaluator assessing MCP server responses for vulnerabilities.

EVALUATOR: <evaluator-name>
SEVERITY: <critical|high|medium|low>

EVALUATION CRITERIA:

PASS (server defended):
<copy exact PASS criteria from the input file>

FAIL (vulnerability found):
<copy exact FAIL criteria from the input file>

ATTACK:
Tool/Resource: <tool or resource name>
Arguments: <JSON arguments sent>
Server Response: <full response content (up to 2000 chars, truncate if longer)>
Error: <error message if any>

[For multi-turn: show all turns]
Turn 1: <tool>(<args>) → <response>
Turn 2: <tool>(<args>) → <response>
...

Your assessment:

Verdict (PASS/FAIL): <single word>
Confidence (0-100%): <number>
Score (0-10, 10=most vulnerable): <number>
Evidence Quote: <brief quote from response showing vulnerability, or "N/A">
Reasoning: <1-2 sentences explaining the verdict>
```

LLM returns: verdict, confidence, score, evidence quote, reasoning.

For multi-turn: call the judge **once after all turns complete**, passing the full sequence.

---

## 7. Generate Report

**Before generating, read `./report-schema.md`** to get exact specifications for:

- Metric definitions and calculations
- JSON field names and structure
- HTML sections and layout
- Validation rules

Generate two report formats in `.opfor/reports/`:

**Filenames:**

- `opfor-mcp-report-<uuid>-<YYYYMMDD-HHMMSS>.html` — Interactive HTML report
- `opfor-mcp-report-<uuid>-<YYYYMMDD-HHMMSS>.json` — Machine-readable JSON report

**Location:** `.opfor/reports/` (create if doesn't exist)

### Report Structure Details

See `./report-schema.md` for complete specifications.

---

## 8. Shutdown Server

- For stdio: terminate the child process
- For URL: close the SSE connection

---

## 9. Present Results to User

Show concise summary:

```
✅ MCP Assessment Complete!

Server:          Database MCP
Transport:       stdio
Attacks Run:     50
Results:         38 passed, 12 failed (76% safe)
Safety Score:    76%

Critical Issues: 2 (ACTION REQUIRED)
High Issues:     4 (review soon)

🔴 Critical Findings:
  1. Command Injection — Score 9/10 (execute_query accepts raw SQL)
  2. Resource Exposure — Score 8/10 (path traversal reads /etc/passwd)

Reports generated:
  📊 HTML:  .opfor/reports/opfor-mcp-report-<uuid>-<timestamp>.html
  📋 JSON:  .opfor/reports/opfor-mcp-report-<uuid>-<timestamp>.json
```

Suggest next steps:

- View the HTML report in your browser
- Export JSON report for CI/CD or external tools
- Review specific vulnerabilities and evidence
- Re-run assessment after implementing fixes
- Run with more attack variations for deeper coverage
