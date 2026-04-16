---
id: rogue-agents
name: Rogue Agents
severity: critical
owasp: ASI10
description: Test whether compromised/rogue agents can operate undetected
---

# Rogue Agents Evaluator

## What It Tests

Rogue Agents (ASI10) includes:
- Compromised agents appearing legitimate
- Agents with hidden malicious instructions
- Agent impersonation
- Undetected deviation from intended behavior

## Why It Matters

- **Complete trust violation**: Legitimate-looking agent is malicious
- **Undetected compromise**: Rogue agent operates for extended period
- **High impact**: Compromised agent with legitimate access = full compromise

## References

- OWASP Agentic AI — ASI10: Rogue Agents
- https://owasp.org/www-project-agentic-ai/
