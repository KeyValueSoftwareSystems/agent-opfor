---
name: OWASP Agentic AI Top 10
version: "2024"
id: owasp-agentic-ai
description: Security testing for agentic AI systems (10 evaluators)
evaluators:
  - agent-goal-hijack
  - tool-misuse
  - identity-privilege-abuse
  - supply-chain
  - unexpected-code-execution
  - memory-poisoning
  - inter-agent-communication
  - cascading-failures
  - human-agent-trust
  - rogue-agents
---

# OWASP Agentic AI Top 10

Security testing framework for agentic AI systems (agents, tool-using models, autonomous workflows).

When selected, run the following evaluators in order:

## ASI01: Agent Goal Hijacking
- **Evaluator**: agent-goal-hijack
- **Severity**: critical
- **Status**: ✅ Available

## ASI02: Tool Misuse and Exploitation
- **Evaluator**: tool-misuse
- **Severity**: critical
- **Status**: ✅ Available

## ASI03: Identity and Privilege Abuse
- **Evaluator**: identity-privilege-abuse
- **Severity**: critical
- **Status**: ✅ Available

## ASI04: Agentic Supply Chain Vulnerabilities
- **Evaluator**: supply-chain
- **Severity**: high
- **Status**: ✅ Available

## ASI05: Unexpected Code Execution
- **Evaluator**: unexpected-code-execution
- **Severity**: critical
- **Status**: ✅ Available

## ASI06: Memory and Context Poisoning
- **Evaluator**: memory-poisoning
- **Severity**: high
- **Status**: ✅ Available

## ASI07: Insecure Inter-Agent Communication
- **Evaluator**: inter-agent-communication
- **Severity**: high
- **Status**: ✅ Available

## ASI08: Cascading Failures
- **Evaluator**: cascading-failures
- **Severity**: high
- **Status**: ✅ Available

## ASI09: Human-Agent Trust Exploitation
- **Evaluator**: human-agent-trust
- **Severity**: high
- **Status**: ✅ Available

## ASI10: Rogue Agents
- **Evaluator**: rogue-agents
- **Severity**: critical
- **Status**: ✅ Available

---

## Related LLM Vulnerabilities

The following LLM vulnerabilities are also relevant to agentic systems:

- **Prompt Injection** — Manipulate agent objectives through injected instructions
- **Jailbreaking** — Bypass agent safety guidelines
- **Excessive Agency** — Agent performs unauthorized actions

See OWASP LLM Top 10 suite for testing these.

---

**References:**
- https://owasp.org/www-project-agentic-ai/
- https://www.promptfoo.dev/docs/red-team/owasp-agentic-ai/
