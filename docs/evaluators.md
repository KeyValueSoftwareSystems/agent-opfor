# Opfor — Evaluators and Suites

An **evaluator** is a single attack-and-judge pattern (e.g. `prompt-injection`, `bola`). Each evaluator is a Markdown file with YAML frontmatter — the attacker LLM reads it to craft prompts and the judge LLM uses its pass/fail criteria to score responses.

A **suite** is a named bundle of evaluators that maps to a security standard (e.g. OWASP LLM Top 10). Pick one suite for a full standards-aligned scan, or pick individual evaluators by ID for a narrow scan.

---

## Two trees: agent vs MCP red-team

Opfor maintains two **independent** evaluator catalogs — one for agent / chatbot red-teaming, one for MCP server red-teaming. The CLI's `mode` field decides which tree the engine reads from.

> **Gotchas:**
>
> - `owasp-mcp-top10` exists as a suite ID in **both** trees with **different evaluators**. Agent-side (10) probes how an _agent_ behaves around MCP tools. MCP-side (14) probes the _MCP server itself_. Same ID, two pipelines.
> - `supply-chain` evaluator ID exists in both trees (different content per tree). Same disambiguation rule.
> - Agent-tree evaluators prefixed `mcp-*` (e.g. `mcp-scope-escalation`) probe the agent's MCP-handling behavior — they are **not** the MCP-tree evaluators.

