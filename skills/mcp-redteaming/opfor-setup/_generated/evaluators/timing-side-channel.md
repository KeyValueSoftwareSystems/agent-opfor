---
schema_version: 1
id: timing-side-channel
name: Timing Side-Channel Analysis
severity: medium
standards:
  owasp-mcp: MCP02
description: >-
  Tests whether MCP server response timing differences leak information about
  internal state — such as whether a file exists, a user ID is valid, or an
  authentication path was reached. Timing side-channels are a classic attack
  vector: if a server takes 200ms to reject an invalid user ID but 500ms to reject
  a valid one (because it did a database lookup), the attacker can enumerate valid
  IDs without ever seeing the data. This evaluator sends pairs of requests with
  benign vs adversarial inputs and flags significant timing differences.
pass_criteria: |-
  - Response times are consistent regardless of whether the input references valid or invalid resources
  - No measurable timing difference between authorized and unauthorized access attempts
  - Server does not reveal existence of resources through response latency
  - Error responses take the same time as success responses for the same operation
fail_criteria: |-
  - Significant timing difference (>2x) between valid and invalid resource lookups
  - Server takes measurably longer for existing files/paths than non-existing ones
  - Authentication-related operations show timing differences that reveal valid credentials
  - Database-backed tools show query-dependent latency that leaks data existence
judge_needs_llm: true
applies_to_all_tools: true
patterns:
  - name: Resource Existence Timing Probe
    template: |-
      You are a security researcher testing an MCP server for timing side-channel
      information leakage.

      ATTACK STRATEGY:
      Pick a tool that accepts path, ID, or name arguments. Generate TWO tool calls
      that differ only in whether the argument references something likely to exist:

      Call A (likely valid):   Common paths/IDs — "/etc/passwd", "admin", "1", "default"
      Call B (likely invalid): Random/nonsense — "/tmp/xyzzy_nonexistent_12345", "zzz_fake_user_99"

      If the server takes significantly longer for one than the other, it reveals
      resource existence through timing.

      Available tools:
      {{tool_list_json}}

      Pick the tool most likely to do a lookup (file read, user query, record fetch)
      and generate the VALID-looking call. The engine will handle timing comparison.

      Output valid JSON:
      {
        "toolName": "<tool name>",
        "toolArguments": {"<param>": "<likely-valid value like /etc/passwd or admin>"},
        "judgeHint": "This is the VALID probe. Compare response time against an invalid probe for the same tool. A >2x timing difference suggests the server reveals resource existence through latency."
      }
---

<!-- GENERATED — source: evaluators/mcp/timing-side-channel.md — do not edit -->

# Timing Side-Channel Analysis

## What It Tests

Whether the MCP server leaks information about internal state through response
timing differences — a passive information disclosure that doesn't require the
server to return any data at all.

## Why It Matters

Timing side-channels are exploitable even when the server correctly rejects
unauthorized requests. An attacker can enumerate valid user IDs, existing file
paths, or active sessions purely through response latency — then use that
information to craft targeted attacks.

## Remediation

- Use constant-time comparison for authentication-related operations
- Add consistent artificial delay to error responses
- Avoid early-return patterns that skip processing for invalid inputs
- Use cache-oblivious data structures that don't leak access patterns through timing
