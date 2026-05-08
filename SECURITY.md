# Security Policy

## Scope

This policy applies to vulnerabilities in the **Astra tool itself** — its CLI, evaluation engine, report generation, and MCP client.

It does not cover:

- Findings from running Astra _against_ another system (report those to that system's maintainers)
- Vulnerabilities in third-party dependencies (report those upstream; we will update dependencies promptly when notified)

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: [astra@keyvalue.systems](mailto:astra@keyvalue.systems)

Include in your report:

- A description of the vulnerability and its potential impact
- Steps to reproduce (config, command, input)
- The Astra version (`astra --version`)
- Whether you believe it is exploitable in default configurations

You will receive an acknowledgement within **3 business days** and a resolution timeline within **7 business days**.

## Disclosure policy

We follow coordinated disclosure. We ask that you:

1. Give us reasonable time to fix the issue before publishing details (we aim for 30 days)
2. Avoid accessing or modifying data beyond what is needed to demonstrate the issue
3. Not exploit the vulnerability against systems you do not own

We will credit reporters in the fix commit and changelog unless you prefer to remain anonymous.

## Responsible use

Astra is designed for authorized security testing. You are responsible for ensuring you have permission to test any system you point Astra at. Unauthorized use of Astra against systems you do not own or have explicit written permission to test may violate computer fraud laws in your jurisdiction.