See [cli.md → Two testing modes](cli.md#two-testing-modes) for the mode selection.

---

# Agent red-team

## Suites (6)

| Suite ID                  | Standard / version                   | Count | Focus                                                                                                                           |
| ------------------------- | ------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `owasp-llm-top10`         | OWASP LLM Top 10 (2025)              | 10    | Prompt injection, sensitive disclosure, supply chain, data poisoning, agency, hallucination, misinformation, consumption limits |
| `owasp-agentic-ai`        | OWASP Agentic AI Top 10 (2024)       | 10    | Goal hijack, tool misuse, identity abuse, memory poisoning, inter-agent comms, cascading failures, rogue agents                 |
| `owasp-mcp-top10`         | OWASP MCP Top 10 (2025) — agent-side | 10    | How an agent target handles MCP tool calls, server trust, scope, and resource boundaries                                        |
| `owasp-api`               | OWASP API Security Top 10 (2023)     | 10    | BOLA, BFLA, RBAC, PII via API/DB tools, SQL/shell injection, debug exposure, goal hijack                                        |
| `eu-ai-act-bias`          | EU AI Act — Bias & Fairness (2024)   | 4     | Demographic bias: age, disability, gender, race                                                                                 |
| `output-trust-and-safety` | Output Trust & Safety (v1)           | 8     | Hallucination, sycophancy, imitation, contractual overreach, off-topic drift, reasoning DoS, ASCII smuggling                    |

## Evaluators

### `owasp-llm-top10` — 10 evaluators

| ID                            | Name                             | Severity | OWASP         |
| ----------------------------- | -------------------------------- | -------- | ------------- |
| `prompt-injection`            | Prompt Injection                 | critical | LLM01         |
| `sensitive-disclosure`        | Sensitive Information Disclosure | critical | LLM02         |
| `supply-chain`                | Supply Chain Vulnerabilities     | high     | LLM03         |
| `data-poisoning`              | Data and Model Poisoning         | high     | LLM04         |
| `improper-output-handling`    | Improper Output Handling         | high     | LLM05         |
| `excessive-agency`            | Excessive Agency                 | high     | LLM06 / ASI02 |
| `system-prompt-leakage`       | System Prompt Leakage            | critical | LLM07         |
| `vector-embedding-weaknesses` | Vector and Embedding Weaknesses  | high     | LLM08         |
| `misinformation`              | Misinformation                   | high     | LLM09         |
| `unbounded-consumption`       | Unbounded Consumption            | high     | LLM10         |

### `owasp-agentic-ai` — 10 evaluators

| ID                          | Name                               | Severity | OWASP |
| --------------------------- | ---------------------------------- | -------- | ----- |
| `agent-goal-hijack`         | Agent Goal Hijacking               | critical | ASI01 |
| `tool-misuse`               | Tool Misuse and Exploitation       | critical | ASI02 |
| `identity-privilege-abuse`  | Identity and Privilege Abuse       | critical | ASI03 |
| `supply-chain`              | Supply Chain Vulnerabilities       | high     | ASI04 |
| `unexpected-code-execution` | Unexpected Code Execution          | critical | ASI05 |
| `memory-poisoning`          | Memory and Context Poisoning       | high     | ASI06 |
| `inter-agent-communication` | Insecure Inter-Agent Communication | high     | ASI07 |
| `cascading-failures`        | Cascading Failures                 | high     | ASI08 |
| `human-agent-trust`         | Human-Agent Trust Exploitation     | high     | ASI09 |
| `rogue-agents`              | Rogue Agents                       | critical | ASI10 |

### `owasp-mcp-top10` (agent-side) — 10 evaluators

Probes how an agent target _behaves around_ MCP. For probing an MCP server directly, see the [MCP tree](#mcp-red-team).

| ID                               | Name                                  | Severity | OWASP |
| -------------------------------- | ------------------------------------- | -------- | ----- |
| `mcp-credential-exposure`        | MCP Credential Exposure               | critical | MCP01 |
| `mcp-scope-escalation`           | MCP Scope Escalation                  | high     | MCP02 |
| `mcp-tool-description-injection` | MCP Tool Description Injection        | critical | MCP03 |
| `mcp-supply-chain-trust`         | MCP Supply Chain Trust                | high     | MCP04 |
| `mcp-tool-injection-payload`     | MCP Tool-Injection Payload Forwarding | critical | MCP05 |
| `mcp-intent-subversion`          | MCP Intent Subversion                 | high     | MCP06 |
| `mcp-missing-authentication`     | MCP Missing Authentication            | high     | MCP07 |
| `mcp-audit-bypass`               | MCP Audit and Telemetry Bypass        | medium   | MCP08 |
| `mcp-shadow-server`              | MCP Shadow Server Detection           | high     | MCP09 |
| `mcp-cross-resource-leakage`     | MCP Cross-Resource Leakage            | high     | MCP10 |

### `owasp-api` — 10 evaluators

| ID                | Name                                       | Severity | OWASP |
| ----------------- | ------------------------------------------ | -------- | ----- |
| `bola`            | Broken Object Level Authorization (BOLA)   | high     | API1  |
| `bfla`            | Broken Function Level Authorization (BFLA) | high     | API5  |
| `rbac`            | Broken Role-Based Access Control           | high     | API5  |
| `pii-direct`      | PII Direct Disclosure                      | critical | API4  |
| `pii-api-db`      | PII Disclosure via API/DB Tool Calls       | critical | API4  |
| `pii-session`     | PII Cross-Session Leakage                  | high     | API4  |
| `shell-injection` | Shell Injection                            | critical | API7  |
| `sql-injection`   | SQL Injection                              | critical | API7  |
| `debug-access`    | Debug and Admin Interface Exposure         | high     | API7  |
| `hijacking`       | Goal Hijacking                             | high     | API8  |

### `eu-ai-act-bias` — 4 evaluators

| ID                | Name            | Severity | Standard               |
| ----------------- | --------------- | -------- | ---------------------- |
| `bias-age`        | Age Bias        | medium   | EU AI Act Art. 10 / 15 |
| `bias-disability` | Disability Bias | medium   | EU AI Act Art. 10 / 15 |
| `bias-gender`     | Gender Bias     | medium   | EU AI Act Art. 10 / 15 |
| `bias-race`       | Racial Bias     | medium   | EU AI Act Art. 10 / 15 |

### `output-trust-and-safety` — 8 evaluators

| ID                | Name                                 | Severity | Tag   |
| ----------------- | ------------------------------------ | -------- | ----- |
| `hallucination`   | Hallucination                        | high     | LLM09 |
| `overreliance`    | Overreliance and Sycophancy          | medium   | LLM09 |
| `imitation`       | Unauthorized Imitation               | high     | LLM09 |
| `contracts`       | Unauthorized Contractual Commitments | high     | LLM05 |
| `competitors`     | Competitor Endorsement               | medium   | —     |
| `off-topic`       | Off-Topic Drift                      | low      | —     |
| `reasoning-dos`   | Reasoning Denial of Service          | high     | LLM10 |
| `ascii-smuggling` | ASCII / Unicode Smuggling            | high     | LLM01 |

## Standalone agent evaluators (not in any suite)

| ID             | Name         | Severity | OWASP |
| -------------- | ------------ | -------- | ----- |
| `jailbreaking` | Jailbreaking | high     | LLM10 |

Pick via `--evaluators jailbreaking` or list it in `agent.selection.evaluators`.

---

# MCP red-team

## Suites (1)

| Suite ID          | Standard / version      | Count | Focus                                                                                                                                                                                                                                                                                  |
| ----------------- | ----------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owasp-mcp-top10` | OWASP MCP Top 10 (2025) | 14    | Server-side: secret exposure, OAuth passthrough, scope escalation, supply chain, tool description injection, command injection, SSRF, missing auth, intent subversion, cross-resource leakage, second-order content injection, audit gaps, shadow server, static tool-description scan |

## Evaluators (14 pickable)

| ID                           | Name                                                               | Severity | OWASP |
| ---------------------------- | ------------------------------------------------------------------ | -------- | ----- |
| `secret-exposure`            | Secret and Token Exposure                                          | critical | MCP01 |
| `oauth-token-passthrough`    | OAuth Confused Deputy and Token Passthrough                        | critical | MCP01 |
| `scope-escalation`           | Scope Escalation and Privilege Bypass                              | high     | MCP02 |
| `tool-description-injection` | Tool Poisoning (Description Injection, Rug Pull, Schema Poisoning) | critical | MCP03 |
| `tool-description-scan`      | Tool Description Poisoning Scan                                    | critical | MCP03 |
| `content-injection`          | Second-Order Content Injection                                     | high     | MCP03 |
| `supply-chain`               | Software Supply Chain Attacks & Dependency Tampering               | high     | MCP04 |
| `command-injection`          | Command Injection and STDIO RCE                                    | critical | MCP05 |
| `ssrf`                       | Server-Side Request Forgery (SSRF)                                 | critical | MCP05 |
| `intent-subversion`          | Intent Flow Subversion                                             | high     | MCP06 |
| `missing-authentication`     | Missing Authentication                                             | critical | MCP07 |
| `audit-telemetry`            | Lack of Audit and Telemetry                                        | medium   | MCP08 |
| `shadow-mcp-server`          | Shadow MCP Server Detection                                        | high     | MCP09 |
| `cross-resource-leakage`     | Context Injection, Over-Sharing & Cross-Resource Leakage           | critical | MCP10 |

## Auto-fired (not selectable)

| ID                  | Name                  | Severity | OWASP |
| ------------------- | --------------------- | -------- | ----- |
| `resource-exposure` | MCP Resource Exposure | critical | MCP01 |

`resource-exposure` runs automatically during `opfor execute` **Phase 0** — opfor calls `resources/list` + `resources/read` on every resource and judges for secret/PII exposure. Disable with `mcp.scanResources: false` in the config.

---

## Picking evaluators by hand

**CLI — generate-time override:**

```bash
opfor generate --config .opfor/configs/...json --evaluators prompt-injection sensitive-disclosure
```

**Config file (agent mode):**

```json
"agent": {
  "selection": {
    "mode": "evaluators",
    "evaluators": ["prompt-injection", "jailbreaking", "bola"]
  }
}
```

**Config file (MCP mode):**

```json
"mcp": {
  "evaluators": ["tool-description-injection", "scope-escalation"]
}
```

**Opfor MCP server tool:**

```json
{ "evaluator_ids": ["prompt-injection", "bola"] }
```

See [cli.md → Config fields reference](cli.md#config-fields-reference) and [mcp.md → opfor_setup](mcp.md#opfor_setup).

---

## Contributing a new evaluator

1. Drop a `.md` file under the correct tree:
   - Agent: `skills/agent-redteaming/opfor-setup/evaluators/<id>.md`
   - MCP: `skills/mcp-redteaming/evaluators/<id>.md`
2. Required frontmatter: `id`, `name`, `severity`, `owasp` (or other standard tag), `description`, plus attack patterns and pass/fail criteria.
3. Engine auto-discovers — no TypeScript change needed.
4. To include it in a suite, add the evaluator ID to that suite's `evaluators:` list in its `.md` file.

Full frontmatter schema and contract: [Agents.md](Agents.md).
