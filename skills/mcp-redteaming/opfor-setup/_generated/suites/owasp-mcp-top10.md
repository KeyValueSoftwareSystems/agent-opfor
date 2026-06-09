---
name: OWASP MCP Top 10
version: "2025"
id: owasp-mcp-top10
description: >-
  Full MCP red-team suite covering the OWASP MCP Top 10 attack evaluators.
  Resource exposure scanning, tool description poisoning scanning, and rug-pull
  detection always run automatically on every MCP assessment as baseline checks
  and are not listed here.
evaluators:
  - secret-exposure
  - secret-exposure-source
  - oauth-token-passthrough
  - scope-escalation
  - mcp-supply-chain
  - tool-description-injection
  - command-injection
  - command-injection-source
  - missing-authentication
  - missing-authentication-source
  - intent-subversion
  - cross-resource-leakage
  - ssrf
  - ssrf-source
  - path-traversal-source
  - content-injection
  - audit-telemetry
  - shadow-mcp-server
  - protocol-abuse
  - timing-side-channel
  - return-value-injection
---

<!-- GENERATED — source: suites/mcp/owasp-mcp-top10.md — do not edit -->

# OWASP MCP Top 10

21 attack evaluators + 3 automatic baseline scans covering the full MCP attack surface. Five of the evaluators are **whitebox source-scan** variants (`*-source`, `scan_mode: source_code`) that read the server's implementation and correlate with their dynamic counterparts; they require a resolvable source root.

### Always-on baseline scans (run automatically, not selectable)

| OWASP id | Scan                  | Theme                                                      |
| -------- | --------------------- | ---------------------------------------------------------- |
| MCP01    | resource-exposure     | Sensitive data in MCP resources readable by any client     |
| MCP03    | tool-description-scan | Static scan of tool descriptions for hidden LLM directives |
| MCP03    | rug-pull-detection    | Tool description drift detection across runs               |

### Attack evaluators (selectable)

| OWASP id | Evaluator id               | Theme                                                                    |
| -------- | -------------------------- | ------------------------------------------------------------------------ |
| MCP01    | secret-exposure            | API keys, tokens, credentials leaked via error paths or responses        |
| MCP01    | oauth-token-passthrough    | OAuth confused deputy and token passthrough attacks                      |
| MCP02    | scope-escalation           | Privilege escalation and scope bypass                                    |
| MCP02    | timing-side-channel        | Timing side-channel leakage of resource existence and auth state         |
| MCP03    | tool-description-injection | Hidden instructions injected via adversarial tool inputs                 |
| MCP03    | content-injection          | Second-order content injection via scraped/fetched page content          |
| MCP04    | mcp-supply-chain           | Software supply chain attacks and dependency tampering                   |
| MCP05    | ssrf                       | Server-Side Request Forgery — internal IPs, cloud metadata, localhost    |
| MCP05    | command-injection          | Command injection and shell metacharacter attacks                        |
| MCP05    | protocol-abuse             | Malformed JSON-RPC, unknown methods, oversized payloads                  |
| MCP06    | intent-subversion          | Agent intent redirection via tool responses                              |
| MCP06    | return-value-injection     | Runtime injection via dynamic tool response content                      |
| MCP07    | missing-authentication     | Unauthenticated or weakly authenticated tool access                      |
| MCP08    | audit-telemetry            | Lack of audit logging and telemetry — actions taken without traceability |
| MCP09    | shadow-mcp-server          | Shadow/rogue MCP server detection and spoofing                           |
| MCP10    | cross-resource-leakage     | Cross-user, cross-tenant, and cross-session data leakage                 |

### Whitebox source-scan evaluators (selectable)

`scan_mode: source_code` — these read the server's implementation instead of sending a runtime payload, and correlate with the dynamic evaluator named in `correlates_with`. They require a resolvable source root (derived from the launch command for stdio; supplied by the operator for url). See the execute skill's Static Source Pre-Scan step.

| OWASP id | Evaluator id                  | Correlates with        | Theme                                                         |
| -------- | ----------------------------- | ---------------------- | ------------------------------------------------------------- |
| MCP01    | secret-exposure-source        | secret-exposure        | Hardcoded secrets + error paths leaking exceptions/env        |
| MCP01    | path-traversal-source         | resource-exposure      | Path/filename args reaching file ops without base containment |
| MCP05    | command-injection-source      | command-injection      | Tool args traced into shell/exec/eval sinks                   |
| MCP05    | ssrf-source                   | ssrf                   | URL/host args reaching outbound clients without validation    |
| MCP07    | missing-authentication-source | missing-authentication | Sensitive handlers acting without an auth/authz check         |
