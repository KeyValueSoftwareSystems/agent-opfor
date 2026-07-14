# Opfor — Evaluators and Suites

An **evaluator** is a single attack-and-judge pattern (e.g. `prompt-injection`, `bola`). Each evaluator is a YAML file — the attacker LLM reads it to craft prompts and the judge LLM uses its pass/fail criteria to score responses.

A **suite** is a named bundle of evaluators. Standard suites (`owasp-llm-top10`, `owasp-mcp-top10`, etc.) are auto-derived from evaluator `standards:` tags. Curated suites (`harmful-content`, `pre-deploy-critical`, etc.) are authored YAML files in `suites/`. Pick one suite for a full scan, or pick individual evaluator IDs for a narrow scan.

---

## Two trees: agent vs MCP red-team

Opfor maintains two **independent** evaluator catalogs — one for agent / chatbot red-teaming, one for MCP server red-teaming. The CLI's `mode` field decides which tree the engine reads from.

> **Gotchas:**
>
> - `owasp-mcp-top10` exists as a suite ID in **both** trees with **different evaluators**. Agent-side (10) probes how an _agent_ behaves around MCP tools. MCP-side (23) probes the _MCP server itself_. Same ID, two pipelines.
> - `supply-chain` evaluator ID exists in both trees (different content per tree: `mcp-supply-chain` on the MCP side is a distinct id). Same disambiguation rule.
> - Agent-tree evaluators prefixed `mcp-*` (e.g. `mcp-scope-escalation`) probe the agent's MCP-handling behavior — they are **not** the MCP-tree evaluators.
> - Some evaluators carry a `-source` suffix (e.g. `prompt-injection-source`) — these are static source/sink code-analysis checks that pair with a dynamic sibling evaluator, not standalone prompt-attack evaluators. They have no attack patterns and are skipped by the pattern-based judge pipeline.

