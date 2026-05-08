---
name: OWASP API Security Top 10
version: "2023"
id: owasp-api
description: API security testing for LLM-fronted applications (10 evaluators) — auth bypass,
  injection, PII leakage, and goal hijacking
evaluators:
  - bola
  - bfla
  - rbac
  - pii-direct
  - pii-api-db
  - pii-session
  - shell-injection
  - sql-injection
  - debug-access
  - hijacking
---

# OWASP API Security Top 10 (LLM-fronted Applications)

Security testing framework adapted from OWASP API Security Top 10 (2023) for applications where an LLM fronts an API. Most production LLM apps inherit API-layer risks from the underlying services they wrap — this suite probes those inherited risks through the model's prompt surface.

When selected, run the following evaluators in order:

## API1: Broken Object Level Authorization
- **Evaluator**: bola
- **Severity**: high
- **Status**: ✅ Available

## API4: Unrestricted Resource Consumption — PII Direct Disclosure
- **Evaluator**: pii-direct
- **Severity**: critical
- **Status**: ✅ Available

## API4: Unrestricted Resource Consumption — PII via API/DB
- **Evaluator**: pii-api-db
- **Severity**: critical
- **Status**: ✅ Available

## API4: Unrestricted Resource Consumption — PII Cross-Session Leakage
- **Evaluator**: pii-session
- **Severity**: high
- **Status**: ✅ Available

## API5: Broken Function Level Authorization (BFLA)
- **Evaluator**: bfla
- **Severity**: high
- **Status**: ✅ Available

## API5: Broken Role-Based Access Control
- **Evaluator**: rbac
- **Severity**: high
- **Status**: ✅ Available

## API7: Server-Side Request Forgery — Shell Injection variant
- **Evaluator**: shell-injection
- **Severity**: critical
- **Status**: ✅ Available

## API7: Server-Side Request Forgery — SQL Injection variant
- **Evaluator**: sql-injection
- **Severity**: critical
- **Status**: ✅ Available

## API7: Server-Side Request Forgery — Debug Interface Exposure
- **Evaluator**: debug-access
- **Severity**: high
- **Status**: ✅ Available

## API8: Security Misconfiguration — Goal Hijacking
- **Evaluator**: hijacking
- **Severity**: high
- **Status**: ✅ Available

---

**References:**
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- Netra preset: `owasp:api`
- PromptFoo: https://www.promptfoo.dev/docs/red-team/owasp-api/

**Note**: The suite intentionally skips API2 (Broken Authentication) and API3 (Broken Object Property Level Authorization) — those are infrastructure-layer concerns that prompt-level red-teaming cannot meaningfully exercise. SSRF (API7 proper) is covered by the existing OWASP MCP suite.
