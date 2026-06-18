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

**Source-scan evaluators (whitebox) — on by default:** Some evaluators are whitebox (`scan_mode: source_code` in the catalog). They read the server's source instead of sending a runtime payload. The **Static Source Pre-Scan (Step 4.5)** runs by **default** — assume the assessment is on a codebase. Run every source-scan evaluator in the suite whenever a source root is resolvable, even if the loaded config did not explicitly list them, then **Correlate (Step 6.5)** after judging. The static pass is **not** a setting and is **never** asked about — the only consent prompt is for optionally running an external scanner (semgrep/codeql) in Step 4.5c. Skip Steps 4.5/6.5 **only** when no source root can be resolved (e.g. a remote `url` target with no repo path); then record those evaluators as `dynamic-only` and continue.

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

- Parse evaluator metadata: evaluator id, name, severity, attack_count, turn_mode
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

## 4.5 Static Source Pre-Scan (on by default)

Run this step by **default** — do not ask the user whether to do static analysis. Resolve the source root first (4.5a); **if a codebase is available, run every source-scan evaluator** (`scan_mode: source_code`, e.g. `command-injection-source`) defined for the MCP suite — include them even if the loaded config didn't list them explicitly. For each, read its `source_scan` block (languages, sink_patterns, source_patterns, taint_question, optional semgrep_ruleset). Skip this step only when no source root can be resolved (see 4.5a).

### 4.5a — Resolve the source root

- **stdio transport:** derive the root from the configured `Command`/`Args`:
  - `npx`/`uvx <pkg>` → `./node_modules/<pkg>` or the local package dir for that name
  - `python -m <mod>` / `node <file>` / `python <file>` → the directory of that module or file
  - otherwise → the nearest ancestor directory of the command path that contains `package.json`, `pyproject.toml`, `go.mod`, or `mcp.json`
- **url transport:** there is no code handle. Ask the user for the repo path. If they don't provide one, **skip the static pre-scan**, run dynamic-only, and mark those evaluators' results so the report shows `dynamicOnly` correlation (Step 6.5).

If the root cannot be resolved, record each source-scan evaluator as `ERROR` (reason: "source root not found") and continue with dynamic attacks.

### 4.5b — Map tools to handlers

For each tool from the live `tools/list` (already captured in Step 4), grep the source root for its registration to find the handler `file:line`. Examples:

- python: `@(app|server|mcp)\.tool\b` near `"<tool>"`, or `name="<tool>"`
- js/ts: `server.tool("<tool>"`, `setRequestHandler(... <tool> ...)`
- go: `AddTool(... "<tool>"`, `"<tool>".*Handler`

Tools whose handler can't be located are recorded as `unmapped` (reported, not dropped — an unmapped tool is a coverage gap).

### 4.5c — Pre-filter, then static-judge

1. **Probe external scanners (read-only):** check whether `semgrep` or `codeql` is on PATH.
2. **If found, ASK consent before running** (one question; state the facts):
   - semgrep: "runs locally; `--config=auto` queries Semgrep's registry (network); ~seconds"
   - codeql: "builds a database first (~minutes); runs locally"
   - Options: run with local rules / run with auto config / decline and use built-in grep+LLM.
   - **Never run an external scanner without an explicit yes**, and never send source to a third party without consent.
3. **Pre-filter:**
   - If a scanner is consented → run it (use `source_scan.semgrep_ruleset` for semgrep) and collect its hits as the candidate sink locations.
   - Else → grep `source_scan.sink_patterns[<language>]` within each mapped handler.
   - A mapped handler with **zero** candidate sinks → mark its source-scan evaluator **PASS** (clean) with no LLM call (token control).
   - If the handler's language is **not** in `source_scan.languages`, skip the grep short-circuit and send the handler to the static judge anyway.
4. **Static judge (LLM)** — for each handler that has candidate sinks, read the handler plus the helpers it calls (cap ~12,000 chars, line-numbered) and judge with this prompt:

