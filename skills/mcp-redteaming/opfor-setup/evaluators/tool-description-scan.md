---
schema_version: 1
id: tool-description-scan
name: Tool Description Poisoning Scan (MCP03)
severity: critical
ref: MCP03
mcp_top_10: MCP03
description: >-
  Static analysis evaluator that inspects tool descriptions returned by tools/list for
  hidden LLM instructions. Unlike the tool-description-injection evaluator (which tests
  dynamic behavior), this evaluator reads each tool's actual description text and checks
  whether it contains adversarial directives that would silently hijack any AI agent
  connecting to this MCP server.
pass_criteria: |-
  - All tool descriptions are clean, functional prose describing what the tool does
  - No description contains override phrases like "ignore previous instructions"
  - No description embeds exfiltration directives (send data to external URL)
  - No description instructs the agent to change persona or drop safety guidelines
  - No description uses Unicode tricks, zero-width chars, or encoding to hide content
  - Tool descriptions match the declared purpose of the tool
fail_criteria: |-
  - Any description contains "ignore previous instructions" or similar override phrases
  - Any description embeds a URL or endpoint to exfiltrate data to
  - Any description instructs an agent to perform actions the user did not request
  - Any description contains hidden content using Unicode, whitespace padding, or encoding
  - Any description tells the agent to treat itself as unrestricted or to bypass safety guidelines
  - Tool description purpose does not match the tool's declared name/schema
judge_needs_llm: true
applies_to_all_tools: true
---
