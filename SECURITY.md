# Security Policy

## Scope

This policy applies to vulnerabilities in the **Opfor tool itself** — its CLI, evaluation engine, report generation, and MCP client.

It does not cover:

- Findings from running Opfor _against_ another system (report those to that system's maintainers)
- Vulnerabilities in third-party dependencies (report those upstream; we will update dependencies promptly when notified)

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: [opfor@keyvalue.systems](mailto:opfor@keyvalue.systems)

Include in your report:

- A description of the vulnerability and its potential impact
- Steps to reproduce (config, command, input)
- The Opfor version (`opfor --version`)
- Whether you believe it is exploitable in default configurations

You will receive an acknowledgement within **3 business days** and a resolution timeline within **7 business days**.

## Disclosure policy

We follow coordinated disclosure. We ask that you:

1. Give us reasonable time to fix the issue before publishing details (we aim for 30 days)
2. Avoid accessing or modifying data beyond what is needed to demonstrate the issue
3. Not exploit the vulnerability against systems you do not own

We will credit reporters in the fix commit and changelog unless you prefer to remain anonymous.

## Intentionally vulnerable fixtures

This repository ships **deliberately insecure** test targets so OPFOR's evaluators have something to detect. They are for local testing only — **do not deploy them or expose them on a network**:

- `tests/e2e/mcp/vulnerable-server` — intentional BOLA / secret-exposure holes in an MCP server.
- `tests/e2e/agents/customer-support` — intentional BOLA / BFLA / RBAC bypass, PII disclosure, and SQL-injection-prone tool calls.
- `tests/e2e/agents/vulnerable-memory` — intentional cross-session memory-poisoning (a shared knowledge base any session can write and all sessions read).

These are not in scope for vulnerability reports — their weaknesses are by design.

## Responsible use

Opfor is designed for authorized security testing. You are responsible for ensuring you have permission to test any system you point Opfor at. Unauthorized use of Opfor against systems you do not own or have explicit written permission to test may violate computer fraud laws in your jurisdiction.