See [cli.md → Two testing modes](cli.md#two-testing-modes) for the mode selection.

---

# Agent red-team

## Suites (11)

| Suite ID                  | Standard / version                   | Count | Kind    | Focus                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------ | ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owasp-llm-top10`         | OWASP LLM Top 10 (2025)              | 30    | derived | Prompt injection, sensitive disclosure, supply chain, data poisoning, output handling, agency, system-prompt leakage, RAG/embedding weaknesses, misinformation, consumption limits                                            |
| `owasp-agentic-ai`        | OWASP Agentic AI Top 10              | 14    | derived | Goal hijack, tool misuse, identity abuse, supply chain, code execution, memory poisoning, inter-agent comms, cascading failures, human-agent trust, rogue agents                                                              |
| `owasp-mcp-top10`         | OWASP MCP Top 10 (2025) — agent-side | 10    | derived | How an agent target handles MCP tool calls, server trust, scope, and resource boundaries                                                                                                                                      |
| `owasp-api-top10`         | OWASP API Security Top 10 (2023)     | 7     | derived | BOLA, BFLA/RBAC, resource consumption, debug exposure, improper output handling                                                                                                                                               |
| `eu-ai-act`               | EU AI Act                            | 23    | derived | Prohibited manipulation (Art.5), data governance & bias (Art.10), accuracy/robustness/cybersecurity (Art.15), transparency (Art.50)                                                                                           |
| `nist-ai-rmf`             | NIST AI RMF                          | 37    | derived | Representative coverage across the trustworthy-AI characteristics (Safe, Secure & Resilient, Privacy-Enhanced, Fair, Valid & Reliable, Accountable & Transparent)                                                             |
| `mitre-atlas`             | MITRE ATLAS                          | 34    | derived | Adversarial ML threat techniques mapped across the whole catalog                                                                                                                                                              |
| `output-trust-and-safety` | Output Trust & Safety (v1)           | 8     | curated | Hallucination, sycophancy, imitation, contractual overreach, off-topic drift, reasoning DoS, ASCII smuggling                                                                                                                  |
| `harmful-content`         | MLCommons + Harmbench harm taxonomy  | 20    | curated | CBRN weapons, IEDs, malicious code, CSAM, sex/violent crime, illegal drugs, self-harm, radicalization, hate, harassment, sexual content, fraud, misinformation, privacy, IP, unqualified specialized advice, unsafe practices |
| `pre-deploy-critical`     | —                                    | 10    | curated | Highest-severity failure modes spanning injection, leakage, unauthorized actions/access, and top harm categories                                                                                                              |
| `quick-smoke`             | —                                    | 4     | curated | One representative critical check across the main surfaces, for CI / a first run                                                                                                                                              |

Derived suites are computed at load time from each evaluator's `standards:` tags — see [evaluator-schema.md](evaluator-schema.md#standards-keys). Curated suites are hand-authored in `suites/agent/`.

## Evaluators

### `owasp-llm-top10` — 30 evaluators

| ID                                | Name                                            | Severity | OWASP |
| --------------------------------- | ----------------------------------------------- | -------- | ----- |
| `agent-goal-hijack`               | Agent Goal Hijacking                            | critical | LLM01 |
| `ascii-smuggling`                 | ASCII / Unicode Smuggling                       | low      | LLM01 |
| `hijacking`                       | Goal Hijacking                                  | high     | LLM01 |
| `jailbreaking`                    | Jailbreaking                                    | high     | LLM01 |
| `prompt-injection`                | Prompt Injection                                | high     | LLM01 |
| `prompt-injection-source`         | Prompt Injection — Source Flow Analysis         | critical | LLM01 |
| `pii-api-db`                      | PII Disclosure via API/DB Tool Calls            | high     | LLM02 |
| `pii-direct`                      | PII Direct Disclosure                           | high     | LLM02 |
| `pii-session`                     | PII Cross-Session Leakage                       | critical | LLM02 |
| `pii-social`                      | PII Disclosure via Social Engineering           | high     | LLM02 |
| `sensitive-disclosure`            | Sensitive Information Disclosure                | critical | LLM02 |
| `supply-chain`                    | Supply Chain Vulnerabilities                    | high     | LLM03 |
| `data-poisoning`                  | Data and Model Poisoning                        | high     | LLM04 |
| `improper-output-handling`        | Improper Output Handling                        | high     | LLM05 |
| `improper-output-handling-source` | Improper Output Handling — Source Sink Analysis | high     | LLM05 |
| `shell-injection`                 | Shell Injection                                 | critical | LLM05 |
| `sql-injection`                   | SQL Injection                                   | critical | LLM05 |
| `unexpected-code-execution`       | Unexpected Code Execution                       | critical | LLM05 |
| `excessive-agency`                | Excessive Agency                                | high     | LLM06 |
| `excessive-agency-source`         | Excessive Agency — Source Guard Analysis        | high     | LLM06 |
| `tool-misuse`                     | Tool Misuse and Exploitation                    | critical | LLM06 |
| `system-prompt-leakage`           | System Prompt Leakage                           | high     | LLM07 |
| `vector-embedding-weaknesses`     | Vector and Embedding Weaknesses                 | high     | LLM08 |
| `hallucination`                   | Hallucination                                   | medium   | LLM09 |
| `harmful-specialized-advice`      | Harmful — Unqualified Specialized Advice        | medium   | LLM09 |
| `harmful-unsafe-practices`        | Harmful — Promotion of Unsafe Practices         | low      | LLM09 |
| `misinformation`                  | Misinformation                                  | high     | LLM09 |
| `overreliance`                    | Overreliance and Sycophancy                     | medium   | LLM09 |
| `reasoning-dos`                   | Reasoning Denial of Service                     | low      | LLM10 |
| `unbounded-consumption`           | Unbounded Consumption                           | high     | LLM10 |

### `owasp-agentic-ai` — 14 evaluators

| ID                          | Name                                     | Severity | OWASP |
| --------------------------- | ---------------------------------------- | -------- | ----- |
| `agent-goal-hijack`         | Agent Goal Hijacking                     | critical | ASI01 |
| `excessive-agency`          | Excessive Agency                         | high     | ASI02 |
| `excessive-agency-source`   | Excessive Agency — Source Guard Analysis | high     | ASI02 |
| `tool-misuse`               | Tool Misuse and Exploitation             | critical | ASI02 |
| `identity-privilege-abuse`  | Identity and Privilege Abuse             | critical | ASI03 |
| `supply-chain`              | Supply Chain Vulnerabilities             | high     | ASI04 |
| `unexpected-code-execution` | Unexpected Code Execution                | critical | ASI05 |
| `memory-inject-plant`       | Memory Injection — Plant Phase           | high     | ASI06 |
| `memory-inject-trigger`     | Memory Injection — Trigger Phase         | critical | ASI06 |
| `memory-poisoning`          | Memory and Context Poisoning             | high     | ASI06 |
| `inter-agent-communication` | Insecure Inter-Agent Communication       | high     | ASI07 |
| `cascading-failures`        | Cascading Failures                       | high     | ASI08 |
| `human-agent-trust`         | Human-Agent Trust Exploitation           | high     | ASI09 |
| `rogue-agents`              | Rogue Agents                             | critical | ASI10 |

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

### `owasp-api-top10` — 7 evaluators

| ID                         | Name                                       | Severity | OWASP |
| -------------------------- | ------------------------------------------ | -------- | ----- |
| `bola`                     | Broken Object Level Authorization (BOLA)   | high     | API1  |
| `reasoning-dos`            | Reasoning Denial of Service                | low      | API4  |
| `unbounded-consumption`    | Unbounded Consumption                      | high     | API4  |
| `bfla`                     | Broken Function Level Authorization (BFLA) | high     | API5  |
| `rbac`                     | Broken Role-Based Access Control           | high     | API5  |
| `debug-access`             | Debug and Admin Interface Exposure         | high     | API8  |
| `improper-output-handling` | Improper Output Handling                   | high     | API10 |

### `eu-ai-act` — 23 evaluators

| ID                                      | Name                                      | Severity | Article |
| --------------------------------------- | ----------------------------------------- | -------- | ------- |
| `harmful-harassment-bullying`           | Harmful — Harassment & Bullying           | medium   | Art.5   |
| `harmful-hate`                          | Harmful — Hate Speech                     | critical | Art.5   |
| `harmful-misinformation-disinformation` | Harmful — Misinformation & Disinformation | medium   | Art.5   |
| `bias-age`                              | Age Bias                                  | low      | Art.10  |
| `bias-disability`                       | Disability Bias                           | low      | Art.10  |
| `bias-gender`                           | Gender Bias                               | low      | Art.10  |
| `bias-political`                        | Political Bias                            | medium   | Art.10  |
| `bias-race`                             | Racial Bias                               | low      | Art.10  |
| `bias-religious`                        | Religious Bias                            | low      | Art.10  |
| `harmful-privacy`                       | Harmful — Privacy Violation               | high     | Art.10  |
| `pii-api-db`                            | PII Disclosure via API/DB Tool Calls      | high     | Art.10  |
| `pii-direct`                            | PII Direct Disclosure                     | high     | Art.10  |
| `pii-session`                           | PII Cross-Session Leakage                 | critical | Art.10  |
| `pii-social`                            | PII Disclosure via Social Engineering     | high     | Art.10  |
| `sensitive-disclosure`                  | Sensitive Information Disclosure          | critical | Art.10  |
| `agent-goal-hijack`                     | Agent Goal Hijacking                      | critical | Art.15  |
| `ascii-smuggling`                       | ASCII / Unicode Smuggling                 | low      | Art.15  |
| `hallucination`                         | Hallucination                             | medium   | Art.15  |
| `jailbreaking`                          | Jailbreaking                              | high     | Art.15  |
| `misinformation`                        | Misinformation                            | high     | Art.15  |
| `overreliance`                          | Overreliance and Sycophancy               | medium   | Art.15  |
| `prompt-injection`                      | Prompt Injection                          | high     | Art.15  |
| `imitation`                             | Unauthorized Imitation                    | medium   | Art.50  |

### `nist-ai-rmf` — 37 evaluators

| ID                                      | Name                                         | Severity | Characteristic              |
| --------------------------------------- | -------------------------------------------- | -------- | --------------------------- |
| `competitors`                           | Competitor Endorsement                       | low      | Accountable & Transparent   |
| `imitation`                             | Unauthorized Imitation                       | medium   | Accountable & Transparent   |
| `system-prompt-leakage`                 | System Prompt Leakage                        | high     | Accountable & Transparent   |
| `bias-age`                              | Age Bias                                     | low      | Fair — Harmful Bias Managed |
| `bias-disability`                       | Disability Bias                              | low      | Fair — Harmful Bias Managed |
| `bias-gender`                           | Gender Bias                                  | low      | Fair — Harmful Bias Managed |
| `bias-political`                        | Political Bias                               | medium   | Fair — Harmful Bias Managed |
| `bias-race`                             | Racial Bias                                  | low      | Fair — Harmful Bias Managed |
| `bias-religious`                        | Religious Bias                               | low      | Fair — Harmful Bias Managed |
| `harmful-privacy`                       | Harmful — Privacy Violation                  | high     | Privacy-Enhanced            |
| `pii-api-db`                            | PII Disclosure via API/DB Tool Calls         | high     | Privacy-Enhanced            |
| `pii-direct`                            | PII Direct Disclosure                        | high     | Privacy-Enhanced            |
| `pii-session`                           | PII Cross-Session Leakage                    | critical | Privacy-Enhanced            |
| `pii-social`                            | PII Disclosure via Social Engineering        | high     | Privacy-Enhanced            |
| `sensitive-disclosure`                  | Sensitive Information Disclosure             | critical | Privacy-Enhanced            |
| `harmful-bioweapons`                    | Harmful — Chemical & Biological Weapons      | critical | Safe                        |
| `harmful-child-exploitation`            | Harmful — Child Exploitation (CSAM)          | critical | Safe                        |
| `harmful-cybercrime-malicious-code`     | Harmful — Cybercrime & Malicious Code        | high     | Safe                        |
| `harmful-harassment-bullying`           | Harmful — Harassment & Bullying              | medium   | Safe                        |
| `harmful-hate`                          | Harmful — Hate Speech                        | critical | Safe                        |
| `harmful-illegal-activities`            | Harmful — Illegal Activities (Fraud & Scams) | medium   | Safe                        |
| `harmful-misinformation-disinformation` | Harmful — Misinformation & Disinformation    | medium   | Safe                        |
| `harmful-non-violent-crime`             | Harmful — Non-Violent Crime                  | medium   | Safe                        |
| `harmful-self-harm`                     | Harmful — Self-Harm & Suicide                | high     | Safe                        |
| `harmful-sexual-content`                | Harmful — Sexual Content                     | medium   | Safe                        |
| `harmful-violent-crime`                 | Harmful — Violent Crime                      | high     | Safe                        |
| `agent-goal-hijack`                     | Agent Goal Hijacking                         | critical | Secure & Resilient          |
| `ascii-smuggling`                       | ASCII / Unicode Smuggling                    | low      | Secure & Resilient          |
| `excessive-agency`                      | Excessive Agency                             | high     | Secure & Resilient          |
| `jailbreaking`                          | Jailbreaking                                 | high     | Secure & Resilient          |
| `prompt-injection`                      | Prompt Injection                             | high     | Secure & Resilient          |
| `shell-injection`                       | Shell Injection                              | critical | Secure & Resilient          |
| `sql-injection`                         | SQL Injection                                | critical | Secure & Resilient          |
| `tool-misuse`                           | Tool Misuse and Exploitation                 | critical | Secure & Resilient          |
| `hallucination`                         | Hallucination                                | medium   | Valid & Reliable            |
| `misinformation`                        | Misinformation                               | high     | Valid & Reliable            |
| `overreliance`                          | Overreliance and Sycophancy                  | medium   | Valid & Reliable            |

### `mitre-atlas` — 34 evaluators

| ID                                  | Name                                            | Severity | ATLAS         |
| ----------------------------------- | ----------------------------------------------- | -------- | ------------- |
| `mcp-supply-chain-trust`            | MCP Supply Chain Trust                          | high     | AML.T0010     |
| `supply-chain`                      | Supply Chain Vulnerabilities                    | high     | AML.T0010     |
| `identity-privilege-abuse`          | Identity and Privilege Abuse                    | critical | AML.T0012     |
| `mcp-scope-escalation`              | MCP Scope Escalation                            | high     | AML.T0012     |
| `data-poisoning`                    | Data and Model Poisoning                        | high     | AML.T0020     |
| `reasoning-dos`                     | Reasoning Denial of Service                     | low      | AML.T0029     |
| `unbounded-consumption`             | Unbounded Consumption                           | high     | AML.T0034     |
| `harmful-specialized-advice`        | Harmful — Unqualified Specialized Advice        | medium   | AML.T0048     |
| `bola`                              | Broken Object Level Authorization (BOLA)        | high     | AML.T0049     |
| `sql-injection`                     | SQL Injection                                   | critical | AML.T0049     |
| `unexpected-code-execution`         | Unexpected Code Execution                       | critical | AML.T0050     |
| `mcp-tool-injection-payload`        | MCP Tool-Injection Payload Forwarding           | critical | AML.T0051.001 |
| `prompt-injection`                  | Prompt Injection                                | high     | AML.T0051     |
| `prompt-injection-source`           | Prompt Injection — Source Flow Analysis         | critical | AML.T0051     |
| `excessive-agency-source`           | Excessive Agency — Source Guard Analysis        | high     | AML.T0053     |
| `tool-misuse`                       | Tool Misuse and Exploitation                    | critical | AML.T0053     |
| `harmful-bioweapons`                | Harmful — Chemical & Biological Weapons         | critical | AML.T0054     |
| `harmful-cybercrime-malicious-code` | Harmful — Cybercrime & Malicious Code           | high     | AML.T0054     |
| `harmful-indiscriminate-weapons`    | Harmful — Indiscriminate Weapons (CBRN)         | medium   | AML.T0054     |
| `jailbreaking`                      | Jailbreaking                                    | high     | AML.T0054     |
| `system-prompt-leakage`             | System Prompt Leakage                           | high     | AML.T0056     |
| `mcp-credential-exposure`           | MCP Credential Exposure                         | critical | AML.T0057     |
| `sensitive-disclosure`              | Sensitive Information Disclosure                | critical | AML.T0057     |
| `improper-output-handling`          | Improper Output Handling                        | high     | AML.T0067     |
| `improper-output-handling-source`   | Improper Output Handling — Source Sink Analysis | high     | AML.T0067     |
| `ascii-smuggling`                   | ASCII / Unicode Smuggling                       | low      | AML.T0068     |
| `debug-access`                      | Debug and Admin Interface Exposure              | high     | AML.T0069     |
| `vector-embedding-weaknesses`       | Vector and Embedding Weaknesses                 | high     | AML.T0070     |
| `imitation`                         | Unauthorized Imitation                          | medium   | AML.T0073     |
| `mcp-shadow-server`                 | MCP Shadow Server Detection                     | high     | AML.T0073     |
| `memory-inject-plant`               | Memory Injection — Plant Phase                  | high     | AML.T0080     |
| `memory-inject-trigger`             | Memory Injection — Trigger Phase                | critical | AML.T0080     |
| `memory-poisoning`                  | Memory and Context Poisoning                    | high     | AML.T0080     |
| `mcp-audit-bypass`                  | MCP Audit and Telemetry Bypass                  | medium   | AML.T0109     |

### `output-trust-and-safety` — 8 evaluators

Output-quality and trust-boundary subset (hallucination, sycophancy, impersonation, contractual overreach, off-topic drift, reasoning DoS, unicode-smuggled injection) that doesn't map cleanly to one OWASP framework but is a real production liability. Curated.

| ID                | Name                                 | Severity | Tags                                         |
| ----------------- | ------------------------------------ | -------- | -------------------------------------------- |
| `ascii-smuggling` | ASCII / Unicode Smuggling            | low      | LLM01, Art.15, AML.T0068, Secure & Resilient |
| `competitors`     | Competitor Endorsement               | low      | Accountable & Transparent                    |
| `contracts`       | Unauthorized Contractual Commitments | high     | —                                            |
| `hallucination`   | Hallucination                        | medium   | LLM09, Art.15, Valid & Reliable              |
| `imitation`       | Unauthorized Imitation               | medium   | Art.50, AML.T0073, Accountable & Transparent |
| `off-topic`       | Off-Topic Drift                      | medium   | —                                            |
| `overreliance`    | Overreliance and Sycophancy          | medium   | LLM09, Art.15, Valid & Reliable              |
| `reasoning-dos`   | Reasoning Denial of Service          | low      | LLM10, API4, AML.T0029                       |

### `harmful-content` — 20 evaluators

Content-harm coverage drawn from the MLCommons hazard taxonomy and Harmbench, plus targeted additions for hate, harassment, sexual content, fraud, disinformation, privacy, and copyright. Targets what a model can be talked into _saying_ — synthesis routes, operational planning, recruitment messaging, method content. Best paired with raw LLM endpoints (OpenAI, Anthropic, Bedrock). Compose with `owasp-llm-top10`, `owasp-api-top10`, and `eu-ai-act` for prompt-level, PII, and bias coverage.

| ID                                      | Name                                 | Severity | Tags                     |
| --------------------------------------- | ------------------------------------ | -------- | ------------------------ |
| `harmful-bioweapons`                    | Chemical & Biological Weapons        | critical | Safe, AML.T0054          |
| `harmful-child-exploitation`            | Child Exploitation (CSAM)            | critical | Safe                     |
| `harmful-copyright-violations`          | Copyright Violations                 | low      | —                        |
| `harmful-cybercrime-malicious-code`     | Cybercrime & Malicious Code          | high     | Safe, AML.T0054          |
| `harmful-harassment-bullying`           | Harassment & Bullying                | medium   | Art.5, Safe              |
| `harmful-hate`                          | Hate Speech                          | critical | Art.5, Safe              |
| `harmful-illegal-activities`            | Illegal Activities (Fraud & Scams)   | medium   | Safe                     |
| `harmful-illegal-drugs`                 | Illegal Drug Synthesis & Trafficking | medium   | —                        |
| `harmful-indiscriminate-weapons`        | Indiscriminate Weapons (CBRN)        | medium   | AML.T0054                |
| `harmful-misinformation-disinformation` | Misinformation & Disinformation      | medium   | Art.5, Safe              |
| `harmful-non-violent-crime`             | Non-Violent Crime                    | medium   | Safe                     |
| `harmful-privacy`                       | Privacy Violation                    | high     | Art.10, Privacy-Enhanced |
| `harmful-radicalization`                | Radicalization & Extremism           | high     | —                        |
| `harmful-self-harm`                     | Self-Harm & Suicide                  | high     | Safe                     |
| `harmful-sex-crime`                     | Sex Crime                            | critical | —                        |
| `harmful-sexual-content`                | Sexual Content                       | medium   | Safe                     |
| `harmful-specialized-advice`            | Unqualified Specialized Advice       | medium   | LLM09, AML.T0048         |
| `harmful-unsafe-practices`              | Promotion of Unsafe Practices        | low      | LLM09                    |
| `harmful-violent-crime`                 | Violent Crime                        | high     | Safe                     |
| `harmful-weapons-ied`                   | Improvised Explosive Devices         | critical | —                        |

### `pre-deploy-critical` — 10 evaluators

Broader pre-deployment gate spanning the highest-severity failure modes — injection, leakage, unauthorized actions/access, and top harm categories. Curated; compose with the derived OWASP suites for full-standard coverage.

| ID                                  | Name                                     | Severity | Tags                                         |
| ----------------------------------- | ---------------------------------------- | -------- | -------------------------------------------- |
| `bola`                              | Broken Object Level Authorization (BOLA) | high     | API1, AML.T0049                              |
| `excessive-agency`                  | Excessive Agency                         | high     | LLM06, ASI02, Secure & Resilient             |
| `harmful-cybercrime-malicious-code` | Harmful — Cybercrime & Malicious Code    | high     | Safe, AML.T0054                              |
| `jailbreaking`                      | Jailbreaking                             | high     | LLM01, Art.15, AML.T0054, Secure & Resilient |
| `pii-direct`                        | PII Direct Disclosure                    | high     | LLM02, Art.10, Privacy-Enhanced              |
| `prompt-injection`                  | Prompt Injection                         | high     | LLM01, Art.15, AML.T0051, Secure & Resilient |
| `sensitive-disclosure`              | Sensitive Information Disclosure         | critical | LLM02, Art.10, AML.T0057, Privacy-Enhanced   |
| `shell-injection`                   | Shell Injection                          | critical | LLM05, Secure & Resilient                    |
| `sql-injection`                     | SQL Injection                            | critical | LLM05, AML.T0049, Secure & Resilient         |
| `system-prompt-leakage`             | System Prompt Leakage                    | high     | LLM07, AML.T0056, Accountable & Transparent  |

### `quick-smoke` — 4 evaluators

Fast, high-signal subset for CI / a first run — one representative critical check across the main surfaces. Curated, intentionally small.

| ID                                  | Name                                  | Severity | Tags                                         |
| ----------------------------------- | ------------------------------------- | -------- | -------------------------------------------- |
| `harmful-cybercrime-malicious-code` | Harmful — Cybercrime & Malicious Code | high     | Safe, AML.T0054                              |
| `jailbreaking`                      | Jailbreaking                          | high     | LLM01, Art.15, AML.T0054, Secure & Resilient |
| `prompt-injection`                  | Prompt Injection                      | high     | LLM01, Art.15, AML.T0051, Secure & Resilient |
| `system-prompt-leakage`             | System Prompt Leakage                 | high     | LLM07, AML.T0056, Accountable & Transparent  |

---

# MCP red-team

## Suites (5)

| Suite ID          | Standard / version               | Count | Kind    | Focus                                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------- | ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owasp-mcp-top10` | OWASP MCP Top 10 (2025)          | 23    | derived | Server-side: secret exposure, OAuth passthrough, scope escalation, supply chain, tool description injection, command injection, SSRF, missing auth, intent subversion, cross-resource leakage, second-order content injection, audit gaps, shadow server, static source/sink checks |
| `owasp-api-top10` | OWASP API Security Top 10 (2023) | 1     | derived | SSRF                                                                                                                                                                                                                                                                                |
| `nist-ai-rmf`     | NIST AI RMF                      | 1     | derived | Secure & Resilient                                                                                                                                                                                                                                                                  |
| `mitre-atlas`     | MITRE ATLAS                      | 20    | derived | Adversarial ML threat techniques across the MCP-protocol catalog                                                                                                                                                                                                                    |
| `mcp-smoke`       | —                                | 4     | curated | One representative check across the main MCP risk areas, for CI / a first run                                                                                                                                                                                                       |

## Evaluators (23 pickable)

| ID                              | Name                                                               | Severity | OWASP |
| ------------------------------- | ------------------------------------------------------------------ | -------- | ----- |
| `oauth-token-passthrough`       | OAuth Confused Deputy and Token Passthrough                        | critical | MCP01 |
| `path-traversal-source`         | Path Traversal — Source Sink Analysis                              | critical | MCP01 |
| `secret-exposure`               | Secret and Token Exposure                                          | critical | MCP01 |
| `secret-exposure-source`        | Secret Exposure — Source Analysis                                  | critical | MCP01 |
| `scope-escalation`              | Scope Escalation and Privilege Bypass                              | high     | MCP02 |
| `timing-side-channel`           | Timing Side-Channel Analysis                                       | medium   | MCP02 |
| `content-injection`             | Second-Order Content Injection                                     | high     | MCP03 |
| `tool-description-injection`    | Tool Poisoning (Description Injection, Rug Pull, Schema Poisoning) | critical | MCP03 |
| `tool-description-scan`         | Tool Description Poisoning Scan                                    | critical | MCP03 |
| `mcp-supply-chain`              | Software Supply Chain Attacks & Dependency Tampering               | high     | MCP04 |
| `command-injection`             | Command Injection and STDIO RCE                                    | critical | MCP05 |
| `command-injection-source`      | Command Injection — Source Sink Analysis                           | critical | MCP05 |
| `protocol-abuse`                | MCP Protocol Abuse                                                 | high     | MCP05 |
| `ssrf`                          | Server-Side Request Forgery (SSRF)                                 | high     | MCP05 |
| `ssrf-source`                   | SSRF — Source Sink Analysis                                        | critical | MCP05 |
| `intent-subversion`             | Intent Flow Subversion                                             | high     | MCP06 |
| `return-value-injection`        | Runtime Return-Value Injection                                     | critical | MCP06 |
| `missing-authentication`        | Missing Authentication                                             | critical | MCP07 |
| `missing-authentication-source` | Missing Authentication — Source Analysis                           | critical | MCP07 |
| `audit-telemetry`               | Lack of Audit and Telemetry                                        | medium   | MCP08 |
| `shadow-mcp-server`             | Shadow MCP Server Detection                                        | high     | MCP09 |
| `cross-resource-leakage`        | Context Injection, Over-Sharing & Cross-Resource Leakage           | critical | MCP10 |
| `resource-exposure`             | MCP Resource Exposure                                              | critical | MCP10 |

`resource-exposure` also runs automatically during `opfor run` **Phase 0** — opfor calls `resources/list` + `resources/read` on every resource and judges for secret/PII exposure, independent of whether it's in your selected suite/evaluator list. Disable with `mcp.scanResources: false` in the config. It's a normal catalog member (and suite member) otherwise — pick it explicitly if you want it in a run's reported results outside the Phase 0 pre-flight.

`-source` suffixed evaluators (`path-traversal-source`, `secret-exposure-source`, `command-injection-source`, `ssrf-source`, `missing-authentication-source`) are static source/sink code-analysis checks — no attack patterns, skill-driven, paired with their dynamic sibling.

---

## Picking evaluators by hand

Set the evaluator IDs in your config's `selection` block, then run `opfor run --config <path>`.

**Config file** — top-level `selection` block (same shape for agent and MCP targets; the target kind is set by `target.kind`):

```json
"selection": {
  "mode": "evaluators",
  "evaluators": ["prompt-injection", "jailbreaking", "bola"]
}
```

For an MCP target, use MCP-tree evaluator IDs instead, e.g. `["tool-description-injection", "scope-escalation"]`.

**Opfor MCP server tool:**

```json
{ "evaluator_ids": ["prompt-injection", "bola"] }
```

See [cli.md → Config fields reference](cli.md#config-fields-reference) and [mcp.md → opfor_setup](mcp.md#opfor_setup).

---

## Contributing a new evaluator

See [CONTRIBUTING.md → Adding an evaluator](../CONTRIBUTING.md#adding-an-evaluator) for the full workflow. Quick summary:

1. Add a YAML file (or directory) under `evaluators/agent/<category>/` or `evaluators/mcp/<category>/`.
2. Required fields: `id`, `name`, `severity`, `pass_criteria`, `fail_criteria`, `patterns` (flat) or `patterns/` directory. See [evaluator-schema.md](evaluator-schema.md).
3. Set `standards:` to include the evaluator in auto-derived suites (e.g. `owasp-llm: LLM01`). For curated suites, add the ID to the relevant `suites/` file.
4. Run `npm run build:catalog && npm run validate:skills` before opening a PR.
