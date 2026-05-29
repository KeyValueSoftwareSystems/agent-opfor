---
name: OWASP MCP Top 10 (Agent-Side)
version: "2025"
id: owasp-mcp-top10
description: OWASP Model Context Protocol Top 10 — agent-side evaluators (10) probing
  how an LLM/agent target behaves around MCP tool use, server trust, and resource scoping
evaluators:
  - mcp-credential-exposure
  - mcp-scope-escalation
  - mcp-tool-description-injection
  - mcp-supply-chain-trust
  - mcp-tool-injection-payload
  - mcp-intent-subversion
  - mcp-missing-authentication
  - mcp-audit-bypass
  - mcp-shadow-server
  - mcp-cross-resource-leakage
---

# OWASP MCP Top 10 (Agent-Side)

OWASP Model Context Protocol Top 10 evaluators authored in **agent-prompt style**: each evaluator sends direct attack prompts to an LLM/agent target and probes how the target _behaves_ around MCP-tool risks (credential handling, scope respect, server trust, etc.).

This is intentionally **not a copy** of the MCP suite in the CLI runner tree (`opfor/skills/opfor-setup/`). That suite uses meta-prompts that produce JSON-RPC payloads against MCP servers; this suite probes the agent that _uses_ MCP tools.

When selected, run the following evaluators in order:

## MCP01: Credential Exposure

- **Evaluator**: mcp-credential-exposure
- **Severity**: critical
- **Status**: ✅ Available

## MCP02: Scope Escalation

- **Evaluator**: mcp-scope-escalation
- **Severity**: high
- **Status**: ✅ Available

## MCP03: Tool Description Injection

- **Evaluator**: mcp-tool-description-injection
- **Severity**: critical
- **Status**: ✅ Available

## MCP04: Supply Chain Risks

- **Evaluator**: mcp-supply-chain-trust
- **Severity**: high
- **Status**: ✅ Available

## MCP05: Tool Injection Payload Forwarding

- **Evaluator**: mcp-tool-injection-payload
- **Severity**: critical
- **Status**: ✅ Available

## MCP06: Intent Subversion via Retrieved Content

- **Evaluator**: mcp-intent-subversion
- **Severity**: high
- **Status**: ✅ Available

## MCP07: Missing Authentication

- **Evaluator**: mcp-missing-authentication
- **Severity**: high
- **Status**: ✅ Available

## MCP08: Audit and Telemetry Bypass

- **Evaluator**: mcp-audit-bypass
- **Severity**: medium
- **Status**: ✅ Available

## MCP09: Shadow Server Detection

- **Evaluator**: mcp-shadow-server
- **Severity**: high
- **Status**: ✅ Available

## MCP10: Cross-Resource Leakage

- **Evaluator**: mcp-cross-resource-leakage
- **Severity**: high
- **Status**: ✅ Available

---

**References:**

- OWASP MCP Top 10 (2025) — https://owasp.org/www-project-mcp-top-10/
- Existing opfor MCP evaluators (CLI tree): `opfor/skills/opfor-setup/evaluators/` (meta-prompt JSON-RPC style; this suite is the agent-prompt analog)

**Note**: Some evaluators in this suite (notably `mcp-tool-description-injection` and `mcp-intent-subversion`) require a controllable content source — a test MCP server, search index, document store, or webpage — for the malicious payloads to be retrievable. Without that, run them in fallback mode by including the bracketed setup in the agent's context.
