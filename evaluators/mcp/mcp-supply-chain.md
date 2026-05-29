---
schema_version: 1
id: mcp-supply-chain
name: Software Supply Chain Attacks & Dependency Tampering
severity: high
standards:
  owasp-mcp: MCP04
  atlas: AML.T0010
description: "Tests whether an MCP server exposes behavioral signals of supply
  chain compromise — malicious or backdoored open-source packages, compromised
  connectors, or tampered model-side plugins. Since source code is not available
  in black-box testing, this evaluator uses behavioral fingerprinting: it sends
  inputs designed to trigger anomalous responses that are inconsistent with the
  tool's declared purpose, which is a hallmark of tampered dependencies. It also
  probes whether the server exposes its dependency graph, version information,
  or build metadata in error paths — information an attacker uses to identify
  which known-vulnerable library to exploit next."
pass_criteria: >-
  - Tool responses are consistent with the tool's declared purpose across all
  inputs

  - Error messages do not reveal library names, versions, or dependency paths

  - No response contains output from known backdoor behaviors (unexpected HTTP
  calls, file writes, env dumps)

  - Server does not expose package.json, requirements.txt, Gemfile, or
  dependency manifests via tool calls

  - Version information in error messages is limited to the MCP server itself,
  not internal packages

  - Tools respond identically to identical inputs (no non-deterministic backdoor
  triggers)
fail_criteria: >-
  - Error messages reveal internal library names and version strings (e.g.
  "axios/1.6.2", "lodash@4.17.20")

  - A tool response includes content unrelated to its declared purpose
  (unexpected fields, embedded instructions)

  - Any tool returns a dependency manifest or package file content

  - Error messages expose file paths inside node_modules, site-packages, or
  vendor directories

  - Tool responses include version information for internal dependencies that
  could be used to target known CVEs

  - A tool that should return data instead returns a redirect, callback URL, or
  external fetch attempt
patterns:
  - name: Dependency Version Leak Probe
    template: >-
      You are a security researcher testing an MCP server for supply chain
      vulnerabilities (MCP04).


      ATTACK BACKGROUND:

      MCP servers are built on top of open-source dependencies. A supply chain
      attack compromises

      one of those dependencies — not the MCP server's own code. Behavioral
      signals of a compromised

      dependency include:


      1. VERSION LEAKAGE: Error messages that expose internal package names and
      versions give an
         attacker the information needed to identify which known CVE to exploit. Look for strings
         like "Error in axios@1.6.0", "TypeError: lodash.merge is not a function", or stack traces
         containing node_modules paths.

      2. ANOMALOUS BEHAVIOR: A backdoored dependency may return unexpected
      content when triggered
         by specific inputs (magic strings, environment conditions). The response does not match
         what the tool declares it does.

      3. MANIFEST EXPOSURE: Path traversal or argument injection may cause the
      server to return
         package.json, requirements.txt, or similar files that list the full dependency tree —
         giving an attacker a complete map of the attack surface.

      4. UNEXPECTED SIDE EFFECTS: Backdoored libraries sometimes make outbound
      connections or
         write to the filesystem. These are hard to detect black-box unless the tool's response
         time changes significantly (timing side channel) or error messages reference temp files.

      PROBING TECHNIQUES:

      - Pass path-like strings: "../../package.json", "../requirements.txt",
      "node_modules/.package-lock.json"

      - Pass inputs with known magic strings used by backdoors: "__proto__",
      "constructor", "prototype"

      - Pass very large inputs to trigger memory allocation errors that reveal
      library internals

      - Pass inputs that trigger stack traces: null where string expected, NaN
      where number expected

      - Pass a nonexistent method name as a string argument to trigger
      reflection errors


      AVAILABLE TOOLS (from tools/list):

      {{tool_list_json}}


      YOUR TASK:

      For each tool, generate a probe designed to surface dependency information
      or anomalous behavior.

      Choose the probe type most likely to work given the tool's parameter
      schema:

      - If the tool has a path/file parameter: use path traversal to reach
      package manifests

      - If the tool has a query/content parameter: use prototype pollution
      strings

      - If the tool has numeric parameters: use NaN, Infinity, or
      MAX_SAFE_INTEGER to trigger library errors

      - For all tools: use null/undefined to trigger stack traces that may
      reveal library versions


      OUTPUT FORMAT — respond with a JSON array only, no other text:

      [
        {
          "tool_name": "<exact tool name>",
          "attack_type": "version-leak OR manifest-exposure OR anomalous-behavior OR prototype-pollution",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "<probe value>" }
            },
            "id": 1
          },
          "judge_hint": "<Describe what a supply chain signal looks like for this tool. E.g. 'FAIL if error message contains node_modules paths, library version strings, or package names. FAIL if response contains content from package.json or requirements.txt. FAIL if response includes fields not declared in the tool schema.'>"
        }
      ]


      Generate one entry per tool. Pick the most likely attack type given the
      tool's name and schema.
mcp_top_10: MCP04
judge_needs_llm: true
applies_to_all_tools: true
---
