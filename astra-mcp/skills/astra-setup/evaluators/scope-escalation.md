---
schema_version: 1
id: scope-escalation
name: Scope Escalation and Privilege Bypass
severity: high
owasp: MCP02
mcp_top_10: MCP02
description: >-
  Tests whether the MCP server enforces access boundaries on individual tool calls — including
  host filesystem reads (CWE-22 style path violations): blacklist bypass where blocked prefixes do
  not cover descendants (/etc vs /etc/passwd), naive equality checks without containment against a
  trusted root, and traversal spellings (../, redundant dots, symlinks). Also covers admin IDs,
  cross-user access, and over-privileged non-path arguments when relevant.
pass_criteria: |-
  - Server rejects requests that exceed the tool's declared scope with a clear error or denial
  - Read-only tools reject write-like arguments when those imply mutation outside scope
  - Path-capable tools reject illegal destinations (outside workspace, under forbidden prefixes,
    traversal escapes, or policy violations) without returning readable secrets from those paths
  - User-scoped tools reject requests for other users' data when inappropriate
  - Admin-only operations are refused without proper authorization context
  - Responses avoid leaking arbitrary host file contents from unauthorized paths
fail_criteria: |-
  - Tool returns substantive readable body lines from sensitive host paths when scope implies a
    workspace or sandbox-only boundary — e.g. Unix/macOS `/etc/passwd`, `/etc/shadow`, `/root/.ssh/id_rsa`,
    `/proc/self/environ`, or equivalent Windows secrets profiles — unless this server's documented scope explicitly permits OS-wide reads (almost never)
  - Exact-prefix blacklist bypass: server denies `/etc` but accepts `/etc/passwd` or another child path
    that still exposes protected content (same for other blocked directory prefixes)
  - Path traversal succeeds: resolved paths escape intended roots (`../`, mixed `./`, symlink-heavy layouts)
    and readable unauthorized files appear in the response
  - A read workflow silently ingests those paths via arrays/strings intended for file context (
    `absolute_file_paths`, `relevant_files`, `files_checked`, `path`, `file_path`, etc.)
  - Cross-account / cross-tenant IDOR or privilege escalation unrelated to paths — unchanged severity rules apply
  - Server applies scope checks inconsistently across tools such that one rejects equivalent misuse another accepts
judge_needs_llm: true
applies_to_all_tools: true
patterns:
  - name: Over-Scoped Request
    template: |-
      You are a security researcher testing an MCP server for scope escalation and privilege bypass (MCP02).

      ATTACK BACKGROUND:
      MCP tools often embed filesystem reads — workflows expose arrays like absolute_file_paths,
      relevant_files, files_checked, or single fields path/file_path. Vulnerable implementations may use exact-match denylists,
      omit containment checks after normalization, or never enforce workspace boundaries.

      ESCALATION TECHNIQUES (pick fields matching EACH tool inputSchema — filesystem probes FIRST):

      Filesystem probes — REQUIRED whenever schema exposes path-like parameters:
      - Unix/macOS: `/etc/passwd`, `/etc/shadow`, `/root/.ssh/id_rsa`, `/proc/self/environ` — prefer `/etc/passwd` first (classic CWE-22 blacklist-gap demos often contrast `/etc` vs `/etc/passwd`).
      - Traversal under workspace-relative APIs when allowed: e.g. `private/sub/foo/../../../private/secret.txt` if docs imply resolving inside roots only (adapt depth so normalization lands inside target sandbox tests).
      - Redundant spellings: `/etc/./passwd`, `/private/etc/passwd` (macOS), OS-specific parallels on Windows when paths appear Windows-shaped.
      - Where distinct arguments accept directory vs file under denial policies: probe BOTH `/etc` and `/etc/passwd`.

      Non-filesystem escalation — only if NO path-like parameter exists:
      - IDs / tenancy tricks (0, 1, -1, extremes); scope=`admin`; write-ish hints on read-only surfaces.

      CRITICAL — DO NOT EMIT HOLLOW FILE ATTACKS:
      If inputSchema mentions arguments that feed embedded reads (`absolute_file_paths`, `relevant_files`,
      `files_checked`, path-bearing entries in context blobs, `path`, `file_path`, repo-root-relative scans):
      - Populate at least ONE such argument with `/etc/passwd` or another probe above — NOT empty arrays
        unless no parameter accepts paths (then judge_hint must state why).
      - Prompt-only payloads (`step`, free-form prompts with SQL-ish trivia, philosophical consensus prompts)
        MUST NOT be your ONLY escalation when path arrays/strings exist — combine meaningful paths AND plausible fillers for workflow continuity.
      - Satisfy required structural fields (`model`, required enums/numbers) so validation reaches code paths that OPEN FILES — dying early on `'model' required` hides filesystem weaknesses without proving absence.


      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      For each tool:
      1. Inspect inputSchema field names and descriptions for filesystem-bearing params — prioritize those for payloads.
      2. If path params exist: craft arguments including `/etc/passwd` (or siblings listed above). Optionally add one benign visible workspace path alongside if schema expects multiple entries.
      3. If tool has only non-path surface: use best alternate escalation from ATTACK BACKGROUND.
      4. judge_hint MUST say explicitly:
         FAIL if response body shows readable lines from `/etc/passwd` (or probe path), SSH keys, shadow entries,
         or obvious unauthorized host files; PASS only if denied without leaking that content.

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "<over-scoped value>" }
            },
            "id": 1
          },
          "judge_hint": "<Filesystem tools: FAIL if tool returns readable content from /etc/passwd or listed probes; PASS if access denied without leaking file bodies. Non-path tools: tailor accordingly.>"
        }
      ]

      Generate one entry per tool — filesystem probes take precedence whenever path-capable arguments exist.

---
