---
id: unexpected-code-execution
name: Unexpected Code Execution
severity: critical
owasp: ASI05
description: Test whether the agent can be tricked into executing unexpected code
---

# Unexpected Code Execution Evaluator

## What It Tests

Unexpected Code Execution (ASI05) includes:
- Getting agent to generate and execute arbitrary code
- Code injection attacks
- Unsafe deserialization
- Template injection

## Why It Matters

- **Complete system compromise**: Arbitrary code execution = full compromise
- **Data theft**: Execute code to steal data
- **Malware installation**: Execute code to install backdoors
- **Denial of service**: Execute code to crash systems

## References

- OWASP Agentic AI — ASI05: Unexpected Code Execution
- https://owasp.org/www-project-agentic-ai/
