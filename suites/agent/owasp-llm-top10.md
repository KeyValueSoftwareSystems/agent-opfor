---
name: OWASP LLM Top 10
version: "2025"
id: owasp-llm-top10
description: Security testing for LLM applications (10 evaluators)
evaluators:
  - prompt-injection
  - prompt-injection-source
  - sensitive-disclosure
  - supply-chain
  - data-poisoning
  - improper-output-handling
  - improper-output-handling-source
  - excessive-agency
  - excessive-agency-source
  - system-prompt-leakage
  - vector-embedding-weaknesses
  - misinformation
  - unbounded-consumption
---

# OWASP LLM Top 10

Security testing framework for Large Language Model applications.

When selected, run the following evaluators in order:

## LLM01: Prompt Injection

- **Evaluator**: prompt-injection
- **Severity**: critical
- **Status**: ✅ Available
- **Whitebox**: prompt-injection-source (`scan_mode: source_code`) — traces retrieved/tool/memory content into model calls; requires source access

## LLM02: Sensitive Information Disclosure

- **Evaluator**: sensitive-disclosure
- **Severity**: critical
- **Status**: ✅ Available

## LLM03: Supply Chain Vulnerabilities

- **Evaluator**: supply-chain
- **Severity**: high
- **Status**: ✅ Available

## LLM04: Data and Model Poisoning

- **Evaluator**: data-poisoning
- **Severity**: high
- **Status**: ✅ Available

## LLM05: Improper Output Handling

- **Evaluator**: improper-output-handling
- **Severity**: high
- **Status**: ✅ Available
- **Whitebox**: improper-output-handling-source (`scan_mode: source_code`) — traces LLM output into eval/shell/SQL/HTML sinks

## LLM06: Excessive Agency

- **Evaluator**: excessive-agency
- **Severity**: high
- **Status**: ✅ Available
- **Whitebox**: excessive-agency-source (`scan_mode: source_code`) — checks confirmation/ownership/scope guards on privileged actions

## LLM07: System Prompt Leakage

- **Evaluator**: system-prompt-leakage
- **Severity**: critical
- **Status**: ✅ Available

## LLM08: Vector and Embedding Weaknesses

- **Evaluator**: vector-embedding-weaknesses
- **Severity**: high
- **Status**: ✅ Available

## LLM09: Misinformation

- **Evaluator**: misinformation
- **Severity**: high
- **Status**: ✅ Available

## LLM10: Unbounded Consumption

- **Evaluator**: unbounded-consumption
- **Severity**: high
- **Status**: ✅ Available

---

**References:**

- https://owasp.org/www-project-llm-top-10/
- https://www.promptfoo.dev/docs/red-team/owasp-llm-top-10/

**Note**: Evaluators marked as "Planned" will be added in future versions. The agent should skip any evaluator whose skill file does not exist in `./evaluators/` (under `skills/opfor-setup/evaluators/`).