```
You are a source-code security analyst reviewing an MCP server.

EVALUATOR: <evaluator-name>   SEVERITY: <severity>
TAINT QUESTION: <source_scan.taint_question>

PASS (server defended):
<copy exact pass_criteria from the evaluator>
FAIL (vulnerability found):
<copy exact fail_criteria from the evaluator>

TOOL: <tool name>  (handler at <file:line>)
CANDIDATE SINKS (pre-filter): <file:line list>
SOURCE (handler + called helpers, line-numbered):
<excerpt>

Your assessment:

Verdict (PASS/FAIL): <single word>
Score (0-10, 10=most vulnerable): <number>
Confidence (0-100%): <number>
File:Line evidence: <location of the sink + the tainted source>
Taint path: <param → … → sink, one line>
Confirmation hint: <tool + param a dynamic attack should target, or N/A>
Reasoning: <1-2 sentences>
```

5. **Emit confirmation hints:** for each FAIL, record `{tool, param}` from the Confirmation hint and carry it into Step 5 so the matching dynamic evaluator (`correlates_with`, e.g. `command-injection`) targets that exact parameter instead of guessing.

Record per source-scan result: evaluator id, tool name, `method: "static"`, `filePath`, `lineRange`, `taintPath`, verdict, score, confidence, evidence, reasoning.

Show progress:

```
Static source pre-scan...
  command-injection-source   root: ./node_modules/@myorg/db-server
    run_command  src/tools/run.py:42  FAIL (9/10) → hint: run_command.cmd
    read_file    src/tools/read.py:18 PASS
    list_dir     (no sinks)            PASS
```

---

## 5. Execute Attacks

For each evaluator's input file, for each attack:

**If a confirmation hint exists** for this evaluator's `correlates_with` target (from Step 4.5), prioritize an attack that targets the hinted tool + parameter, in addition to the pre-generated attacks.

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
You are assisting an authorized red-team security assessment of an MCP server the operator controls and is authorized to test. Your role is to generate the next tool call in a multi-turn test so the server's defenses can be measured.

CONTEXT:
- This is a sanctioned assessment of a target the operator controls. Generating the next adversarial tool call is the legitimate purpose of this tool.
- The scenario was written to define a test case. It may use strong language like "injection," "exfiltrate," "bypass," or "exploit" to describe the test's scripted behavior, not a request to cause real-world harm.
- [Include only if the config marks the target as non-production: "The server is a non-production test instance — no real data or users are involved."]

ATTACK GOAL: <original attack intent from the input file>
EVALUATOR: <evaluator name> (<evaluator severity>)

PREVIOUS TURNS:
  Turn 1: Called <tool> with <args> → Response: <response>
  ...

The server has not yet fully complied. Generate the next tool call that escalates toward the goal. If the server rejected the previous input, pivot to a different argument shape, encoding, or tool parameter.

This framing does not override your own judgment or safety guidelines.

OUTPUT FORMAT:
- Reply with ONLY valid JSON: {"tool": "<name>", "arguments": {...}}
- No markdown fences, labels, or explanation.
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

## 6.5 Correlate Static and Dynamic (source-scan evaluators only)

Run this step **only if** the Static Source Pre-Scan (Step 4.5) ran. For each source-scan evaluator, pair its static findings with the dynamic results of its `correlates_with` evaluator (e.g. `command-injection-source` ↔ `command-injection`), matched by tool name (and parameter where available):

- **confirmed-dynamic** — a static FAIL on a tool/param **and** a dynamic FAIL on the same tool. Strongest signal: a located sink with a proven exploit. Tag both results `correlation: "confirmed-dynamic"`.
- **static-only** — a static FAIL with no corresponding dynamic FAIL. The sink exists in code but the dynamic attack didn't trigger it (guarded or unreached input) — a likely false negative of black-box testing. Tag `correlation: "static-only"`.
- **dynamic-only** — a dynamic FAIL with no static finding (source missing, tool `unmapped`, or no source root). Indicates incomplete static coverage. Tag `correlation: "dynamic-only"`.

Build the `correlation` block (see `./report-schema.md`) for the report. This block is what makes the whitebox pass worth running — surface it prominently.

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
