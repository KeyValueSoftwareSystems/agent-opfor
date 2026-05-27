---
schema_version: 1
id: audit-telemetry
name: Lack of Audit and Telemetry
severity: medium
standards:
  owasp-mcp: MCP08
description: "Tests whether an MCP server provides observable audit signals — request IDs, trace headers, structured error codes, and activity logs — that would allow an operator to detect and investigate security incidents after the fact. A server with no telemetry is a blind spot: attackers can call tools, exfiltrate data, and pivot across the system with no forensic trail. This evaluator probes black-box signals of telemetry absence: do responses include request IDs? Do errors include structured codes? Does the server respond to standard observability headers? It also tests whether the server inadvertently exposes internal audit logs via tool calls."
pass_criteria: |-
  - Tool responses include a request ID, trace ID, or correlation token in the response envelope
  - Errors return structured error codes, not raw exception messages
  - The server acknowledges or propagates standard tracing headers (X-Request-Id, X-Trace-Id, traceparent)
  - No tool call exposes raw audit log content, server logs, or internal request history
  - Error responses do not include other users' request IDs or session identifiers
fail_criteria: |-
  - No tool response includes any request ID, trace ID, or correlation identifier
  - Error messages are raw exception strings with no structured error code
  - Server ignores X-Request-Id and X-Trace-Id headers (no echo or propagation)
  - Any tool returns audit log content, server access logs, or request history
  - A tool response includes another user's request ID or session data (audit log cross-contamination)
  - The server has a tool that reads logs and returns them without access control
patterns:
  - name: Telemetry Absence Probe
    template: |-
      You are a security researcher testing an MCP server for lack of audit and telemetry (MCP08).

      ATTACK BACKGROUND:
      OWASP MCP08 flags servers that produce no observable forensic trail. In practice this means:

      1. NO REQUEST IDs: Every tool call should return a request or trace ID so that operators
         can correlate calls across logs. A server that returns raw results with no envelope
         is untraceable. Test: call any tool and check if the response includes a request_id,
         trace_id, x-request-id, or similar correlation field.

      2. NO STRUCTURED ERRORS: Generic exception messages ("Error: something went wrong") with
         no error code make incident response impossible. Test: trigger an error and check if
         the response includes a structured error code vs a raw stack trace.

      3. AUDIT LOG EXPOSURE: Paradoxically, some servers with poor audit controls expose their
         logs via tool calls — a "get_logs" or "list_requests" tool with no access control.
         Test: look for any tool that seems to return logs, history, or audit records and call
         it without credentials or with another user's identifiers.

      4. TRACING HEADER BLINDNESS: Standard observability infrastructure (Datadog, Jaeger, OpenTelemetry)
         uses headers like traceparent, X-B3-TraceId, or X-Request-Id to correlate calls.
         A server that ignores these entirely cannot be integrated into enterprise security monitoring.

      PROBE STRATEGY:
      A) For ALL tools: call with completely valid arguments and check if the response envelope
         includes any trace/request correlation field. Use a canary value in any free-text
         argument and check if it appears in logs (tests log injection resistance too).
      B) For tools that seem log/audit related (names containing: log, audit, history, trace,
         request, event, record): call with another user's ID or a wildcard to test access control.
      C) For HTTP transport: the test harness should send X-Request-Id and traceparent headers
         and check if they are reflected or propagated.

      AVAILABLE TOOLS (from tools/list):
      {{tool_list_json}}

      YOUR TASK:
      For each tool, generate a probe that tests telemetry and audit controls. Prioritize:
      - If the tool name suggests logs/audit/history: test with cross-user identifiers
      - For all other tools: use valid arguments and look for the absence of trace IDs in response

      OUTPUT FORMAT — respond with a JSON array only, no other text:
      [
        {
          "tool_name": "<exact tool name>",
          "attack_type": "no-request-id OR log-exposure OR cross-user-audit OR tracing-blindness",
          "jsonrpc_payload": {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "name": "<exact tool name>",
              "arguments": { "<param>": "<value>" }
            },
            "id": 1
          },
          "judge_hint": "<For no-request-id: FAIL if the response envelope contains no request_id, trace_id, or correlation field. For log-exposure: FAIL if response returns log entries belonging to other users or sessions. For tracing: FAIL if server provides no mechanism to correlate this call to a log entry.>"
        }
      ]

      Generate one probe per tool.
mcp_top_10: MCP08
judge_needs_llm: true
applies_to_all_tools: false
---
